import { pool } from './database.mjs';
const places = {
  lisbon: [
    ['Tile Museum', 'culture', true],
    ['Gulbenkian Museum', 'culture', true],
    ['Alfama walk', 'outdoors', false],
    ['Belem waterfront', 'outdoors', false],
    ['Time Out Market', 'food', true],
    ['Estrela Garden', 'outdoors', false],
  ],
  kyoto: [
    ['Railway Museum', 'culture', true],
    ['Manga Museum', 'culture', true],
    ['Philosopher’s Path', 'outdoors', false],
    ['Arashiyama walk', 'outdoors', false],
    ['Nishiki Market', 'food', true],
    ['Botanical Gardens', 'outdoors', false],
  ],
  reykjavik: [
    ['National Museum', 'culture', true],
    ['Art Museum', 'culture', true],
    ['Sculpture shore walk', 'outdoors', false],
    ['Tjornin lake walk', 'outdoors', false],
    ['Food hall', 'food', true],
    ['Botanical Garden', 'outdoors', false],
  ],
};
export async function initializeDatabase() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS demo_places (id TEXT PRIMARY KEY, destination TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, indoor BOOLEAN NOT NULL)',
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS demo_itineraries (id UUID PRIMARY KEY, destination TEXT NOT NULL, itinerary JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  );
  for (const [destination, rows] of Object.entries(places)) {
    for (const [index, [name, category, indoor]] of rows.entries()) {
      await pool.query('INSERT INTO demo_places VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
        `${destination}-${index + 1}`,
        destination,
        name,
        category,
        indoor,
      ]);
    }
  }
}
