# GOMROK Deployment Readiness

## Build and runtime

- Install: `npm install`
- Frontend production build: `npm run build`
- Database schema: `npm --workspace server run db:migrate`
- API start: `npm start`
- Local development: `npm run dev`

The frontend remains compatible with the existing Vite production base `/app/`. The PWA manifest, theme color, description, title, and SVG application mark now match Route Pulse.

## Configuration and safety

- `.env.example` and `server/.env.example` contain placeholders only.
- Production config rejects missing/short JWT, step-up, and administrator secrets.
- MySQL Compose configuration requires a root password and mounts the schema read-only.
- CORS remains allowlisted and configurable through `CLIENT_ORIGINS`.
- No new environment variable or secret is required by the redesign.

## Validation

- `docker compose config --quiet`: PASS with a validation-only process environment value.
- Production config import with strong validation-only placeholders: PASS.
- Vite production build: PASS.
- Vite production preview base and `/app/assets/*` JavaScript response: PASS.
- Frontend deployment: PASS on 2026-09-05; the active IIS release path was discovered, the `/app` build was atomically replaced, and the previous app directory was retained as a server-side backup.
- Backend deployment: PASS on 2026-09-05; the API source was atomically replaced while preserving the existing server `.env`, dependencies, scheduled task and runtime configuration. `GomrokAppApi` restarted successfully.
- Remote database migration: PASS; the existing idempotent migration completed before the backend restart.
- Live smoke checks: PASS; `/app/driver` and `/app/careers` served the current hashed assets, registration artwork returned `200`, the manifest uses `/app`, the service worker cache is `v3`, and `/app/api/auth/refresh` returned an expected `401` for an invalid token rather than `404`.

STAGE_11_STATUS: PASS
NEXT_STAGE: 12-fullstack-final-review
