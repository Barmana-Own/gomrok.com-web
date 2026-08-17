# Gomrok.org

Mobile-first customs and transport platform foundation.

## Stack

- `client/`: React + Vite
- `server/`: Node.js + Express
- `server/schema.sql`: MySQL schema for driver/carrier auth and CRM foundation
- `docker-compose.yml`: MySQL 8.4 container with a persistent volume

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start MySQL in Docker:

   ```bash
   docker compose up -d mysql
   ```

   The local Compose password is `gomrok_dev_only_change_me`. Set `DB_PASSWORD` to the same value in `server/.env` (and keep `DB_PORT=3306`). Change it before sharing the environment.

3. Create the database tables:

   ```bash
   npm --workspace server run db:migrate
   ```

4. Start the API and React app:

   ```bash
   npm run dev
   ```

The React mobile app runs on `http://127.0.0.1:5083`. The API runs on `http://127.0.0.1:4000`.

The current `/app/driver` and `/app/careers` flows collect the requested base information as pending registration requests. An admin must approve a request before the driver or carrier account is created. The admin workspace at `/admin/v2` has separate راننده‌ها and باربری‌ها sections and supports editing, approval, rejection, enable/disable, deletion and separate Excel-compatible exports.

Carrier auth endpoints:

- `POST /api/auth/register-carrier`
- `POST /api/auth/login-carrier`

Registration endpoints:

- `POST /api/registrations/driver`
- `POST /api/registrations/carrier`
- `PATCH /api/admin/registrations/:role/:id/status`
- `PUT /api/admin/registrations/:role/:id`
- `DELETE /api/admin/registrations/:role/:id`
- `GET /api/admin/registrations/:role/export`

## Production app path

The production build for the mobile web app uses `/app/` as its base path and `/app/api` as its same-origin API prefix. The Windows deployment helper is `deploy-apk.ps1`; it prompts for the server password without writing it to the repository, stages the frontend, copies the Docker Compose file, runs the database migration, and registers the API as the `GomrokAppApi` scheduled task. When Docker is available, it starts the `gomrok-mysql` service on port `3308`; otherwise it keeps the existing local database on port `3307` and does not interrupt the site.

Public routes:

- `https://gomrok.org/app` — role selection
- `https://gomrok.org/app/driver` — driver registration
- `https://gomrok.org/app/careers` — carrier registration
- `https://gomrok.org/admin/v2` — admin panel
