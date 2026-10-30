import { Worker } from 'bullmq';
import { writeFileSync, rmSync } from 'node:fs';
import { queueName, queuePrefix, queueConnection } from './queue-config.mjs';
import { calculateRoute } from './route-rules.mjs';
import { operation, requestContext, flush } from './telemetry.mjs';
export async function calculateItinerary(job) {
  return operation('route.calculate', async () => {
    if (job.revision !== process.env.TRACEPATH_REVISION) throw new Error('Job revision mismatch');
    if (Date.now() >= job.expiresAt) throw new Error('Route request already expired');
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (Date.now() >= job.expiresAt) throw new Error('Route deadline exceeded');
    return calculateRoute(job.input);
  });
}
const worker = new Worker(
  queueName,
  (job) =>
    requestContext(job.data.trace, async () => {
      try {
        return await calculateItinerary(job.data);
      } finally {
        await flush();
      }
    }),
  {
    prefix: queuePrefix,
    connection: { ...queueConnection, maxRetriesPerRequest: null },
    concurrency: 2,
  },
);
worker.on('error', (error) => console.error('Route worker:', error.message));
await worker.waitUntilReady();
writeFileSync('/tmp/route-ready', process.env.TRACEPATH_REVISION);
console.log('Route worker ready, concurrency 2');
process.on('SIGTERM', async () => {
  rmSync('/tmp/route-ready', { force: true });
  await worker.close();
  await flush();
  process.exit(0);
});
