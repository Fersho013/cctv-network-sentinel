import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  alerts,
  cameras,
  db,
  healthLogs,
  runMigrations,
  type AlertRow,
  type CameraRow,
} from '@cctv/db';
import { checkTcpPort, normalizeSubnet, scanLocalSubnet, type ScanResult } from '@cctv/core';
import {
  buildRtspUrl,
  CAMERA_PRESETS,
  getPreset,
  maskRtspUrl,
  resolveStreamPath,
} from './camera-config';
import { decryptSecret, encryptSecret } from './crypto';
import {
  captureSnapshot,
  ensureStream,
  getFfmpegPath,
  getFfprobePath,
  getStreamMode,
  HLS_ROOT,
  isStreamRunning,
  probeStream,
  stopAllStreams,
  stopStream,
  touchStream,
  waitForPlaylist,
} from './streams';

dotenv.config();

const app = Fastify({ logger: true });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEALTH_INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS) || 30_000;
const WEBHOOK_URLS = (process.env.WEBHOOK_URL ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 5_000;

type CameraStatus = 'ONLINE' | 'OFFLINE';
type AlertSeverity = 'info' | 'warning' | 'critical';

interface CameraDto {
  id: number;
  name: string;
  brand: string;
  ipAddress: string;
  rtspPort: number;
  channel: number;
  username: string;
  hasPassword: boolean;
  streamPath: string;
  status: CameraStatus;
  latencyMs: number;
  rtspOpen: boolean;
  httpOpen: boolean;
  lastSeen: string | null;
  createdAt: string;
  streaming: boolean;
}

interface AlertDto {
  id: number;
  cameraId: number | null;
  message: string;
  severity: AlertSeverity;
  acknowledged: boolean;
  timestamp: string;
}

interface CameraInput {
  name?: string;
  brand?: string;
  ipAddress?: string;
  rtspPort?: number;
  channel?: number;
  username?: string;
  password?: string;
  streamPath?: string;
}

let scanInProgress = false;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function sendTelegramAlert(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      },
    );

    if (!response.ok) {
      app.log.warn({ status: response.status }, 'Telegram respondió con error');
    }
  } catch (error) {
    app.log.warn({ err: error }, 'No se pudo enviar la alerta de Telegram');
  }
}

function toCameraDto(camera: CameraRow): CameraDto {
  return {
    id: camera.id,
    name: camera.name,
    brand: camera.brand,
    ipAddress: camera.ipAddress,
    rtspPort: camera.rtspPort,
    channel: camera.channel,
    username: camera.username,
    hasPassword: Boolean(camera.passwordEnc),
    streamPath: camera.streamPath,
    status: camera.status as CameraStatus,
    latencyMs: camera.latencyMs,
    rtspOpen: camera.rtspOpen,
    httpOpen: camera.httpOpen,
    lastSeen: camera.lastSeen?.toISOString() ?? null,
    createdAt: camera.createdAt.toISOString(),
    streaming: isStreamRunning(camera.id),
  };
}

function toAlertDto(alert: AlertRow): AlertDto {
  return {
    id: alert.id,
    cameraId: alert.cameraId,
    message: alert.message,
    severity: alert.severity as AlertSeverity,
    acknowledged: alert.acknowledged,
    timestamp: alert.timestamp.toISOString(),
  };
}

interface WebhookPayload {
  event: string;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
  alertId?: number;
  camera?: {
    id: number;
    name: string;
    brand: string;
    ipAddress: string;
    status: string;
  } | null;
}

interface WebhookResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

function maskWebhookUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

function alertEvent(message: string): string {
  if (/OFFLINE/i.test(message)) return 'camera.offline';
  if (/recuperada/i.test(message)) return 'camera.online';
  return 'alert';
}

/**
 * Entrega un webhook con reintentos y firma HMAC opcional.
 * Los errores 4xx no se reintentan; los 5xx y los fallos de red sí.
 */
async function deliverWebhook(url: string, body: string, signature: string | null): Promise<WebhookResult> {
  const masked = maskWebhookUrl(url);
  let lastError = 'Error desconocido';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'cctv-network-sentinel',
          ...(signature ? { 'X-CCTV-Signature': `sha256=${signature}` } : {}),
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        return { url: masked, ok: true, status: response.status };
      }

      lastError = `HTTP ${response.status}`;
      if (response.status < 500) {
        return { url: masked, ok: false, status: response.status, error: lastError };
      }
    } catch (error) {
      clearTimeout(timer);
      lastError = errorMessage(error);
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }

  app.log.warn({ url: masked, error: lastError }, 'No se pudo entregar el webhook');
  return { url: masked, ok: false, error: lastError };
}

async function dispatchWebhooks(payload: WebhookPayload): Promise<WebhookResult[]> {
  if (WEBHOOK_URLS.length === 0) return [];

  const body = JSON.stringify(payload);
  const signature = WEBHOOK_SECRET
    ? createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
    : null;

  return Promise.all(WEBHOOK_URLS.map((url) => deliverWebhook(url, body, signature)));
}

async function createAlert(
  cameraId: number | null,
  message: string,
  severity: AlertSeverity,
) {
  const timestamp = new Date();
  const [alert] = await db
    .insert(alerts)
    .values({ cameraId, message, severity, timestamp })
    .returning();

  const camera = cameraId !== null ? await findCamera(cameraId) : undefined;

  void dispatchWebhooks({
    event: alertEvent(message),
    message,
    severity,
    timestamp: timestamp.toISOString(),
    alertId: alert?.id,
    camera: camera
      ? {
          id: camera.id,
          name: camera.name,
          brand: camera.brand,
          ipAddress: camera.ipAddress,
          status: camera.status,
        }
      : null,
  });

  return alert;
}

function normalizeBrand(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return 'generic';

  const match = CAMERA_PRESETS.find(
    (preset) =>
      preset.id.toLowerCase() === raw.toLowerCase() ||
      preset.label.toLowerCase() === raw.toLowerCase(),
  );

  return match?.id ?? raw;
}

function isValidIp(ip: string): boolean {
  const octets = ip.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

function cameraConnection(camera: CameraRow) {
  return {
    brand: camera.brand,
    ipAddress: camera.ipAddress,
    rtspPort: camera.rtspPort,
    channel: camera.channel,
    username: camera.username,
    password: decryptSecret(camera.passwordEnc),
    streamPath: camera.streamPath,
  };
}

async function findCamera(id: number): Promise<CameraRow | undefined> {
  const [camera] = await db.select().from(cameras).where(eq(cameras.id, id));
  return camera;
}

async function checkCameraHealth(camera: CameraRow) {
  const latencyMs = await checkTcpPort(camera.ipAddress, camera.rtspPort, 2500);
  const online = latencyMs >= 0;
  const nextStatus: CameraStatus = online ? 'ONLINE' : 'OFFLINE';
  const previousStatus = camera.status;
  const now = new Date();

  await db
    .update(cameras)
    .set({
      status: nextStatus,
      latencyMs,
      rtspOpen: online,
      lastSeen: now,
    })
    .where(eq(cameras.id, camera.id));

  await db.insert(healthLogs).values({
    cameraId: camera.id,
    status: nextStatus,
    latencyMs,
    rtspOpen: online,
    httpOpen: camera.httpOpen,
    timestamp: now,
  });

  if (previousStatus !== 'OFFLINE' && nextStatus === 'OFFLINE') {
    if (isStreamRunning(camera.id)) stopStream(camera.id);
    const message = `Cámara OFFLINE: ${camera.name} (${camera.ipAddress})`;
    await createAlert(camera.id, message, 'warning');
    void sendTelegramAlert(`⚠️ ${message}`);
  } else if (previousStatus === 'OFFLINE' && nextStatus === 'ONLINE') {
    await createAlert(
      camera.id,
      `Cámara recuperada: ${camera.name} (${camera.ipAddress})`,
      'info',
    );
  }
}

function isCameraCandidate(result: ScanResult) {
  return result.status === 'ONLINE' && (result.rtspOpen || result.httpOpen);
}

async function applyScanResults(results: ScanResult[], subnet: string) {
  const now = new Date();
  const candidates = results.filter(isCameraCandidate);
  const seenIps = new Set(candidates.map((candidate) => candidate.ip));
  const existingCameras = await db.select().from(cameras);
  const cameraByIp = new Map(existingCameras.map((camera) => [camera.ipAddress, camera]));

  let added = 0;
  let updated = 0;
  let offline = 0;

  for (const result of candidates) {
    const camera = cameraByIp.get(result.ip);

    if (!camera) {
      const [inserted] = await db
        .insert(cameras)
        .values({
          name: `Cámara ${result.ip}`,
          brand: 'generic',
          ipAddress: result.ip,
          status: 'ONLINE',
          latencyMs: result.latencyMs,
          rtspOpen: result.rtspOpen,
          httpOpen: result.httpOpen,
          lastSeen: now,
        })
        .returning();

      cameraByIp.set(result.ip, inserted);
      added++;
      continue;
    }

    if (camera.status === 'OFFLINE') {
      await createAlert(
        camera.id,
        `Cámara recuperada: ${camera.name} (${camera.ipAddress})`,
        'info',
      );
    }

    await db
      .update(cameras)
      .set({
        status: 'ONLINE',
        latencyMs: result.latencyMs,
        rtspOpen: result.rtspOpen,
        httpOpen: result.httpOpen,
        lastSeen: now,
      })
      .where(eq(cameras.id, camera.id));

    updated++;
  }

  for (const camera of existingCameras) {
    const belongsToScan = camera.ipAddress.startsWith(subnet);
    if (!belongsToScan || seenIps.has(camera.ipAddress) || camera.status === 'OFFLINE') continue;

    await db
      .update(cameras)
      .set({ status: 'OFFLINE', latencyMs: -1, lastSeen: now })
      .where(eq(cameras.id, camera.id));

    const message = `Cámara OFFLINE: ${camera.name} (${camera.ipAddress})`;
    await createAlert(camera.id, message, 'warning');
    void sendTelegramAlert(`⚠️ ${message}`);
    offline++;
  }

  return { added, updated, offline };
}

fs.mkdirSync(HLS_ROOT, { recursive: true });

app.register(cors, { origin: true });
app.register(fastifyStatic, {
  root: HLS_ROOT,
  prefix: '/streams/',
  decorateReply: false,
  cacheControl: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  },
});

// Cada petición a un playlist o segmento mantiene viva la sesión de FFmpeg.
app.addHook('onRequest', async (req) => {
  const match = /^\/streams\/(\d+)\//.exec(req.url);
  if (match) touchStream(Number(match[1]));
});

app.get('/health', async () => ({
  status: 'ok',
  ffmpeg: getFfmpegPath(),
  ffprobe: getFfprobePath(),
}));

app.get('/api/camera-presets', async () => CAMERA_PRESETS);

app.get('/api/cameras', async () => {
  const rows = await db.select().from(cameras).orderBy(cameras.id);
  return rows.map(toCameraDto);
});

app.post<{ Body?: CameraInput }>('/api/cameras', async (req, reply) => {
  const body = req.body ?? {};
  const name = body.name?.trim();
  const ipAddress = body.ipAddress?.trim();

  if (!name) return reply.code(400).send({ error: 'El nombre es obligatorio.' });
  if (!ipAddress || !isValidIp(ipAddress)) {
    return reply.code(400).send({ error: 'La dirección IP no es válida.' });
  }

  const [existing] = await db
    .select()
    .from(cameras)
    .where(eq(cameras.ipAddress, ipAddress));

  if (existing) {
    return reply.code(409).send({ error: 'Ya existe una cámara con esa IP.' });
  }

  const brand = normalizeBrand(body.brand);
  const preset = getPreset(brand);
  const channel = Math.max(1, Math.floor(body.channel ?? 1));
  const rtspPort = Math.floor(body.rtspPort ?? preset?.rtspPort ?? 554);
  const streamPath = resolveStreamPath(brand, body.streamPath ?? '', channel);
  const password = body.password ?? '';

  const [inserted] = await db
    .insert(cameras)
    .values({
      name,
      brand,
      ipAddress,
      rtspPort,
      channel,
      username: body.username?.trim() ?? '',
      passwordEnc: encryptSecret(password),
      streamPath,
      status: 'OFFLINE',
      latencyMs: -1,
    })
    .returning();

  return reply.code(201).send(toCameraDto(inserted));
});

app.patch<{ Params: { id: string }; Body?: CameraInput }>(
  '/api/cameras/:id',
  async (req, reply) => {
    const camera = await findCamera(Number(req.params.id));
    if (!camera) return reply.code(404).send({ error: 'Cámara no encontrada.' });

    const body = req.body ?? {};
    const updates: Partial<CameraRow> = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return reply.code(400).send({ error: 'El nombre no puede estar vacío.' });
      updates.name = name;
    }

    if (body.ipAddress !== undefined) {
      const ipAddress = body.ipAddress.trim();
      if (!isValidIp(ipAddress)) {
        return reply.code(400).send({ error: 'La dirección IP no es válida.' });
      }
      if (ipAddress !== camera.ipAddress) {
        const [duplicate] = await db
          .select()
          .from(cameras)
          .where(eq(cameras.ipAddress, ipAddress));
        if (duplicate) {
          return reply.code(409).send({ error: 'Ya existe una cámara con esa IP.' });
        }
      }
      updates.ipAddress = ipAddress;
    }

    const brand = body.brand !== undefined ? normalizeBrand(body.brand) : camera.brand;
    const channel =
      body.channel !== undefined ? Math.max(1, Math.floor(body.channel)) : camera.channel;
    const preset = getPreset(brand);

    updates.brand = brand;
    updates.channel = channel;
    updates.rtspPort = Math.floor(body.rtspPort ?? camera.rtspPort ?? preset?.rtspPort ?? 554);

    if (body.streamPath !== undefined) {
      updates.streamPath = resolveStreamPath(brand, body.streamPath, channel);
    } else if (body.brand !== undefined || body.channel !== undefined) {
      updates.streamPath = resolveStreamPath(brand, '', channel);
    }

    if (body.username !== undefined) updates.username = body.username.trim();
    if (body.password !== undefined) updates.passwordEnc = encryptSecret(body.password);

    const [updated] = await db
      .update(cameras)
      .set(updates)
      .where(eq(cameras.id, camera.id))
      .returning();

    // Si cambió la conexión, reiniciamos el stream para aplicar los cambios.
    stopStream(camera.id);
    return toCameraDto(updated);
  },
);

app.delete<{ Params: { id: string } }>('/api/cameras/:id', async (req, reply) => {
  const camera = await findCamera(Number(req.params.id));
  if (!camera) return reply.code(404).send({ error: 'Cámara no encontrada.' });

  stopStream(camera.id);
  await db.delete(cameras).where(eq(cameras.id, camera.id));
  return { deleted: true };
});

app.post<{
  Body?: CameraInput & { cameraId?: number };
}>('/api/cameras/test', async (req, reply) => {
  const body = req.body ?? {};
  let base: Partial<CameraRow> | undefined;

  if (body.cameraId !== undefined) {
    base = await findCamera(body.cameraId);
    if (!base) return reply.code(404).send({ error: 'Cámara no encontrada.' });
  }

  const ipAddress = body.ipAddress?.trim() ?? base?.ipAddress;
  if (!ipAddress || !isValidIp(ipAddress)) {
    return reply.code(400).send({ error: 'La dirección IP no es válida.' });
  }

  const brand = normalizeBrand(body.brand ?? base?.brand);
  const channel = Math.max(1, Math.floor(body.channel ?? base?.channel ?? 1));
  const preset = getPreset(brand);
  const rtspPort = Math.floor(body.rtspPort ?? base?.rtspPort ?? preset?.rtspPort ?? 554);
  const streamPath = resolveStreamPath(brand, body.streamPath ?? base?.streamPath ?? '', channel);
  const username = body.username?.trim() ?? base?.username ?? '';
  const password =
    body.password !== undefined
      ? body.password
      : base
        ? decryptSecret(base.passwordEnc ?? '')
        : '';

  const rtspUrl = buildRtspUrl({
    brand,
    ipAddress,
    rtspPort,
    channel,
    username,
    password,
    streamPath,
  });

  const tcpLatency = await checkTcpPort(ipAddress, rtspPort, 3000);
  if (tcpLatency < 0) {
    return {
      ok: false,
      tcpOpen: false,
      url: maskRtspUrl(rtspUrl),
      error: `El puerto ${rtspPort} no responde en ${ipAddress}. Comprueba la IP y que RTSP esté activado.`,
    };
  }

  const probe = await probeStream(rtspUrl);
  return {
    ok: probe.ok,
    tcpOpen: true,
    latencyMs: tcpLatency,
    url: maskRtspUrl(rtspUrl),
    codec: probe.codec,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    error: probe.error,
  };
});

app.get<{ Params: { id: string } }>('/api/cameras/:id/live', async (req, reply) => {
  const camera = await findCamera(Number(req.params.id));
  if (!camera) return reply.code(404).send({ error: 'Cámara no encontrada.' });

  if (!camera.username) {
    return reply.code(400).send({
      error:
        'Configura el usuario y la contraseña de la cámara (cuenta de cámara Tapo) para ver el vídeo.',
    });
  }

  const rtspUrl = buildRtspUrl(cameraConnection(camera));

  try {
    const dir = ensureStream(camera.id, rtspUrl);
    const ready = await waitForPlaylist(dir);

    if (!ready) {
      stopStream(camera.id);
      return reply.code(504).send({
        error:
          'La cámara no entregó vídeo. Verifica que RTSP esté activado, las credenciales y que esté en la misma red.',
      });
    }

    return {
      hlsUrl: `/streams/${camera.id}/index.m3u8`,
      mode: getStreamMode(camera.id),
      streaming: true,
    };
  } catch (error) {
    app.log.error({ err: error, cameraId: camera.id }, 'No se pudo iniciar el stream');
    return reply.code(500).send({ error: 'No se pudo iniciar el stream de vídeo.' });
  }
});

app.post<{ Params: { id: string } }>('/api/cameras/:id/stream/stop', async (req) => {
  stopStream(Number(req.params.id));
  return { stopped: true };
});

const snapshotCache = new Map<number, { buffer: Buffer; expiresAt: number }>();

app.get<{ Params: { id: string } }>('/api/cameras/:id/snapshot', async (req, reply) => {
  const camera = await findCamera(Number(req.params.id));
  if (!camera) return reply.code(404).send({ error: 'Cámara no encontrada.' });

  const cached = snapshotCache.get(camera.id);
  if (cached && cached.expiresAt > Date.now()) {
    return reply.header('Cache-Control', 'no-store').type('image/jpeg').send(cached.buffer);
  }

  try {
    const buffer = await captureSnapshot(buildRtspUrl(cameraConnection(camera)));
    snapshotCache.set(camera.id, { buffer, expiresAt: Date.now() + 4_000 });
    return reply.header('Cache-Control', 'no-store').type('image/jpeg').send(buffer);
  } catch (error) {
    return reply.code(502).send({
      error: `No se pudo capturar la imagen: ${errorMessage(error)}`,
    });
  }
});

app.get('/api/webhooks/status', async () => ({
  configured: WEBHOOK_URLS.length,
  targets: WEBHOOK_URLS.map(maskWebhookUrl),
  signed: Boolean(WEBHOOK_SECRET),
}));

app.post('/api/webhooks/test', async (_req, reply) => {
  if (WEBHOOK_URLS.length === 0) {
    return reply.code(400).send({
      error: 'Configura WEBHOOK_URL en apps/server/.env y reinicia el servidor.',
    });
  }

  const results = await dispatchWebhooks({
    event: 'test',
    message: 'Prueba de webhook desde CCTV Network Sentinel',
    severity: 'info',
    timestamp: new Date().toISOString(),
  });

  return { results };
});

app.get('/api/alerts', async () => {
  const rows = await db.select().from(alerts).orderBy(desc(alerts.timestamp)).limit(200);
  return rows.map(toAlertDto);
});

app.get('/api/history', async () => {
  const rows = await db
    .select()
    .from(healthLogs)
    .orderBy(desc(healthLogs.timestamp))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    cameraId: row.cameraId,
    status: row.status,
    latencyMs: row.latencyMs,
    rtspOpen: row.rtspOpen,
    httpOpen: row.httpOpen,
    timestamp: row.timestamp.toISOString(),
  }));
});

app.get('/api/scan/status', async () => ({ scanning: scanInProgress }));

app.post<{ Body?: { subnet?: string } }>('/api/scan', async (req, reply) => {
  if (scanInProgress) {
    return reply.code(409).send({ error: 'Ya hay un escaneo en curso.' });
  }

  let subnet: string;
  try {
    subnet = normalizeSubnet(req.body?.subnet ?? '192.168.1');
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }

  scanInProgress = true;
  const startedAt = Date.now();

  try {
    const results = await scanLocalSubnet(subnet);
    const summary = await applyScanResults(results, subnet);

    return {
      subnet,
      durationMs: Date.now() - startedAt,
      scannedAt: new Date().toISOString(),
      totalHosts: results.length,
      onlineHosts: results.filter((result) => result.status === 'ONLINE').length,
      candidates: results.filter(isCameraCandidate),
      summary,
    };
  } catch (error) {
    app.log.error({ err: error }, 'El escaneo falló');
    return reply.code(500).send({ error: 'El escaneo de red falló.' });
  } finally {
    scanInProgress = false;
  }
});

app.post<{
  Body?: {
    cameraId?: number;
    status?: CameraStatus;
    latency?: number;
    latencyMs?: number;
    rtspOpen?: boolean;
    httpOpen?: boolean;
  };
}>('/heartbeat', async (req, reply) => {
  const body = req.body;
  const validStatus = body?.status === 'ONLINE' || body?.status === 'OFFLINE';

  if (!body || typeof body.cameraId !== 'number' || !validStatus) {
    return reply
      .code(400)
      .send({ error: 'Se requiere cameraId numérico y status ONLINE/OFFLINE.' });
  }

  const camera = await findCamera(body.cameraId);
  if (!camera) {
    return reply.code(404).send({ error: 'Cámara no encontrada.' });
  }

  const previousStatus = camera.status;
  const latencyMs = body.latencyMs ?? body.latency ?? -1;
  const now = new Date();
  const nextStatus = body.status as CameraStatus;

  await db
    .update(cameras)
    .set({
      status: nextStatus,
      latencyMs,
      rtspOpen: body.rtspOpen ?? camera.rtspOpen,
      httpOpen: body.httpOpen ?? camera.httpOpen,
      lastSeen: now,
    })
    .where(eq(cameras.id, camera.id));

  await db.insert(healthLogs).values({
    cameraId: camera.id,
    status: nextStatus,
    latencyMs,
    rtspOpen: body.rtspOpen ?? camera.rtspOpen,
    httpOpen: body.httpOpen ?? camera.httpOpen,
    timestamp: now,
  });

  if (previousStatus !== 'OFFLINE' && nextStatus === 'OFFLINE') {
    const message = `Cámara OFFLINE: ${camera.name} (${camera.ipAddress})`;
    await createAlert(camera.id, message, 'warning');
    await sendTelegramAlert(`⚠️ ${message}`);
  } else if (previousStatus === 'OFFLINE' && nextStatus === 'ONLINE') {
    await createAlert(
      camera.id,
      `Cámara recuperada: ${camera.name} (${camera.ipAddress})`,
      'info',
    );
  }

  app.log.info({ msg: 'heartbeat received', cameraId: camera.id, status: nextStatus });
  return { received: true };
});

async function runHealthMonitor() {
  const rows = await db.select().from(cameras);

  for (const camera of rows) {
    try {
      await checkCameraHealth(camera);
    } catch (error) {
      app.log.warn({ err: error, cameraId: camera.id }, 'Falló la comprobación de salud');
    }
  }
}

const start = async () => {
  try {
    await runMigrations();
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });

    app.log.info(
      { ffmpeg: getFfmpegPath(), ffprobe: getFfprobePath() },
      'FFmpeg localizado',
    );

    setTimeout(() => void runHealthMonitor(), 5_000).unref();
    const timer = setInterval(() => void runHealthMonitor(), HEALTH_INTERVAL_MS);
    timer.unref();

    const shutdown = () => {
      stopAllStreams();
      void app.close().finally(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
