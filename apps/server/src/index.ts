import Fastify from 'fastify';

const app = Fastify({ logger: true });

let cameras = [
  { id: 1, name: 'DVR Hikvision', brand: 'Hikvision', status: 'ONLINE', latency: 12 },
  { id: 2, name: 'Tapo C200', brand: 'Tapo', status: 'OFFLINE', latency: -1 },
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
    // TODO: send webhook to Telegram/Discord
    app.log.warn('Camera offline alert');
  }
  return { received: true };
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
