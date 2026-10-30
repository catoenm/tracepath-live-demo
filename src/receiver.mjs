import express from 'express';
const app = express();
const spans = new Map();
app.use(express.json({ limit: '32kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((req, res, next) =>
  req.headers['x-demo-token'] === process.env.TRACEPATH_DEMO_TOKEN ? next() : res.sendStatus(401),
);
app.post('/spans', (req, res) => {
  const span = req.body;
  if (
    !/^[a-f0-9]{32}$/.test(span.traceId) ||
    !/^[a-f0-9]{16}$/.test(span.spanId) ||
    span.revision !== process.env.TRACEPATH_REVISION
  )
    return res.sendStatus(400);
  const key = `${span.traceId}:${span.spanId}`;
  const previous = spans.get(key);
  // Network delivery can reorder start/end. Never overwrite a completed span with a start.
  if (!previous?.endMs || span.endMs) spans.set(key, span);
  while (spans.size > 5000) spans.delete(spans.keys().next().value);
  res.sendStatus(202);
});
app.get('/spans/:runId', (req, res) =>
  res.json([...spans.values()].filter((span) => span.runId === req.params.runId)),
);
app.listen(4312, '0.0.0.0');
