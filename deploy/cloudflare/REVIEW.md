# Worker gateway handoff

Scope: `wrangler.jsonc`, `deploy/cloudflare/worker.mjs`, its handler tests and
deployment instructions. Connected paths inspected: frontend auth session,
meeting creation/scheduling, signaling URL selection, existing Nginx API and
WebSocket routes. This is a self-review, not an independent audit or website QA.
Assumed load: concurrent meeting participants making HTTP calls and maintaining
signaling connections. Media traffic stays on the existing conferencing server.

- Correctness: handler tests pass for asset fallback, runtime health, API routing,
  invalid/missing configuration, request method/body/query/auth preservation,
  upgrade-header preservation and upstream network failures.
- Security/data loss: destination comes only from operator configuration, HTTPS
  is required, credentials in the URL and direct same-host recursion are rejected.
  Unknown/internal API prefixes are blocked. Redirects are returned without
  following them with participant authorization. Backend authorization remains
  required. No new data storage or credential handling was added.
- Expected load/concurrency: handler is stateless, streams requests/responses and
  keeps no per-user collections. No load or real WebSocket lifetime test ran.
- Missing tests: actual Cloudflare WebSocket upgrade forwarding, cookies and
  browser/backend origin checks require a deployed backend and Cloudflare runtime.
  Unit checks only prove header forwarding, not a successful WebSocket handshake.
- Speed: static files keep Cloudflare's direct asset path. No buffering or new
  dependency was added. Cloudflare request limits and latency were not measured.
- Lean structure: one native fetch handler reuses the existing backend routes;
  no service, authentication or database logic is duplicated.

Validation: three Node test cases pass; `npm run build:web` passes with the
existing large-bundle warning; `git diff --check` passes. Wrangler is not installed
locally, so deployment packaging and execution in Cloudflare remain unverified.

Verdict: local gateway preparation complete; live functionality requires deploying
the Worker and setting a reachable `BACKEND_ORIGIN`. Other backend host aliases
must not route back to this Worker. Admin/recording frontend localhost fallbacks
remain documented deployment limitations, outside this gateway change.

Not checked: live deployment, real calls, backend provisioning, database/media/TURN
operation, performance under load, unrelated working-tree changes.
