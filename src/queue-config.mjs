const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://redis:6379');
export const queueName = 'route';
export const queuePrefix = 'tracepath-jobs';
export const queueConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  connectTimeout: 2000,
};
export const routeWaitMs = 4000;
