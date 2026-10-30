import express from 'express';
import { initializeRouteQueue } from './route-queue.mjs';
import { initializeDatabase } from './seed-database.mjs';
import { planTrip } from './trips.mjs';
import { loadPlaces } from './places.mjs';
import { validateTrip, validatePlaces } from './travel-input.mjs';
import { operation, requestContext, flush } from './telemetry.mjs';
const app = express();
app.use(express.json({ limit: '16kb' }));
export async function apiHealth() {
  return operation('api.health', async () => ({
    ok: true,
    revision: process.env.TRACEPATH_REVISION,
  }));
}
app.get('/health', async (req, res) => {
  if (!req.headers['x-tracepath-run'])
    return res.json({ ok: true, revision: process.env.TRACEPATH_REVISION });
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    res.json(await apiHealth());
    await flush();
  });
});
app.post('/itineraries', async (req, res) => {
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    try {
      res.status(201).json(await planTrip(validateTrip(req.body)));
    } catch (error) {
      res.status(error.status ?? 503).json({ error: error.message });
    } finally {
      await flush();
    }
  });
});
app.post('/places', async (req, res) => {
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    try {
      res.json(await loadPlaces(validatePlaces(req.body)));
    } catch (error) {
      res.status(error.status ?? 503).json({ error: error.message });
    } finally {
      await flush();
    }
  });
});
await initializeDatabase();
await initializeRouteQueue();
app.listen(4310, '0.0.0.0');
