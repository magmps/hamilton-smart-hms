# Deployment runbook

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env` and set a long random `HMS_JWT_SECRET`.
3. Run `npm start` or `docker compose up -d`.
4. Open `http://localhost:8080`.
5. Confirm `GET /api/v1/health` returns `ok: true`.
6. Sign in, change demo credentials, and test a reservation through checkout.
7. Back up the data directory before upgrades.

For production use a reverse proxy with HTTPS, managed PostgreSQL, process supervision, monitoring, and an off-site backup policy.
