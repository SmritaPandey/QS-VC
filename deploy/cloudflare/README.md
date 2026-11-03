# QS-VC on Cloudflare Workers

The root `wrangler.jsonc` deploys a Worker script plus the React frontend. It is
not an assets-only deployment. `/api/health` executes server-side code. Public
`/api/auth`, `/api/meetings`, `/api/recordings`, `/api/sfu` and `/ws` requests are
forwarded to the existing backend. Other API paths return JSON 404 responses.

## Deploy

1. Deploy the existing conferencing services behind one HTTPS backend origin
   with the API and WebSocket routes defined in `nginx/nginx.conf`. Media and TURN
   services still require their own reachable ports and server configuration.
2. In Cloudflare's Git-connected Worker build settings, use the repository root
   and deploy command `npx wrangler deploy`. Wrangler runs `npm run build:web`.
   Do not deploy with an assets-only command such as `wrangler deploy --assets`.
3. After deploying this script, add runtime variable `BACKEND_ORIGIN` under
   Settings → Variables and Secrets. Its value must be the backend HTTPS origin,
   for example `https://backend.example.com`, with no path. It must not point
   back to this Worker or another hostname routed to the same Worker.
4. Leave frontend `VITE_*_URL` overrides unset when building to use the existing
   same-origin auth, meeting-launcher and signaling paths. Existing explicit
   frontend overrides still take precedence and need a rebuild to change.
5. Allow the public frontend origin in backend CORS/WebSocket origin checks.
   Check `/api/health`, account access, meeting creation and a real meeting.

Database passwords, JWT secrets and translation credentials belong on the
existing backend services. Adding them to this Worker does not configure those
services. This gateway does not implement or migrate those services, database,
SFU or TURN, and its health endpoint does not prove backend connectivity.

The admin and recording UI retain pre-existing direct URL/localhost fallbacks;
configure their `VITE_*_URL` values to the public frontend origin if those flows
are needed. They have not been migrated or verified by this gateway change.

Local handler checks: `node --test deploy/cloudflare/worker.test.mjs`.
