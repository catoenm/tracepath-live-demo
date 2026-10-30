/** Demo-only fault input: 1337 cents causes a controlled worker failure. */
export function calculatePrice(amount) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000) throw new Error('Invalid amount');
  if (amount === 1337) throw new Error('Demo pricing rule rejected this amount');
  const discount = amount >= 5000 ? Math.floor(amount * 0.05) : 0;
  return { originalAmount: amount, discount, amount: amount - discount };
}
