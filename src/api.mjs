import express from 'express';
import { createOrder, initializeDatabase } from './orders.mjs';
import { operation, requestContext, flush } from './telemetry.mjs';
const app = express();
app.use(express.json({ limit: '16kb' }));
export async function apiHealth() {
  return operation('api.health', async () => ({ ok: true, revision: process.env.TRACEPATH_REVISION }));
}
app.get('/health', async (req, res) => {
  if (!req.headers['x-tracepath-run']) return res.json({ ok: true, revision: process.env.TRACEPATH_REVISION });
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    res.json(await apiHealth());
    await flush();
  });
});
app.post('/orders', async (req, res) => {
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  const { amount, payment, parallel } = req.body;
  if (
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 10000 ||
    !['approved', 'declined'].includes(payment) ||
    typeof parallel !== 'boolean'
  )
    return res.status(400).json({ error: 'Invalid demo payload' });
  await requestContext(req.headers, async () => {
    try {
      res.status(201).json(await createOrder({ amount, payment, parallel }));
    } catch (error) {
      res.status(402).json({ error: error.message });
    } finally {
      await flush();
    }
  });
});
await initializeDatabase();
app.listen(4310, '0.0.0.0');
