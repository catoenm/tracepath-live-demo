import { Queue, QueueEvents } from 'bullmq';
import { queueName, queuePrefix, queueConnection, routeWaitMs } from './queue-config.mjs';
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
queue.on('error', (error) => console.error('Route queue:', error.message));
events.on('error', (error) => console.error('Route events:', error.message));
export async function initializeRouteQueue() {
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
}
export async function planRoute(input) {
  return operation('route.wait', async () => {
    try {
      const job = await queue.add(
        'itinerary',
        {
          input,
          trace: traceCarrier(),
          revision: process.env.TRACEPATH_REVISION,
          expiresAt: Date.now() + routeWaitMs,
        },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
      return await job.waitUntilFinished(events, routeWaitMs);
    } catch (cause) {
      throw Object.assign(new Error(`Route planning unavailable: ${cause.message}`, { cause }), {
        status: 503,
      });
    }
  });
}
