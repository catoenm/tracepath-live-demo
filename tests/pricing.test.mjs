import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../src/pricing-rules.mjs';

test('pricing preserves cents, applies the threshold discount, and rejects the controlled fault', () => {
  assert.deepEqual(calculatePrice(4900), { originalAmount: 4900, amount: 4900, discount: 0 });
  assert.deepEqual(calculatePrice(5000), { originalAmount: 5000, amount: 4750, discount: 250 });
  assert.equal(calculatePrice(5999).amount, 5700);
  assert.throws(() => calculatePrice(1337), /rejected/);
  for (const value of [0, -1, 10001, 5.5, '5000'])
    assert.throws(() => calculatePrice(value), /Invalid/);
});
