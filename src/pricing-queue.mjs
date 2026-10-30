import { Queue, QueueEvents } from 'bullmq';
import { queueName, queuePrefix, queueConnection, pricingWaitMs } from './queue-config.mjs';
import { operation, traceCarrier } from './telemetry.mjs';

const queue = new Queue(queueName, {
  prefix: queuePrefix,
  connection: {
    ...queueConnection,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 2000,
  },
});
const events = new QueueEvents(queueName, {
  prefix: queuePrefix,
  connection: { ...queueConnection, maxRetriesPerRequest: null },
});
queue.on('error', (error) => console.error('Pricing queue:', error.message));
events.on('error', (error) => console.error('Pricing events:', error.message));

export async function initializePricingQueue() {
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
}

export async function priceOrder(input) {
  return operation('pricing.wait', async () => {
    try {
      const job = await queue.add(
        'quote',
        {
          amount: input.amount,
          trace: traceCarrier(),
          revision: process.env.TRACEPATH_REVISION,
          expiresAt: Date.now() + pricingWaitMs,
        },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
      return await job.waitUntilFinished(events, pricingWaitMs);
    } catch (cause) {
      const error = new Error(`Pricing unavailable: ${cause.message}`, { cause });
      error.status = 503;
      throw error;
    }
  });
}
