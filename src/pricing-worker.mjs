import { Worker } from 'bullmq';
import { writeFileSync, rmSync } from 'node:fs';
import { queueName, queuePrefix, queueConnection } from './queue-config.mjs';
import { calculatePrice } from './pricing-rules.mjs';
import { operation, requestContext, flush } from './telemetry.mjs';

export async function calculateQuote(input) {
  return operation('pricing.calculate', async () => {
    if (input.revision !== process.env.TRACEPATH_REVISION) throw new Error('Job revision mismatch');
    if (Date.now() >= input.expiresAt) throw new Error('Pricing request already expired');
    // Pure calculation: a late job can never charge a payment or create an order.
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (Date.now() >= input.expiresAt) throw new Error('Pricing deadline exceeded');
    return calculatePrice(input.amount);
  });
}

const worker = new Worker(
  queueName,
  (job) =>
    requestContext(job.data.trace, async () => {
      try {
        return await calculateQuote(job.data);
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
worker.on('error', (error) => console.error('Pricing worker:', error.message));
await worker.waitUntilReady();
writeFileSync('/tmp/pricing-ready', process.env.TRACEPATH_REVISION);
console.log('Pricing worker ready, concurrency 2');
process.on('SIGTERM', async () => {
  rmSync('/tmp/pricing-ready', { force: true });
  await worker.close();
  await flush();
  process.exit(0);
});
