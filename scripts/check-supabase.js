'use strict';

const path = require('path');
const { loadEnvFile } = require('../backend/api-gateway/src/load-env');
const ROOT = path.resolve(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
const store = require('../backend/api-gateway/src/supabase-store');

(async () => {
  try {
    if (!store.isConfigured()) {
      throw new Error('Supabase is not configured. Run: bash scripts/setup-supabase-termux.sh');
    }
    const result = await store.probe();
    console.log(JSON.stringify(result, null, 2));
    console.log('Supabase connection successful.');
  } catch (error) {
    console.error(`Supabase connection failed: ${error.message}`);
    process.exitCode = 1;
  }
})();
