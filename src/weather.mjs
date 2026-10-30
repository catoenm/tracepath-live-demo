import express from 'express';
import { validateWeather } from './travel-input.mjs';
import { operation, requestContext, flush } from './telemetry.mjs';
const app = express();
app.use(express.json({ limit: '16kb' }));
export async function forecastWeather(input) {
  return operation('weather.forecast', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (input.condition === 'unavailable')
      throw Object.assign(new Error('Mock weather provider unavailable'), { status: 503 });
    return {
      destination: input.destination,
      condition: input.condition,
      temperatureC: input.condition === 'rain' ? 14 : 22,
      mock: true,
    };
  });
}
export async function weatherHealth() {
  return operation('weather.health', async () => ({
    ok: true,
    revision: process.env.TRACEPATH_REVISION,
  }));
}
app.get('/health', async (req, res) => {
  if (!req.headers['x-tracepath-run'])
    return res.json({ ok: true, revision: process.env.TRACEPATH_REVISION });
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    res.json(await weatherHealth());
    await flush();
  });
});
app.post('/forecast', async (req, res) => {
  if (req.headers['x-demo-token'] !== process.env.TRACEPATH_DEMO_TOKEN) return res.sendStatus(401);
  await requestContext(req.headers, async () => {
    try {
      res.json(await forecastWeather(validateWeather(req.body)));
    } catch (error) {
      res.status(error.status ?? 503).json({ error: error.message });
    } finally {
      await flush();
    }
  });
});
app.listen(4311, '0.0.0.0');
