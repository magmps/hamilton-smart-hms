#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node backend/api-gateway/src/server.js
