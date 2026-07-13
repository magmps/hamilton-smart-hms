# Supabase Setup — Hamilton International Hotel HMS

This release keeps the current zero-dependency Node.js API and adds secure cloud persistence through Supabase's Data REST API. The backend loads the remote HMS state at startup and pushes every change back to Supabase. If the internet is temporarily unavailable, the local JSON file remains available as a fallback.

## 1. Create a Supabase project

Create a project and wait until the database is ready.

## 2. Create the HMS table

Open **SQL Editor**, paste the contents of:

```text
database/migrations/V2__supabase_cloud_state.sql
```

Run the SQL once.

## 3. Copy backend credentials

From the Supabase dashboard copy:

- Project URL: `https://<project-ref>.supabase.co`
- Secret key: `sb_secret_...` (recommended)

A legacy `service_role` key also works. Never use a publishable/anon key for this backend sync, and never place the secret key in frontend files.

## 4. Configure Termux

```bash
cd ~/hamilton-smart-hms
bash scripts/setup-supabase-termux.sh
npm run supabase:check
npm start
```

The setup script creates a private `.env` file and generates a strong HMS JWT secret.

## 5. Verify

Open:

```text
http://localhost:8080/api/v1/health
```

The response should show:

```json
"storage": {
  "configured": true,
  "connected": true,
  "backend": "supabase"
}
```

## Sync behavior

- Remote state exists: the server pulls it at startup.
- Remote state is empty: the server uploads the current local HMS data.
- Every reservation, room, guest, folio, F&B, rate, user, settings, notification, and audit update is queued to Supabase.
- Supabase unavailable: the app continues with local JSON and reports `local-fallback` in health status.

## Security

- `.env` is excluded by `.gitignore`.
- Secret/service-role keys stay on the backend only.
- The `hms_state` table has RLS enabled and access revoked from `anon` and `authenticated` roles.
- Rotate the Supabase secret key immediately if it is exposed.
