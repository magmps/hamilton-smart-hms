'use strict';

const crypto = require('crypto');

const DEFAULT_STATE_ID = 'hamilton-dire-dawa';
const REQUEST_TIMEOUT_MS = 12000;
let writeChain = Promise.resolve();
let initialized = false;

const syncStatus = {
  configured: false,
  connected: false,
  backend: 'local-json',
  state_id: DEFAULT_STATE_ID,
  last_pull_at: null,
  last_push_at: null,
  last_error: null
};

function getConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const enabled = String(process.env.SUPABASE_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
  const stateId = String(process.env.SUPABASE_STATE_ID || DEFAULT_STATE_ID).trim() || DEFAULT_STATE_ID;
  return { url, key, enabled, stateId };
}

function isConfigured() {
  const { url, key, enabled } = getConfig();
  return enabled && /^https:\/\/.+\.supabase\.co$/i.test(url) && key.length > 20;
}

function isLegacyJwtKey(key) {
  return String(key || '').split('.').length === 3;
}

function apiHeaders(key, extra = {}) {
  const headers = {
    apikey: key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra
  };
  // New sb_secret_* keys must be sent only as apikey. Legacy service_role JWTs
  // also require the Authorization header for PostgREST role propagation.
  if (isLegacyJwtKey(key)) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function apiRequest(pathname, options = {}) {
  const { url, key } = getConfig();
  if (!isConfigured()) throw new Error('Supabase is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/rest/v1/${pathname}`, {
      ...options,
      headers: apiHeaders(key, options.headers || {}),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = text; }
    }
    if (!response.ok) {
      const message = data?.message || data?.hint || data?.details || String(data || response.statusText);
      const error = new Error(`Supabase ${response.status}: ${message}`);
      error.status = response.status;
      error.response = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function checksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function loadState() {
  const { stateId } = getConfig();
  const query = `hms_state?id=eq.${encodeURIComponent(stateId)}&select=id,payload,schema_version,checksum,updated_at&limit=1`;
  const rows = await apiRequest(query, { method: 'GET' });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function saveState(payload) {
  const { stateId } = getConfig();
  const body = {
    id: stateId,
    payload,
    schema_version: Number(payload?.meta?.schema_version || 1),
    checksum: checksum(payload),
    updated_at: new Date().toISOString()
  };
  const rows = await apiRequest('hms_state?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body)
  });
  syncStatus.last_push_at = new Date().toISOString();
  syncStatus.connected = true;
  syncStatus.backend = 'supabase';
  syncStatus.last_error = null;
  return Array.isArray(rows) ? rows[0] : rows;
}

async function initialize({ readLocal, writeLocal }) {
  const { stateId } = getConfig();
  syncStatus.state_id = stateId;
  syncStatus.configured = isConfigured();
  initialized = false;

  if (!syncStatus.configured) {
    syncStatus.connected = false;
    syncStatus.backend = 'local-json';
    syncStatus.last_error = null;
    initialized = true;
    return getStatus();
  }

  try {
    const remote = await loadState();
    if (remote?.payload && typeof remote.payload === 'object') {
      writeLocal(remote.payload);
      syncStatus.last_pull_at = new Date().toISOString();
    } else {
      await saveState(readLocal());
    }
    syncStatus.connected = true;
    syncStatus.backend = 'supabase';
    syncStatus.last_error = null;
  } catch (error) {
    syncStatus.connected = false;
    syncStatus.backend = 'local-fallback';
    syncStatus.last_error = error.message;
    console.warn(`WARNING: Supabase unavailable; using local JSON fallback. ${error.message}`);
  }

  initialized = true;
  return getStatus();
}

function queueSave(payload) {
  if (!initialized || !isConfigured()) return;
  const snapshot = JSON.parse(JSON.stringify(payload));
  writeChain = writeChain
    .then(() => saveState(snapshot))
    .catch(error => {
      syncStatus.connected = false;
      syncStatus.backend = 'local-fallback';
      syncStatus.last_error = error.message;
      console.warn(`WARNING: Supabase sync failed; local data remains safe. ${error.message}`);
    });
}

async function flush() {
  await writeChain;
}

async function probe() {
  const row = await loadState();
  return {
    ok: true,
    configured: true,
    state_exists: Boolean(row),
    state_id: getConfig().stateId,
    updated_at: row?.updated_at || null,
    schema_version: row?.schema_version || null
  };
}

function getStatus() {
  return { ...syncStatus };
}

module.exports = {
  initialize,
  queueSave,
  flush,
  probe,
  loadState,
  saveState,
  getStatus,
  isConfigured
};
