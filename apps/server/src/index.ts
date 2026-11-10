import Fastify from 'fastify';
import dotenv from 'dotenv';

dotenv.config();

const app = Fastify({ logger: true });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramAlert(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

let cameras = [
  { id: 1, name: 'DVR Hikvision', brand: 'Hikvision', ipAddress: '192.168.1.10', status: 'ONLINE', latency: 12 },
  { id: 2, name: 'Tapo C200', brand: 'Tapo', ipAddress: '192.168.1.21', status: 'OFFLINE', latency: -1 },
];
let alerts = [{ id: 1, message: 'Tapo C200 desconectada', severity: 'warning' }];
let history: { cameraId: number; status: string; ts: number }[] = [];

app.get('/health', async () => ({ status: 'ok' }));
app.get('/api/cameras', async () => cameras);
app.get('/api/alerts', async () => alerts);
app.get('/api/history', async () => history);

app.post('/heartbeat', async (req, reply) => {
  const body = req.body as { cameraId: number; status: string; latency: number };
  app.log.info({ msg: 'heartbeat received', ...body });
  history.push({ cameraId: body.cameraId, status: body.status, ts: Date.now() });
  if (body.status === 'OFFLINE') {
    const cam = cameras.find((c) => c.id === body.cameraId);
    await sendTelegramAlert(`⚠️ Cámara OFFLINE: ${cam?.name ?? body.cameraId} (${cam?.ipAddress ?? 'N/A'}) a las ${new Date().toISOString()}`);
  }
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
