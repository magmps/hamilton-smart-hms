# Hamilton International Hotel — Smart HMS

A working, responsive Hotel Management System web application and REST API for **Hamilton International Hotel, Dire Dawa, Ethiopia**.

The build follows the enterprise proposal while remaining practical to run immediately on Windows, Linux, macOS, Termux, Docker, or a small cloud server. The current release uses Node.js built-in modules, local JSON fallback, and optional Supabase cloud persistence through the generated Data REST API. No npm install is required.

## Included modules

- Public hotel website and guest reservation request
- Secure staff login and role-based access
- Executive dashboard and operational alerts
- Availability and reservations
- Front desk check-in, room assignment, room move, checkout
- Live rooms and housekeeping task board
- Guest CRM and VIP preferences
- Food & beverage menu, order flow, settlement, room posting API
- Folios, charges, payments, refunds, invoice issue
- Revenue metrics, ADR, RevPAR, forecast, rate recommendations
- Management reports and audit trail
- Staff users, property settings, integrations, and notifications
- Mobile-responsive PWA-ready design

## Start locally

```bash
cd hamilton-smart-hms
npm start
```

Open:

- Guest website: `http://localhost:8080`
- Staff login: `http://localhost:8080/login.html`
- API health: `http://localhost:8080/api/v1/health`

No `npm install` is required.


## Supabase cloud database

This version can securely synchronize the full HMS operational state to Supabase while keeping the Termux-friendly local JSON fallback.

1. Create a Supabase project.
2. Run `database/migrations/V2__supabase_cloud_state.sql` in the Supabase SQL Editor.
3. Configure the backend:

```bash
cd ~/hamilton-smart-hms
bash scripts/setup-supabase-termux.sh
npm run supabase:check
npm start
```

Use a backend **Secret key** (`sb_secret_...`) or the legacy `service_role` key. Never place that key in HTML, frontend JavaScript, GitHub, screenshots, or chat. See `docs/database/SUPABASE_SETUP.md`.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Administrator | admin@hamiltonhotel.et | Admin@123 |
| General Manager | manager@hamiltonhotel.et | Manager@123 |
| Front Desk | frontdesk@hamiltonhotel.et | Frontdesk@123 |
| Housekeeping | housekeeping@hamiltonhotel.et | Housekeeping@123 |
| Finance | finance@hamiltonhotel.et | Finance@123 |
| Food & Beverage | fb@hamiltonhotel.et | Food@123 |

Change all demo credentials before production.

## Termux

```bash
pkg update
pkg install nodejs
cd hamilton-smart-hms
node backend/api-gateway/src/server.js
```

## Windows

Install Node.js 18+, open PowerShell in the project folder, then run:

```powershell
npm start
```

## Environment

```bash
export PORT=8080
export HMS_JWT_SECRET='replace-with-a-long-random-secret'
export HMS_DATA_FILE='./backend/api-gateway/data/hotel.json'
export SUPABASE_URL='https://your-project-ref.supabase.co'
export SUPABASE_SECRET_KEY='sb_secret_...'
export SUPABASE_STATE_ID='hamilton-dire-dawa'
```

## API groups

- `/api/v1/auth`
- `/api/v1/public`
- `/api/v1/availability`
- `/api/v1/reservations`
- `/api/v1/frontdesk`
- `/api/v1/rooms`
- `/api/v1/guests`
- `/api/v1/folios`
- `/api/v1/fb`
- `/api/v1/revenue`
- `/api/v1/reports`
- `/api/v1/admin`
- `/api/v1/integrations`
- `/api/v1/notifications`

See `docs/api/openapi.yaml` for the API contract and examples.

## Production upgrade path

1. Enable Supabase cloud persistence using `database/migrations/V2__supabase_cloud_state.sql`; later normalize high-volume domains with `V1__initial_schema.sql`.
2. Put the service behind HTTPS and a reverse proxy.
3. Use a long random JWT secret and secret manager.
4. Add MFA for privileged accounts.
5. Integrate approved Ethiopian payment, SMS, accounting, OTA, and key-card providers.
6. Configure encrypted backups, monitoring, restore tests, and incident procedures.
7. Run security, performance, migration, and user-acceptance testing.

## Project structure

```text
hotel-management-system/
├── docs/
├── frontend/web/public/
├── backend/api-gateway/src/server.js
├── database/migrations/
├── tests/
├── scripts/
├── docker-compose.yml
├── package.json
└── README.md
```

## Important

This is a working enterprise starter and operational prototype. External payment, SMS, OTA/channel manager, door-lock, and accounting integrations require provider credentials, contracts, and production configuration.
