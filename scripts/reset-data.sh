#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
rm -f backend/api-gateway/data/hotel.json
printf '%s\n' 'Demo data reset. Restart the server to recreate it.'
