#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

printf '\nHamilton International Hotel HMS — Supabase Setup\n'
printf 'Supabase Dashboard keessatti project URL fi Secret key qopheessi.\n\n'

read -r -p 'SUPABASE_URL (https://xxxx.supabase.co): ' SUPABASE_URL
read -r -s -p 'SUPABASE_SECRET_KEY (sb_secret_... or service_role JWT): ' SUPABASE_SECRET_KEY
printf '\n'
read -r -p 'State ID [hamilton-dire-dawa]: ' SUPABASE_STATE_ID
SUPABASE_STATE_ID="${SUPABASE_STATE_ID:-hamilton-dire-dawa}"

if [[ ! "$SUPABASE_URL" =~ ^https://.+\.supabase\.co/?$ ]]; then
  echo 'ERROR: Supabase URL sirrii miti.' >&2
  exit 1
fi
if [[ ${#SUPABASE_SECRET_KEY} -lt 20 ]]; then
  echo 'ERROR: Secret key sirrii miti.' >&2
  exit 1
fi

JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
umask 077
cat > .env <<ENV
PORT=8080
HMS_JWT_SECRET=$JWT_SECRET
HMS_DATA_FILE=./backend/api-gateway/data/hotel.json
NODE_ENV=development
SUPABASE_SYNC_ENABLED=true
SUPABASE_URL=${SUPABASE_URL%/}
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
SUPABASE_STATE_ID=$SUPABASE_STATE_ID
ENV
chmod 600 .env

echo
echo '.env created securely.'
echo 'Next: npm run supabase:check'
echo 'Then: npm start'
