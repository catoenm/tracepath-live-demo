# Handoff: connect the travel demo to Tracepath

This repo is authored and tested independently of the Tracepath app. No main-app changes are included. Do not infer live compatibility from a static import.

## Current gaps

1. The app's manifest/request validation currently accepts only `order`, `payment`, and `empty` bodies. This fixture intentionally uses a proposed `payloadKind: "json"` extension for real travel fields. That manifest is not accepted by the current app. Extend the shared request type and bounded JSON validation generically; do not add another hardcoded `travel` payload kind.
2. Runtime execution is registered only for the bundled demo. Add an explicit trusted runner for `catoenm/tracepath-live-demo` at a pinned commit. A repository manifest is metadata, not permission to run arbitrary code.
3. Map manifest operation IDs to the indexed functions using the exact indexed commit. Reject or clearly separate recordings from a different revision. Do not map by display labels or current working-tree line numbers.
4. Poll this environment's lifecycle span feed and attach results to the existing canvas. Preserve request IDs and queue/HTTP parent spans; concurrent requests share topology while retaining independent trace identity.

## Local runner contract

- Compose file: `compose.yaml`; project: `tracepath-public-demo`.
- Startup: `npm start` from a clean, approved checkout. It records a random token and Git revision in ignored `.runtime/state.json`.
- Stop: `npm run stop`; removes this disposable environment, not Tracepath's bundled demo.
- Service origins: travel-api `http://127.0.0.1:4410`, mock-weather `http://127.0.0.1:4411`, receiver `http://127.0.0.1:4412`.
- Headers: `x-demo-token`, `x-tracepath-run` (UUID), `x-tracepath-request` (unique within a batch). The app supplies run/request identity; service-to-service calls carry W3C context.
- Send bodies from the selected endpoint's scenario IDs. GET health uses no body. Each batch contains one to three JSON objects.
- Read `GET /spans/:runId` with `x-demo-token`; events have `traceId`, `spanId`, optional `parentSpanId`, `operation`, `runId`, `requestId`, `revision`, `service`, `startMs`, and completed timing/error fields.
- A single request to `/itineraries` can take several seconds. The worker allows two simultaneous jobs and caps each job wait at four seconds after enqueueing. Preserve simultaneous independent recordings.
- The receiver retains up to 5,000 spans in memory. Persist completed recordings in Tracepath before teardown if they must survive restarts.

Travel payload validation remains owned by this service (`src/travel-input.mjs`). The app should safely bound JSON size/depth, send only to the registered service/endpoint, and display service validation errors. Model-generated suggestions must never execute automatically.

## Acceptance checks in the main app

Import the exact pinned public commit. Verify all twelve operation bindings and all five endpoint bindings, keeping the two health endpoints distinct by service/source. Confirm JSON scenarios are editable. Start the environment explicitly, run sunny/rainy/failure/concurrent presets, and show observed timings in the existing graph. Cold places cache should include Postgres SELECT and Redis SET; warm cache should omit them. Weather failures should have no queue spans; worker failures should have no itinerary INSERT. Queue execution must remain under the initiating request's trace.

The standalone `npm run test:integration` captures these behaviors for runner-independent verification. It does not prove the main-app integration works.
