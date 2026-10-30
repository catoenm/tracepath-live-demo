import pg from 'pg';
import { operation, outgoingHeaders } from './telemetry.mjs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function initializeDatabase() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS demo_orders (id UUID PRIMARY KEY, amount INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  );
}
export async function checkInventory() {
  return operation('inventory.check', async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { available: true };
  });
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
    if (!response.ok) throw new Error(result.error ?? 'Payment failed');
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
    if (input.parallel) {
      // Both spans can be active at once. Wait for both even if one fails.
      const outcomes = await Promise.allSettled([checkInventory(), chargePayment(input)]);
      const failed = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failed) throw failed.reason;
    } else {
      await checkInventory();
      await chargePayment(input);
    }
    return saveOrder(input);
  });
}
