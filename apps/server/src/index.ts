import Fastify from 'fastify';

const app = Fastify({ logger: true });

let cameras = [
  { id: 1, name: 'DVR Hikvision', status: 'ONLINE', latency: 12 },
  { id: 2, name: 'Tapo C200', status: 'OFFLINE', latency: -1 },
];
let alerts = [{ id: 1, message: 'Tapo C200 desconectada', severity: 'warning' }];

app.get('/health', async () => ({ status: 'ok' }));
app.get('/api/cameras', async () => cameras);
app.get('/api/alerts', async () => alerts);

app.post('/heartbeat', async (req, reply) => {
  const body = req.body as { cameraId: number; status: string; latency: number };
  app.log.info({ msg: 'heartbeat received', ...body });
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
