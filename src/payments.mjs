import express from 'express';
import { operation, requestContext, flush } from './telemetry.mjs';
const app = express();
app.use(express.json({ limit: '16kb' }));
export async function authorizePayment(input) {
  return operation('payments.authorize', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (input.payment === 'declined') throw new Error('Card declined by mock payments');
    return { authorized: true, reference: crypto.randomUUID() };
  });
}
export async function paymentsHealth() {
  return operation('payments.health', async () => ({
    ok: true,
    revision: process.env.TRACEPATH_REVISION,
  }));
}
app.get('/health', async (req, res) => {
  if (!req.headers['x-tracepath-run'])
    return res.json({ ok: true, revision: process.env.TRACEPATH_REVISION });
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    res.json(await paymentsHealth());
    await flush();
  });
});
app.post('/charges', async (req, res) => {
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  const { amount, payment } = req.body;
  if (
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 10000 ||
    !['approved', 'declined'].includes(payment)
  )
    return res.status(400).json({ error: 'Invalid payment payload' });
  await requestContext(req.headers, async () => {
    try {
      res.json(await authorizePayment(req.body));
    } catch (error) {
      res.status(402).json({ error: error.message });
    } finally {
      await flush();
    }
  });
});
app.listen(4311, '0.0.0.0');
