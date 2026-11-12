import cors from '@fastify/cors';
import Fastify from 'fastify';
import dotenv from 'dotenv';
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
import { normalizeSubnet, scanLocalSubnet, type ScanResult } from '@cctv/core';

dotenv.config();

const app = Fastify({ logger: true });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

type CameraStatus = 'ONLINE' | 'OFFLINE';
type AlertSeverity = 'info' | 'warning' | 'critical';

interface CameraDto {
  id: number;
  name: string;
  brand: string;
  ipAddress: string;
  status: CameraStatus;
  latencyMs: number;
  rtspOpen: boolean;
  httpOpen: boolean;
  lastSeen: string | null;
  createdAt: string;
}

interface AlertDto {
  id: number;
  cameraId: number | null;
  message: string;
  severity: AlertSeverity;
  acknowledged: boolean;
  timestamp: string;
}

let scanInProgress = false;

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
    status: camera.status as CameraStatus,
    latencyMs: camera.latencyMs,
    rtspOpen: camera.rtspOpen,
    httpOpen: camera.httpOpen,
    lastSeen: camera.lastSeen?.toISOString() ?? null,
    createdAt: camera.createdAt.toISOString(),
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

async function createAlert(
  cameraId: number | null,
  message: string,
  severity: AlertSeverity,
) {
  await db.insert(alerts).values({ cameraId, message, severity, timestamp: new Date() });
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
          brand: result.rtspOpen ? 'RTSP' : 'HTTP',
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

app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

app.get('/api/cameras', async () => {
  const rows = await db.select().from(cameras).orderBy(cameras.id);
  return rows.map(toCameraDto);
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

  const [camera] = await db.select().from(cameras).where(eq(cameras.id, body.cameraId));
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

const start = async () => {
  try {
    await runMigrations();
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
