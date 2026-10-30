import Redis from 'ioredis';
import { pool } from './database.mjs';
import { operation } from './telemetry.mjs';

const cache = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
});
cache.on('error', (error) => console.error('Inventory cache:', error.message));
const key = 'tracepath:inventory:demo-item';

export async function readCachedInventory() {
  return operation('inventory.cache.read', async () => {
    const value = await cache.get(key);
    return value ? JSON.parse(value) : null;
  });
}

export async function readInventoryDatabase() {
  return operation('inventory.database.read', async () => {
    // Deliberate database latency makes the cold-cache branch easy to see.
    await pool.query('SELECT pg_sleep(0.2)');
    const result = await pool.query('SELECT sku, available FROM demo_inventory WHERE sku = $1', [
      'demo-item',
    ]);
    if (!result.rows[0]) throw new Error('Demo inventory is missing');
    return result.rows[0];
  });
}

export async function cacheInventory(inventory) {
  return operation('inventory.cache.write', async () => {
    await cache.set(key, JSON.stringify(inventory), 'EX', 60);
  });
}

export async function checkInventory() {
  return operation('inventory.check', async () => {
    const cached = await readCachedInventory();
    if (cached) return { ...cached, cache: 'hit' };
    const inventory = await readInventoryDatabase();
    await cacheInventory(inventory);
    return { ...inventory, cache: 'miss' };
  });
}
