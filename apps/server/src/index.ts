import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

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
