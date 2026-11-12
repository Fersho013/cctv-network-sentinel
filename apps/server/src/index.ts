import cors from '@fastify/cors';
import Fastify from 'fastify';
import dotenv from 'dotenv';
import { normalizeSubnet, scanLocalSubnet, type ScanResult } from '@cctv/core';

dotenv.config();

const app = Fastify({ logger: true });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

type CameraStatus = 'ONLINE' | 'OFFLINE';
type AlertSeverity = 'info' | 'warning' | 'critical';

interface Camera {
  id: number;
  name: string;
  brand: string;
  ipAddress: string;
  status: CameraStatus;
  latencyMs: number;
  rtspOpen: boolean;
  httpOpen: boolean;
  lastSeen: string | null;
}

interface Alert {
  id: number;
  cameraId: number | null;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
}

interface HistoryEntry {
  cameraId: number;
  status: CameraStatus;
  latencyMs: number;
  ts: number;
}

const cameras: Camera[] = [];
const alerts: Alert[] = [];
const history: HistoryEntry[] = [];

let nextCameraId = 1;
let nextAlertId = 1;
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

function pushAlert(message: string, severity: AlertSeverity, cameraId: number | null = null) {
  alerts.unshift({
    id: nextAlertId++,
    cameraId,
    message,
    severity,
    timestamp: new Date().toISOString(),
  });

  if (alerts.length > 200) alerts.length = 200;
}

function isCameraCandidate(result: ScanResult) {
  return result.status === 'ONLINE' && (result.rtspOpen || result.httpOpen);
}

function applyScanResults(results: ScanResult[], subnet: string) {
  const now = new Date().toISOString();
  const candidates = results.filter(isCameraCandidate);
  const seenCameraIds = new Set<number>();
  let added = 0;
  let updated = 0;
  let offline = 0;

  for (const result of candidates) {
    let camera = cameras.find((item) => item.ipAddress === result.ip);

    if (!camera) {
      camera = {
        id: nextCameraId++,
        name: `Cámara ${result.ip}`,
        brand: result.rtspOpen ? 'RTSP' : 'HTTP',
        ipAddress: result.ip,
        status: 'ONLINE',
        latencyMs: result.latencyMs,
        rtspOpen: result.rtspOpen,
        httpOpen: result.httpOpen,
        lastSeen: now,
      };
      cameras.push(camera);
      added++;
    } else {
      if (camera.status === 'OFFLINE') {
        pushAlert(
          `Cámara recuperada: ${camera.name} (${camera.ipAddress})`,
          'info',
          camera.id,
        );
      }

      camera.status = 'ONLINE';
      camera.latencyMs = result.latencyMs;
      camera.rtspOpen = result.rtspOpen;
      camera.httpOpen = result.httpOpen;
      camera.lastSeen = now;
      updated++;
    }

    seenCameraIds.add(camera.id);
  }

  for (const camera of cameras) {
    const belongsToScan = camera.ipAddress.startsWith(subnet);
    if (!belongsToScan || seenCameraIds.has(camera.id) || camera.status === 'OFFLINE') continue;

    camera.status = 'OFFLINE';
    camera.latencyMs = -1;
    camera.lastSeen = now;
    offline++;

    const message = `Cámara OFFLINE: ${camera.name} (${camera.ipAddress})`;
    pushAlert(message, 'warning', camera.id);
    void sendTelegramAlert(`⚠️ ${message}`);
  }

  return { added, updated, offline };
}

app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));
app.get('/api/cameras', async () => cameras);
app.get('/api/alerts', async () => alerts);
app.get('/api/history', async () => history.slice(-200).reverse());
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
    const summary = applyScanResults(results, subnet);

    return {
      subnet,
      durationMs: Date.now() - startedAt,
      scannedAt: new Date().toISOString(),
      totalHosts: results.length,
      onlineHosts: results.filter((result) => result.status === 'ONLINE').length,
      candidates: results.filter(isCameraCandidate),
      summary,
    };
  } finally {
    scanInProgress = false;
  }
});

app.post<{
  Body?: { cameraId?: number; status?: CameraStatus; latency?: number; latencyMs?: number };
}>('/heartbeat', async (req, reply) => {
  const body = req.body;
  const validStatus = body?.status === 'ONLINE' || body?.status === 'OFFLINE';

  if (!body || typeof body.cameraId !== 'number' || !validStatus) {
    return reply
      .code(400)
      .send({ error: 'Se requiere cameraId numérico y status ONLINE/OFFLINE.' });
  }

  const camera = cameras.find((item) => item.id === body.cameraId);
  if (!camera) {
    return reply.code(404).send({ error: 'Cámara no encontrada.' });
  }

  const previousStatus = camera.status;
  const latencyMs = body.latencyMs ?? body.latency ?? -1;
  const now = new Date().toISOString();

  camera.status = body.status as CameraStatus;
  camera.latencyMs = latencyMs;
  camera.lastSeen = now;
  history.push({ cameraId: camera.id, status: camera.status, latencyMs, ts: Date.now() });

  if (previousStatus !== 'OFFLINE' && camera.status === 'OFFLINE') {
    const message = `Cámara OFFLINE: ${camera.name} (${camera.ipAddress})`;
    pushAlert(message, 'warning', camera.id);
    await sendTelegramAlert(`⚠️ ${message}`);
  } else if (previousStatus === 'OFFLINE' && camera.status === 'ONLINE') {
    pushAlert(`Cámara recuperada: ${camera.name} (${camera.ipAddress})`, 'info', camera.id);
  }

  app.log.info({ msg: 'heartbeat received', cameraId: camera.id, status: camera.status });
  return { received: true };
});

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
