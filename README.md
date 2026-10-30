# Tracepath live demo

A small, fully annotated business flow for testing code exploration and real request timing:

```text
POST /orders → createOrder
                ├─ checkInventory
                ├─ chargePayment → mock payments POST /charges → authorizePayment
                └─ saveOrder → Postgres INSERT (only after approval)
```

All four API/payments endpoints and all seven named business operations have OpenTelemetry spans. Infrastructure helpers and the telemetry receiver itself are not recursively instrumented. No real payment provider or production database is used.

## Run locally

Requires Node.js 24+, Git, and Docker Compose (Docker Desktop or Colima). No host npm install is needed to run the Docker demo.

```sh
git clone https://github.com/catoenm/tracepath-live-demo.git
cd tracepath-live-demo
npm start
npm run scenarios
npm run stop
```

`npm start` builds the image, starts an API, mock payments service, disposable Postgres, and a telemetry receiver. It creates a random local access token in ignored `.runtime/state.json`, and puts the current Git commit in every span. It refuses a dirty checkout: commit changes and restart to keep source and recordings aligned. The services verify the configured revision; this is source identity metadata, not cryptographic process attestation.

| Service | Local address | Instrumented endpoints |
| --- | --- | --- |
| Orders API | `http://127.0.0.1:4410` | `POST /orders`, `GET /health` |
| Mock payments | `http://127.0.0.1:4411` | `POST /charges`, `GET /health` |
| Telemetry receiver | `http://127.0.0.1:4412` | Internal collection only |
| Postgres | Docker network only | Queries inside `orders.save` |

These ports and the `tracepath-public-demo` Compose project are separate from Tracepath's bundled demo. Stop removes this demo's containers and disposable database; it does not affect the bundled demo. There is no automatic idle shutdown for this standalone environment. Use `npm run stop` when finished.

## Scenarios and evidence

`npm run scenarios` sends every manifest preset, then overlaps three independent order batches. It verifies:

- Successful orders return 201 and actually insert rows into Postgres.
- Declined orders return 402 and never call `orders.save`.
- Concurrent orders and payments retain independent trace and request IDs.
- Inventory and payment work overlap when `parallel` is true.
- HTTP calls retain their W3C trace parent across API and payment containers.
- Both health endpoints produce one correctly mapped span.
- Operation IDs, service names, source revision, timings, and span completion are consistent.
- Unauthorized order creation returns 401.

Recordings are saved to ignored `.runtime/recordings.json`. The receiver exposes `GET /spans/:runId` with the local `x-demo-token` header. The file contains captured evidence, not generated timing values. The demo uses intentional delays, including `pg_sleep`, to make concurrent work visible; these timings are not production benchmarks.

The presets are in `tracepath.runtime.json`. Each request batch contains one to three bodies:

```json
[
  { "amount": 4900, "payment": "approved", "parallel": false }
]
```

Orders accept amount in cents (1–10000), payment (`approved`/`declined`), and parallel (boolean). Direct charges omit `parallel`; they only authorize payment and never write an order. Health presets use `[{}]` and send bodyless GET requests. Container health probes do not create telemetry.

## Import into Tracepath

Import `https://github.com/catoenm/tracepath-live-demo` with the default-off live compatibility check enabled. The manifest binds each endpoint by method, route, and source file, so the two `/health` routes remain distinct. It names the root operation, payload kind, and allowed sample IDs.

**Current integration limit:** Tracepath can import this repository, validate its source annotations, and show its static graph and “Live configured” badge. Its current execution runner is registered only for the bundled `examples/live-demo`. Importing this repo does **not** enable the app's Run request controls or attach this standalone environment automatically. That requires an explicit trusted runner registration, source-revision checks, and collection of this environment's spans. Nothing in the manifest grants permission to execute arbitrary imported code.

Static call analysis may stop at callback wrappers; recorded spans show actual execution of the annotated functions. An unmeasured node is not evidence that it was skipped. Request timing covers each operation boundary, not every source statement or a separate server-side database span.

## Annotate another operation

```js
export async function saveOrder(input) {
  return operation('orders.save', async () => {
    // Database work goes here.
  });
}
```

Keep the literal ID inside a named function. Add the same ID to the manifest with its source `path`, exact `symbol`, label, service, and kind (`internal`, `http`, or `database`). A destination such as `Postgres` labels a dependency. Preserve existing IDs when renaming display labels.

`src/telemetry.mjs` uses the OpenTelemetry SDK and propagates request context over HTTP. A thin processor publishes both span starts and completed SDK spans to our receiver. This JSON lifecycle bridge is not an OTLP collector. Errors are recorded and rethrown; spans close in `finally`. Only approved orders reach the database.

## Checks

```sh
npm test                # Manifest, source wrapper, and payload consistency
npm run build          # Syntax-check all JavaScript modules; no transpilation needed
npm run test:integration # Full Docker scenarios; run npm start first
```

This fixture is plain JavaScript. `build` is a syntax check, not a TypeScript typecheck. Tracepath's own analyzer and runtime-compatibility validator provide the separate source-to-graph binding check during import.
