# GOMROK Operations Runbook

## Local review

1. Run `npm --workspace client run dev`.
2. Open `http://127.0.0.1:5083/app/preview`.
3. Use the hub to inspect all six panels and public/onboarding routes without registering.

## Production release checks

1. Provide private production environment values outside source control.
2. Back up MySQL and verify restore procedure before schema rollout.
3. Run `npm test`, `npm audit`, and `npm run build`.
4. Run migrations once against the intended database.
5. Publish `client/dist` under `/app/` and start the API with `NODE_ENV=production`.
6. Verify API health, login, membership scope, one read-only case request, and one authorized low-risk mutation.
7. Monitor correlation IDs, authentication failures, governance audit events, real-time connection count, database readiness, and error rate.

## Rollback

The redesign is frontend-only. Retain the backup archive at `backups/gomrok-current-ui-before-full-redesign-2026-08-31.zip`; restore the previous frontend assets if visual rollback is required. No database rollback is needed because the redesign introduced no migration.
