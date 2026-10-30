# Tracepath travel planner

A runnable, instrumented travel-planning fixture: Express API, Redis places cache, Postgres, a BullMQ route worker, and a mock weather service. No API keys, paid services, or live weather are required.

```text
POST /itineraries → planTrip
  ├─ loadPlaces → Redis GET
  │               └─ miss → Postgres SELECT → Redis SET (60-second TTL)
  ├─ fetchWeather → mock weather POST /forecast
  ├─ planRoute → BullMQ / Redis → separate route worker → daily itinerary
  │              API awaits completion (4-second job wait limit)
  └─ saveItinerary → Postgres INSERT
```

`parallel: true` overlaps places and weather. Rain selects indoor stops. Weather failure stops before queueing; worker failure stops before saving. Twelve named operations emit real OpenTelemetry spans with trace context propagated across HTTP and queue messages.

**Tracepath integration status:** This repository runs independently in Docker. Static import is supported by Tracepath's JavaScript analyzer, but the current app does **not** support this travel manifest's `payloadKind: "json"` extension or have a runner registered for this repository. Importing it does not currently enable Live mode. The main app needs the changes in [the integration handoff](docs/tracepath-integration.md); those changes are deliberately outside this repository.

## Start

Requires Node.js 24+, Git, and Docker Compose. No host dependency installation is needed for these scripts; dependencies install inside Docker.

```sh
git clone https://github.com/catoenm/tracepath-live-demo.git
cd tracepath-live-demo
npm start
npm run request -- rain
npm run test:integration
npm run stop
```

Startup requires a clean checkout and embeds its Git commit in every service and span. It generates an access token in ignored `.runtime/state.json` (mode 0600). The receiver rejects other revisions. Commit source changes and restart before collecting new traces; revision metadata is not cryptographic process attestation.

| Service            | Address                 | Endpoints                                          |
| ------------------ | ----------------------- | -------------------------------------------------- |
| Travel API         | `http://127.0.0.1:4410` | `POST /itineraries`, `POST /places`, `GET /health` |
| Mock weather       | `http://127.0.0.1:4411` | `POST /forecast`, `GET /health`                    |
| Telemetry receiver | `http://127.0.0.1:4412` | Internal collection and `GET /spans/:runId`        |
| Redis              | Docker network only     | Places cache and BullMQ queue                      |
| Postgres           | Docker network only     | Seeded places and saved itineraries                |
| Route worker       | Docker network only     | Two concurrent planning jobs                       |

The isolated Compose project is `tracepath-public-demo`. Stopping removes only this project's containers and disposable database, including any old service names left by a previous version. It does not affect Tracepath's bundled demo. There is no automatic idle shutdown: run `npm run stop` when finished.

## Requests

`POST /itineraries`:

```json
{
  "destination": "kyoto",
  "days": 2,
  "preference": "culture",
  "weather": "rain",
  "parallel": true
}
```

- Destinations: `lisbon`, `kyoto`, `reykjavik`; six seeded places per destination.
- Days: integer 1–5. Preference: `balanced`, `culture`, `outdoors`.
- Weather: `sunny`, `rain`, `unavailable`. This explicitly controls a mock provider.
- `parallel`: whether places and forecast are fetched concurrently.
- Optional `simulatePlannerFailure: true`: controlled worker failure.

Success returns HTTP 201 with a saved UUID, daily stops, forecast, and `placesCache: "hit" | "miss"`. Invalid input returns 400, weather failure 502, and route failure/timeout 503.

`POST /places` takes `{"destination":"lisbon"}` and returns cached or database-backed places. `POST /forecast` takes `{"destination":"lisbon","condition":"rain"}`; `unavailable` returns 503 directly from the mock service. Both `/health` endpoints are separately annotated. Routine container health probes do not emit spans.

Business requests and trace retrieval require the local `x-demo-token`. The request script supplies it without printing it, creates run/request IDs, and prints the result plus a recording ID:

```sh
npm run request -- success
npm run request -- rain
npm run request -- weather.failure
npm run request -- planner.failure
npm run request -- concurrent
npm run request -- places.kyoto
npm run request -- forecast.concurrent
```

All fourteen presets are in `tracepath.runtime.json`. Bodies are ordinary JSON, not disguised order/payment payloads. The latest manually requested recording is saved in ignored `.runtime/last-request.json`.

## Checks

```sh
npm test                  # Source bindings, request validation, itinerary behavior
npm run build             # JavaScript syntax validation; no TypeScript/transpilation
npm run test:integration  # Running Docker services required
```

Integration checks verify:

- Cold cache reads Postgres and populates Redis; warm cache skips both operations.
- Rain produces indoor itineraries; the exact worker result is persisted in Postgres.
- Weather failures never enqueue; worker failures never save itineraries.
- Queue and HTTP handoffs preserve trace parentage, request IDs, service names, and revision.
- Running span events arrive before completion, enabling live highlighting.
- Concurrent travelers have separate traces and overlap; the worker runs at most two jobs.
- A paused worker makes the API time out. It is resumed in `finally`, rejects the expired job, and never writes an itinerary later.
- Bad credentials and invalid travel inputs are rejected.

Run integration checks when nobody else is using this standalone demo: they clear only its three places-cache keys, create disposable itineraries, and briefly pause its worker. Captured evidence goes to `.runtime/recordings.json`.

## Source and telemetry

Modules are small and explicit: `places.mjs` owns cache-aside reads, `trips.mjs` orchestrates the API flow, `route-queue.mjs` submits jobs, `route-worker.mjs` executes them, and `route-rules.mjs` contains the pure planning rules. `seed-database.mjs` creates fixture data. `weather.mjs` is a separate mock HTTP service.

Add a named operation with a literal, stable ID:

```js
export async function saveItinerary(itinerary) {
  return operation('trip.save', async () => {
    // Work being measured.
  });
}
```

Bind that ID to the function's exact `path` and `symbol` in the manifest. Display labels can change without changing IDs. `src/telemetry.mjs` uses the OpenTelemetry SDK; a small span processor sends both start and completed events to the receiver. This JSON lifecycle bridge is not an OTLP collector. Errors are recorded and rethrown, and spans close in `finally`. Infrastructure setup and telemetry delivery are not recursively traced.

## Deliberate limits

The planner ranks a small fixture list and allocates two stops per day; it is not a geographic optimization service and can repeat stops on longer trips. Place names are illustrative, with no opening-hours or distance claims. Weather is entirely mocked. Intentional delays, including `pg_sleep`, make execution visible and are not performance benchmarks.

Redis caches places for 60 seconds and also hosts BullMQ with a separate queue key prefix and `noeviction`. Places are seeded and not edited through the API. Cold concurrent requests may all miss; there is no cache-stampede lock. The database and Redis are disposable and not suitable for production persistence.

The API asynchronously awaits the worker's result without blocking Node's event loop. The wait is bounded to four seconds after enqueue, with Redis command retries/timeouts bounded separately. Jobs include W3C context, revision, and a deadline, but no HTTP access token. Timing out the wait does not cancel a job; the worker checks expiry before and after calculation and has no database credentials. Completed/failed retention is bounded, with one attempt per job. See [BullMQ job completion](https://docs.bullmq.io/api/classes/v5.Job.html#waitUntilFinished) and [connection guidance](https://docs.bullmq.io/guide/connections).

Static analysis may stop at callbacks or queue boundaries. Only runtime evidence proves a path was executed. Redis uses operation kind `database` with destination `Redis cache`; BullMQ uses `internal` with destination `BullMQ / Redis`, pending a dedicated queue kind in Tracepath.
