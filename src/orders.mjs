import { pool } from './database.mjs';
import { checkInventory } from './inventory.mjs';
import { priceOrder } from './pricing-queue.mjs';
import { operation, outgoingHeaders } from './telemetry.mjs';
export async function initializeDatabase() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS demo_orders (id UUID PRIMARY KEY, amount INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS demo_inventory (sku TEXT PRIMARY KEY, available BOOLEAN NOT NULL)',
  );
  await pool.query("INSERT INTO demo_inventory VALUES ('demo-item', true) ON CONFLICT DO NOTHING");
}
export async function chargePayment(input) {
  return operation('payments.charge', async () => {
    const response = await fetch(`${process.env.PAYMENTS_URL}/charges`, {
      method: 'POST',
      headers: outgoingHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error ?? 'Payment failed');
      error.status = response.status === 402 ? 402 : 502;
      throw error;
    }
    return result;
  });
}
export async function saveOrder(input) {
  return operation('orders.save', async () => {
    // The deliberate delay keeps this small demo visible; the INSERT really reaches Postgres.
    await pool.query('SELECT pg_sleep(0.45)');
    const result = await pool.query(
      'INSERT INTO demo_orders (id, amount) VALUES ($1, $2) RETURNING id, amount',
      [crypto.randomUUID(), input.amount],
    );
    return result.rows[0];
  });
}
export async function createOrder(input) {
  return operation('orders.create', async () => {
    let inventory;
    let quote;
    if (input.parallel) {
      // Inventory and the queued pricing calculation are independent.
      const outcomes = await Promise.allSettled([checkInventory(), priceOrder(input)]);
      const failed = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failed) throw failed.reason;
      [inventory, quote] = outcomes.map((outcome) => outcome.value);
    } else {
      inventory = await checkInventory();
      quote = await priceOrder(input);
    }
    if (!inventory.available) throw new Error('Inventory unavailable');
    const pricedOrder = { ...input, amount: quote.amount };
    const payment = await chargePayment(pricedOrder);
    const order = await saveOrder(pricedOrder);
    return { ...order, inventory, quote, payment };
  });
}
