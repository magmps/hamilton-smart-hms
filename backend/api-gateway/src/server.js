'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '../../..');
const { loadEnvFile } = require('./load-env');
loadEnvFile(path.join(ROOT, '.env'));
const supabaseStore = require('./supabase-store');

const PUBLIC_DIR = path.join(ROOT, 'frontend/web/public');
const DATA_FILE = path.resolve(process.env.HMS_DATA_FILE || path.join(ROOT, 'backend/api-gateway/data/hotel.json'));
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.HMS_JWT_SECRET || 'development-only-change-this-hamilton-hms-secret';
const MAX_BODY = 1024 * 1024;
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const rateBuckets = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }
function dateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function uid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function nights(checkIn, checkOut) {
  const a = new Date(`${checkIn}T00:00:00Z`);
  const b = new Date(`${checkOut}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000));
}
function safeText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}
function parseBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}
function encode(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  return timingSafeEqualText(passwordHash(password, salt).split(':')[1], hash);
}
function signClaims(claims) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ ...claims, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function signToken(user) {
  return signClaims({ sub: user.id, role: user.role, name: user.name, kind: 'staff' });
}
function signGuestToken(guest, reservation) {
  return signClaims({
    sub: guest.id,
    role: 'guest',
    kind: 'guest',
    reservation_id: reservation.id,
    name: `${guest.first_name} ${guest.last_name}`
  });
}
function verifyToken(token) {
  try {
    const [header, payload, signature] = String(token || '').split('.');
    if (!header || !payload || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (!timingSafeEqualText(signature, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

function seedDatabase() {
  const propertyId = 'prop_hamilton_dire_dawa';
  const roomTypes = [
    { id: 'rt_standard', name: 'Standard King', capacity: 2, base_rate: 4200, rooms: 8 },
    { id: 'rt_deluxe', name: 'Deluxe Twin', capacity: 3, base_rate: 5600, rooms: 8 },
    { id: 'rt_executive', name: 'Executive Suite', capacity: 3, base_rate: 8900, rooms: 5 },
    { id: 'rt_family', name: 'Family Suite', capacity: 5, base_rate: 11200, rooms: 3 }
  ];
  const rooms = [];
  let number = 101;
  const statuses = ['clean', 'clean', 'occupied', 'dirty', 'clean', 'inspected', 'clean', 'maintenance'];
  for (let i = 0; i < roomTypes.length; i += 1) {
    for (let j = 0; j < roomTypes[i].rooms; j += 1) {
      rooms.push({
        id: uid('room'), property_id: propertyId, room_type_id: roomTypes[i].id,
        number: String(number++), floor: i + 1, status: statuses[(i * 3 + j) % statuses.length],
        notes: '', version: 1, updated_at: nowIso()
      });
    }
  }
  const users = [
    ['usr_admin', 'System Administrator', 'admin@hamiltonhotel.et', 'Admin@123', 'admin', 'IT'],
    ['usr_manager', 'General Manager', 'manager@hamiltonhotel.et', 'Manager@123', 'manager', 'Management'],
    ['usr_frontdesk', 'Front Desk Agent', 'frontdesk@hamiltonhotel.et', 'Frontdesk@123', 'frontdesk', 'Front Office'],
    ['usr_housekeeping', 'Housekeeping Supervisor', 'housekeeping@hamiltonhotel.et', 'Housekeeping@123', 'housekeeping', 'Housekeeping'],
    ['usr_finance', 'Finance Officer', 'finance@hamiltonhotel.et', 'Finance@123', 'finance', 'Finance'],
    ['usr_fb', 'F&B Manager', 'fb@hamiltonhotel.et', 'Food@123', 'fb', 'Food & Beverage']
  ].map(([id, name, email, password, role, department]) => ({
    id, property_id: propertyId, name, email, password_hash: passwordHash(password), role, department,
    active: true, created_at: nowIso(), updated_at: nowIso()
  }));
  const guests = [
    { id: 'gst_001', first_name: 'Selam', last_name: 'Tesfaye', phone: '+251911234567', email: 'selam@example.com', nationality: 'Ethiopian', vip: true, preferences: ['High floor', 'Quiet room'] },
    { id: 'gst_002', first_name: 'Mohammed', last_name: 'Ali', phone: '+251922112233', email: 'mohammed@example.com', nationality: 'Ethiopian', vip: false, preferences: ['Twin beds'] },
    { id: 'gst_003', first_name: 'Sara', last_name: 'Abdullah', phone: '+251933445566', email: 'sara@example.com', nationality: 'Ethiopian', vip: false, preferences: ['Airport pickup'] },
    { id: 'gst_004', first_name: 'Daniel', last_name: 'Bekele', phone: '+251944667788', email: 'daniel@example.com', nationality: 'Ethiopian', vip: true, preferences: ['Late checkout'] },
    { id: 'gst_005', first_name: 'Hana', last_name: 'Worku', phone: '+251955778899', email: 'hana@example.com', nationality: 'Ethiopian', vip: false, preferences: ['Non-smoking'] }
  ].map(g => ({ ...g, property_id: propertyId, created_at: nowIso(), updated_at: nowIso() }));

  const usableRooms = rooms.filter(r => r.status !== 'maintenance');
  const reservations = [
    { id: 'res_001', confirmation_no: 'HIH-260701', guest_id: 'gst_001', room_type_id: 'rt_executive', room_id: usableRooms.find(r => r.room_type_id === 'rt_executive')?.id, check_in: today(), check_out: dateOffset(2), adults: 2, children: 0, source: 'direct', status: 'checked_in', rate: 8900, deposit: 10000, notes: 'VIP welcome amenity' },
    { id: 'res_002', confirmation_no: 'HIH-260702', guest_id: 'gst_002', room_type_id: 'rt_deluxe', room_id: null, check_in: today(), check_out: dateOffset(1), adults: 2, children: 0, source: 'walk-in', status: 'reserved', rate: 5600, deposit: 2000, notes: '' },
    { id: 'res_003', confirmation_no: 'HIH-260703', guest_id: 'gst_003', room_type_id: 'rt_standard', room_id: null, check_in: dateOffset(1), check_out: dateOffset(4), adults: 1, children: 0, source: 'OTA', status: 'reserved', rate: 4500, deposit: 4500, notes: 'Airport pickup requested' },
    { id: 'res_004', confirmation_no: 'HIH-260704', guest_id: 'gst_004', room_type_id: 'rt_family', room_id: usableRooms.find(r => r.room_type_id === 'rt_family')?.id, check_in: dateOffset(-1), check_out: dateOffset(2), adults: 2, children: 2, source: 'corporate', status: 'checked_in', rate: 11200, deposit: 15000, notes: '' },
    { id: 'res_005', confirmation_no: 'HIH-260705', guest_id: 'gst_005', room_type_id: 'rt_standard', room_id: null, check_in: dateOffset(3), check_out: dateOffset(5), adults: 1, children: 0, source: 'direct', status: 'reserved', rate: 4200, deposit: 0, notes: '' }
  ].map(r => ({ ...r, property_id: propertyId, currency: 'ETB', created_at: nowIso(), updated_at: nowIso(), version: 1 }));

  for (const reservation of reservations.filter(r => r.status === 'checked_in')) {
    const room = rooms.find(r => r.id === reservation.room_id);
    if (room) room.status = 'occupied';
  }

  const folios = reservations.filter(r => r.status === 'checked_in').map((r, idx) => ({
    id: `fol_${idx + 1}`, reservation_id: r.id, status: 'open', currency: 'ETB',
    lines: [
      { id: uid('line'), type: 'charge', description: 'Room charge', amount: money(r.rate), tax: money(r.rate * 0.15), business_date: today(), created_at: nowIso() },
      { id: uid('line'), type: 'payment', description: 'Deposit received', amount: -money(r.deposit), tax: 0, business_date: today(), created_at: nowIso() }
    ], created_at: nowIso(), updated_at: nowIso()
  }));

  const housekeepingTasks = rooms.filter(r => ['dirty', 'maintenance'].includes(r.status)).map((r, i) => ({
    id: uid('hkt'), room_id: r.id, type: r.status === 'maintenance' ? 'maintenance' : 'cleaning',
    priority: i % 3 === 0 ? 'high' : 'normal', status: 'pending', assigned_to: i % 2 === 0 ? 'usr_housekeeping' : null,
    due_at: new Date(Date.now() + (i + 1) * 3600000).toISOString(), notes: r.status === 'maintenance' ? 'Engineering inspection required' : 'Prepare for next arrival', created_at: nowIso(), updated_at: nowIso()
  }));

  const menu = [
    ['menu_1', 'Hamilton Breakfast', 'Breakfast', 650], ['menu_2', 'Dire Dawa Special Tibs', 'Main Course', 980],
    ['menu_3', 'Grilled Chicken', 'Main Course', 850], ['menu_4', 'Vegetable Pasta', 'Main Course', 620],
    ['menu_5', 'Fresh Juice', 'Beverage', 220], ['menu_6', 'Ethiopian Coffee', 'Beverage', 160],
    ['menu_7', 'Fruit Platter', 'Dessert', 380], ['menu_8', 'Club Sandwich', 'Snacks', 520]
  ].map(([id, name, category, price]) => ({ id, outlet_id: 'outlet_restaurant', name, category, price, available: true }));

  return {
    meta: { schema_version: 1, created_at: nowIso(), updated_at: nowIso() },
    property: { id: propertyId, name: 'Hamilton International Hotel', city: 'Dire Dawa', country: 'Ethiopia', timezone: 'Africa/Addis_Ababa', currency: 'ETB', phone: '+251', email: 'info@hamiltonhotel.et' },
    users, roomTypes, rooms, guests, reservations, folios, housekeepingTasks, menu,
    fbOrders: [
      { id: 'fbo_001', order_no: 'FBO-1001', outlet_id: 'outlet_restaurant', room_id: reservations[0].room_id, reservation_id: 'res_001', guest_name: 'Selam Tesfaye', items: [{ menu_id: 'menu_6', name: 'Ethiopian Coffee', qty: 2, unit_price: 160 }], total: 320, status: 'served', settlement: 'room', created_at: nowIso(), updated_at: nowIso() }
    ],
    rates: roomTypes.map((rt, i) => ({ id: `rate_${i + 1}`, room_type_id: rt.id, name: 'Best Available Rate', amount: rt.base_rate, min_stay: 1, active: true, updated_at: nowIso() })),
    notifications: [],
    integrations: [
      { id: 'int_sms', name: 'SMS Gateway', type: 'messaging', status: 'not_configured' },
      { id: 'int_payment', name: 'Payment Gateway', type: 'payment', status: 'not_configured' },
      { id: 'int_ota', name: 'OTA / Channel Manager', type: 'channel', status: 'not_configured' },
      { id: 'int_accounting', name: 'Accounting Export', type: 'accounting', status: 'ready' }
    ],
    settings: { tax_rate: 0.15, service_charge_rate: 0.1, check_in_time: '14:00', check_out_time: '12:00', night_audit_enabled: true, low_occupancy_threshold: 35, high_occupancy_threshold: 85 },
    auditLogs: [{ id: uid('audit'), actor_id: 'system', action: 'database.seeded', entity_type: 'system', entity_id: null, details: {}, created_at: nowIso() }]
  };
}

function ensureDb() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) writeDb(seedDatabase());
}
function readDb() {
  ensureDb();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (err) {
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    const db = seedDatabase();
    writeDb(db);
    return db;
  }
}
function writeDb(db, options = {}) {
  db.meta = db.meta || {};
  db.meta.updated_at = nowIso();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DATA_FILE);
  if (!options.skipRemote) supabaseStore.queueSave(db);
}
function audit(db, user, action, entityType, entityId, details = {}) {
  db.auditLogs.unshift({ id: uid('audit'), actor_id: user?.id || 'system', actor_name: user?.name || 'System', action, entity_type: entityType, entity_id: entityId || null, details, created_at: nowIso() });
  db.auditLogs = db.auditLogs.slice(0, 2000);
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
}
function sendJson(res, status, data) {
  securityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
function sendError(res, status, message, code = 'request_error', details) {
  sendJson(res, status, { ok: false, error: { code, message, ...(details ? { details } : {}) } });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body is too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(); }
function rateLimited(req, limit = 180, windowMs = 60000) {
  const key = clientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > windowMs) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count > limit;
}
function getAuth(req, db) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload || payload.kind === 'guest') return null;
  const user = db.users.find(u => u.id === payload.sub && u.active);
  return user || null;
}
function normalizeContact(value) {
  const text = safeText(value, 180).toLowerCase();
  return { text, digits: text.replace(/\D/g, '') };
}
function getGuestAuth(req, db) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'guest' || payload.role !== 'guest') return null;
  const guest = db.guests.find(g => g.id === payload.sub);
  const reservation = db.reservations.find(r => r.id === payload.reservation_id && r.guest_id === payload.sub);
  return guest && reservation ? { payload, guest, reservation } : null;
}
function requireRole(user, roles) { return user && (roles.includes(user.role) || user.role === 'admin'); }
function routeMatch(pathname, pattern) {
  const p1 = pathname.split('/').filter(Boolean);
  const p2 = pattern.split('/').filter(Boolean);
  if (p1.length !== p2.length) return null;
  const params = {};
  for (let i = 0; i < p1.length; i += 1) {
    if (p2[i].startsWith(':')) params[p2[i].slice(1)] = decodeURIComponent(p1[i]);
    else if (p1[i] !== p2[i]) return null;
  }
  return params;
}
function guestName(db, guestId) {
  const g = db.guests.find(x => x.id === guestId);
  return g ? `${g.first_name} ${g.last_name}` : 'Unknown Guest';
}
function roomTypeName(db, id) { return db.roomTypes.find(x => x.id === id)?.name || 'Unknown'; }
function roomNumber(db, id) { return db.rooms.find(x => x.id === id)?.number || 'Unassigned'; }
function folioBalance(folio) { return money((folio?.lines || []).reduce((sum, line) => sum + Number(line.amount || 0) + Number(line.tax || 0), 0)); }
function publicReservation(db, r) {
  return { ...r, guest_name: guestName(db, r.guest_id), room_type_name: roomTypeName(db, r.room_type_id), room_number: roomNumber(db, r.room_id) };
}
function availableRooms(db, checkIn, checkOut, roomTypeId) {
  const unavailable = new Set(db.reservations.filter(r =>
    !['cancelled', 'checked_out', 'no_show'].includes(r.status) && r.room_id && r.check_in < checkOut && r.check_out > checkIn
  ).map(r => r.room_id));
  return db.rooms.filter(r =>
    r.status !== 'maintenance' && !unavailable.has(r.id) && (!roomTypeId || r.room_type_id === roomTypeId)
  );
}
function dashboardSummary(db) {
  const activeReservations = db.reservations.filter(r => !['cancelled', 'no_show'].includes(r.status));
  const occupied = db.rooms.filter(r => r.status === 'occupied').length;
  const available = db.rooms.filter(r => ['clean', 'inspected'].includes(r.status)).length;
  const dirty = db.rooms.filter(r => r.status === 'dirty').length;
  const maintenance = db.rooms.filter(r => r.status === 'maintenance').length;
  const arrivals = activeReservations.filter(r => r.check_in === today() && r.status === 'reserved');
  const departures = activeReservations.filter(r => r.check_out === today() && r.status === 'checked_in');
  const revenue = db.folios.reduce((sum, f) => sum + (f.lines || []).filter(l => l.type === 'charge').reduce((s, l) => s + Number(l.amount || 0) + Number(l.tax || 0), 0), 0);
  const payments = db.folios.reduce((sum, f) => sum + Math.abs((f.lines || []).filter(l => l.type === 'payment').reduce((s, l) => s + Number(l.amount || 0), 0)), 0);
  const occupancy = db.rooms.length ? money((occupied / db.rooms.length) * 100) : 0;
  const recent = db.reservations.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6).map(r => publicReservation(db, r));
  return {
    property: db.property,
    kpis: { occupancy, occupied_rooms: occupied, available_rooms: available, dirty_rooms: dirty, maintenance_rooms: maintenance, arrivals: arrivals.length, departures: departures.length, revenue: money(revenue), payments: money(payments), open_folios: db.folios.filter(f => f.status === 'open').length, pending_tasks: db.housekeepingTasks.filter(t => !['completed', 'cancelled'].includes(t.status)).length },
    arrivals: arrivals.map(r => publicReservation(db, r)), departures: departures.map(r => publicReservation(db, r)), recent_reservations: recent,
    room_status: { clean: db.rooms.filter(r => r.status === 'clean').length, inspected: db.rooms.filter(r => r.status === 'inspected').length, occupied, dirty, maintenance },
    alerts: [
      ...(dirty > 0 ? [{ severity: 'warning', title: `${dirty} dirty rooms require action`, module: 'housekeeping' }] : []),
      ...(maintenance > 0 ? [{ severity: 'danger', title: `${maintenance} rooms out of service`, module: 'rooms' }] : []),
      ...(arrivals.some(r => Number(r.deposit) <= 0) ? [{ severity: 'info', title: 'Arrival with unpaid deposit', module: 'frontdesk' }] : [])
    ]
  };
}

async function handleApi(req, res, url) {
  if (rateLimited(req)) return sendError(res, 429, 'Too many requests. Please try again shortly.', 'rate_limited');
  const method = req.method.toUpperCase();
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  let db = readDb();

  if (method === 'OPTIONS') {
    securityHeaders(res); res.statusCode = 204; res.end(); return;
  }
  if (method === 'GET' && pathname === '/api/v1/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'Hamilton International Hotel HMS API',
      version: '1.2.0',
      time: nowIso(),
      property: db.property.name,
      storage: supabaseStore.getStatus()
    });
  }
  if (method === 'POST' && pathname === '/api/v1/auth/login') {
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const email = safeText(body.email, 160).toLowerCase();
    const user = db.users.find(u => u.email.toLowerCase() === email && u.active);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      audit(db, null, 'auth.login_failed', 'user', user?.id, { email, ip: clientIp(req) }); writeDb(db);
      return sendError(res, 401, 'Email or password is incorrect.', 'invalid_credentials');
    }
    audit(db, user, 'auth.login_success', 'user', user.id, { ip: clientIp(req) }); writeDb(db);
    return sendJson(res, 200, { ok: true, token: signToken(user), expires_in: TOKEN_TTL_SECONDS, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department }, property: db.property });
  }

  if (method === 'GET' && pathname === '/api/v1/public/availability') {
    const checkIn = url.searchParams.get('check_in') || today();
    const checkOut = url.searchParams.get('check_out') || dateOffset(1);
    const type = url.searchParams.get('room_type_id');
    const rooms = availableRooms(db, checkIn, checkOut, type);
    const types = db.roomTypes.map(rt => ({ ...rt, available: rooms.filter(r => r.room_type_id === rt.id).length }));
    return sendJson(res, 200, { ok: true, check_in: checkIn, check_out: checkOut, nights: nights(checkIn, checkOut), room_types: types });
  }
  if (method === 'POST' && pathname === '/api/v1/public/reservations') {
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const required = ['first_name', 'last_name', 'phone', 'check_in', 'check_out', 'room_type_id'];
    const missing = required.filter(k => !safeText(body[k]));
    if (missing.length) return sendError(res, 422, `Missing required fields: ${missing.join(', ')}`, 'validation_error');
    if (body.check_out <= body.check_in) return sendError(res, 422, 'Check-out must be after check-in.', 'validation_error');
    const roomType = db.roomTypes.find(rt => rt.id === body.room_type_id);
    if (!roomType) return sendError(res, 404, 'Room type not found.');
    const guest = { id: uid('gst'), property_id: db.property.id, first_name: safeText(body.first_name, 80), last_name: safeText(body.last_name, 80), phone: safeText(body.phone, 40), email: safeText(body.email, 160), nationality: safeText(body.nationality || 'Ethiopian', 80), vip: false, preferences: [], created_at: nowIso(), updated_at: nowIso() };
    db.guests.push(guest);
    const confirmation = `HIH-${new Date().getFullYear().toString().slice(-2)}${String(Date.now()).slice(-6)}`;
    const reservation = { id: uid('res'), property_id: db.property.id, confirmation_no: confirmation, guest_id: guest.id, room_type_id: roomType.id, room_id: null, check_in: safeText(body.check_in, 10), check_out: safeText(body.check_out, 10), adults: Math.max(1, Number(body.adults || 1)), children: Math.max(0, Number(body.children || 0)), source: 'website', status: 'reserved', rate: money(roomType.base_rate), deposit: 0, currency: 'ETB', notes: safeText(body.notes, 1000), created_at: nowIso(), updated_at: nowIso(), version: 1 };
    db.reservations.push(reservation); audit(db, null, 'reservation.public_created', 'reservation', reservation.id, { confirmation }); writeDb(db);
    return sendJson(res, 201, { ok: true, message: 'Reservation request created.', confirmation_no: confirmation, reservation: publicReservation(db, reservation) });
  }

  if (method === 'POST' && pathname === '/api/v1/guest/auth') {
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const confirmation = safeText(body.confirmation_no, 40).toUpperCase();
    const contact = normalizeContact(body.contact);
    if (!confirmation || !contact.text) return sendError(res, 422, 'Confirmation number and email or phone are required.', 'validation_error');
    const reservation = db.reservations.find(r => String(r.confirmation_no || '').toUpperCase() === confirmation);
    const guest = reservation ? db.guests.find(g => g.id === reservation.guest_id) : null;
    const guestEmail = normalizeContact(guest?.email).text;
    const guestPhone = normalizeContact(guest?.phone).digits;
    const contactMatches = Boolean(guest) && ((guestEmail && contact.text === guestEmail) || (guestPhone && contact.digits && contact.digits === guestPhone));
    if (!reservation || !guest || !contactMatches) return sendError(res, 401, 'Booking details do not match our records.', 'invalid_guest_credentials');
    db.guestRequests = Array.isArray(db.guestRequests) ? db.guestRequests : [];
    audit(db, null, 'guest.portal_login', 'reservation', reservation.id, { confirmation, ip: clientIp(req) }); writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      token: signGuestToken(guest, reservation),
      expires_in: TOKEN_TTL_SECONDS,
      guest: { id: guest.id, name: `${guest.first_name} ${guest.last_name}`, email: guest.email, phone: guest.phone },
      reservation: publicReservation(db, reservation)
    });
  }

  if (method === 'GET' && pathname === '/api/v1/guest/dashboard') {
    const auth = getGuestAuth(req, db);
    if (!auth) return sendError(res, 401, 'Guest authentication required.', 'unauthorized');
    const reservations = db.reservations.filter(r => r.guest_id === auth.guest.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const items = reservations.map(r => {
      const folio = db.folios.find(f => f.reservation_id === r.id);
      return {
        ...publicReservation(db, r),
        estimated_total: money(Number(r.rate || 0) * nights(r.check_in, r.check_out)),
        folio: folio ? { id: folio.id, status: folio.status, lines: folio.lines || [], balance: folioBalance(folio) } : null
      };
    });
    db.guestRequests = Array.isArray(db.guestRequests) ? db.guestRequests : [];
    return sendJson(res, 200, {
      ok: true,
      property: db.property,
      guest: { id: auth.guest.id, first_name: auth.guest.first_name, last_name: auth.guest.last_name, email: auth.guest.email, phone: auth.guest.phone, preferences: auth.guest.preferences || [] },
      reservations: items,
      requests: db.guestRequests.filter(x => x.guest_id === auth.guest.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    });
  }

  if (method === 'POST' && pathname === '/api/v1/guest/requests') {
    const auth = getGuestAuth(req, db);
    if (!auth) return sendError(res, 401, 'Guest authentication required.', 'unauthorized');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const reservationId = safeText(body.reservation_id, 100) || auth.reservation.id;
    const reservation = db.reservations.find(r => r.id === reservationId && r.guest_id === auth.guest.id);
    const message = safeText(body.message, 1000);
    if (!reservation || !message) return sendError(res, 422, 'A valid reservation and request message are required.', 'validation_error');
    db.guestRequests = Array.isArray(db.guestRequests) ? db.guestRequests : [];
    const item = { id: uid('grq'), guest_id: auth.guest.id, reservation_id: reservation.id, type: safeText(body.type || 'general', 40), message, status: 'new', created_at: nowIso(), updated_at: nowIso() };
    db.guestRequests.push(item);
    db.notifications.push({ id: uid('ntf'), channel: 'internal', recipient: 'frontdesk', message: `Guest request ${reservation.confirmation_no}: ${message}`, status: 'queued', created_by: auth.guest.id, created_at: nowIso() });
    audit(db, null, 'guest.request_created', 'guest_request', item.id, { reservation_id: reservation.id }); writeDb(db);
    return sendJson(res, 201, { ok: true, item });
  }

  let guestParams = routeMatch(pathname, '/api/v1/guest/reservations/:id/cancel');
  if (guestParams && method === 'POST') {
    const auth = getGuestAuth(req, db);
    if (!auth) return sendError(res, 401, 'Guest authentication required.', 'unauthorized');
    const reservation = db.reservations.find(r => r.id === guestParams.id && r.guest_id === auth.guest.id);
    if (!reservation) return sendError(res, 404, 'Reservation not found.');
    if (reservation.status !== 'reserved') return sendError(res, 409, 'Only reserved bookings can be cancelled online.');
    reservation.status = 'cancelled'; reservation.updated_at = nowIso(); reservation.version = Number(reservation.version || 0) + 1;
    audit(db, null, 'guest.reservation_cancelled', 'reservation', reservation.id, { confirmation: reservation.confirmation_no }); writeDb(db);
    return sendJson(res, 200, { ok: true, item: publicReservation(db, reservation) });
  }

  const user = getAuth(req, db);
  if (!user) return sendError(res, 401, 'Authentication required.', 'unauthorized');

  if (method === 'GET' && pathname === '/api/v1/auth/me') return sendJson(res, 200, { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department }, property: db.property });
  if (method === 'GET' && pathname === '/api/v1/dashboard/summary') return sendJson(res, 200, { ok: true, ...dashboardSummary(db) });

  if (method === 'GET' && pathname === '/api/v1/availability') {
    const checkIn = url.searchParams.get('check_in') || today();
    const checkOut = url.searchParams.get('check_out') || dateOffset(1);
    const roomTypeId = url.searchParams.get('room_type_id');
    const rooms = availableRooms(db, checkIn, checkOut, roomTypeId).map(r => ({ ...r, room_type_name: roomTypeName(db, r.room_type_id) }));
    return sendJson(res, 200, { ok: true, check_in: checkIn, check_out: checkOut, rooms, room_types: db.roomTypes });
  }

  if (method === 'GET' && pathname === '/api/v1/reservations') {
    let items = db.reservations.map(r => publicReservation(db, r));
    const status = url.searchParams.get('status');
    const search = safeText(url.searchParams.get('q'), 100).toLowerCase();
    if (status) items = items.filter(r => r.status === status);
    if (search) items = items.filter(r => `${r.confirmation_no} ${r.guest_name} ${r.room_number}`.toLowerCase().includes(search));
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sendJson(res, 200, { ok: true, items, total: items.length });
  }
  if (method === 'POST' && pathname === '/api/v1/reservations') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    let guestId = safeText(body.guest_id, 100);
    if (!guestId && body.guest) {
      const g = body.guest;
      if (!safeText(g.first_name) || !safeText(g.last_name) || !safeText(g.phone)) return sendError(res, 422, 'Guest first name, last name and phone are required.', 'validation_error');
      const guest = { id: uid('gst'), property_id: db.property.id, first_name: safeText(g.first_name, 80), last_name: safeText(g.last_name, 80), phone: safeText(g.phone, 40), email: safeText(g.email, 160), nationality: safeText(g.nationality || 'Ethiopian', 80), vip: parseBool(g.vip), preferences: Array.isArray(g.preferences) ? g.preferences.slice(0, 20) : [], created_at: nowIso(), updated_at: nowIso() };
      db.guests.push(guest); guestId = guest.id;
    }
    const roomType = db.roomTypes.find(rt => rt.id === body.room_type_id);
    if (!db.guests.some(g => g.id === guestId) || !roomType) return sendError(res, 422, 'Valid guest and room type are required.', 'validation_error');
    if (!body.check_in || !body.check_out || body.check_out <= body.check_in) return sendError(res, 422, 'Valid check-in and check-out dates are required.', 'validation_error');
    const reservation = { id: uid('res'), property_id: db.property.id, confirmation_no: `HIH-${new Date().getFullYear().toString().slice(-2)}${String(Date.now()).slice(-6)}`, guest_id: guestId, room_type_id: roomType.id, room_id: body.room_id || null, check_in: safeText(body.check_in, 10), check_out: safeText(body.check_out, 10), adults: Math.max(1, Number(body.adults || 1)), children: Math.max(0, Number(body.children || 0)), source: safeText(body.source || 'direct', 40), status: 'reserved', rate: money(body.rate || roomType.base_rate), deposit: money(body.deposit || 0), currency: 'ETB', notes: safeText(body.notes, 1000), created_at: nowIso(), updated_at: nowIso(), version: 1 };
    db.reservations.push(reservation); audit(db, user, 'reservation.created', 'reservation', reservation.id, { confirmation_no: reservation.confirmation_no }); writeDb(db);
    return sendJson(res, 201, { ok: true, item: publicReservation(db, reservation) });
  }
  let params = routeMatch(pathname, '/api/v1/reservations/:id');
  if (params && method === 'GET') {
    const item = db.reservations.find(r => r.id === params.id);
    if (!item) return sendError(res, 404, 'Reservation not found.');
    return sendJson(res, 200, { ok: true, item: publicReservation(db, item) });
  }
  if (params && method === 'PATCH') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const item = db.reservations.find(r => r.id === params.id);
    if (!item) return sendError(res, 404, 'Reservation not found.');
    const allowed = ['check_in', 'check_out', 'adults', 'children', 'source', 'rate', 'deposit', 'notes', 'room_type_id'];
    for (const key of allowed) if (body[key] !== undefined) item[key] = ['rate', 'deposit'].includes(key) ? money(body[key]) : body[key];
    item.updated_at = nowIso(); item.version = Number(item.version || 1) + 1;
    audit(db, user, 'reservation.updated', 'reservation', item.id, { fields: Object.keys(body) }); writeDb(db);
    return sendJson(res, 200, { ok: true, item: publicReservation(db, item) });
  }
  params = routeMatch(pathname, '/api/v1/reservations/:id/cancel');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    const item = db.reservations.find(r => r.id === params.id);
    if (!item) return sendError(res, 404, 'Reservation not found.');
    let body; try { body = await readBody(req); } catch (e) { body = {}; }
    if (item.status === 'checked_in') return sendError(res, 409, 'Checked-in reservation cannot be cancelled.');
    item.status = 'cancelled'; item.cancellation_reason = safeText(body.reason || 'Cancelled by staff', 500); item.updated_at = nowIso();
    audit(db, user, 'reservation.cancelled', 'reservation', item.id, { reason: item.cancellation_reason }); writeDb(db);
    return sendJson(res, 200, { ok: true, item: publicReservation(db, item) });
  }

  if (method === 'GET' && pathname === '/api/v1/frontdesk/arrivals') {
    const arrivals = db.reservations.filter(r => r.status === 'reserved' && r.check_in <= today()).map(r => publicReservation(db, r));
    return sendJson(res, 200, { ok: true, items: arrivals });
  }
  params = routeMatch(pathname, '/api/v1/frontdesk/:id/check-in');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const reservation = db.reservations.find(r => r.id === params.id);
    if (!reservation) return sendError(res, 404, 'Reservation not found.');
    if (reservation.status !== 'reserved') return sendError(res, 409, 'Only reserved bookings can be checked in.');
    const room = db.rooms.find(r => r.id === body.room_id);
    if (!room || !['clean', 'inspected'].includes(room.status)) return sendError(res, 409, 'Select a clean or inspected room.');
    if (room.room_type_id !== reservation.room_type_id && !parseBool(body.allow_upgrade)) return sendError(res, 409, 'Room type does not match. Manager upgrade approval is required.');
    reservation.room_id = room.id; reservation.status = 'checked_in'; reservation.checked_in_at = nowIso(); reservation.updated_at = nowIso(); room.status = 'occupied'; room.updated_at = nowIso();
    let folio = db.folios.find(f => f.reservation_id === reservation.id);
    if (!folio) {
      folio = { id: uid('fol'), reservation_id: reservation.id, status: 'open', currency: 'ETB', lines: [], created_at: nowIso(), updated_at: nowIso() };
      const roomAmount = money(reservation.rate * nights(reservation.check_in, reservation.check_out));
      folio.lines.push({ id: uid('line'), type: 'charge', description: `Room charge - ${nights(reservation.check_in, reservation.check_out)} night(s)`, amount: roomAmount, tax: money(roomAmount * Number(db.settings.tax_rate || 0)), business_date: today(), created_at: nowIso() });
      if (Number(reservation.deposit) > 0) folio.lines.push({ id: uid('line'), type: 'payment', description: 'Reservation deposit', amount: -money(reservation.deposit), tax: 0, business_date: today(), created_at: nowIso() });
      db.folios.push(folio);
    }
    audit(db, user, 'frontdesk.check_in', 'reservation', reservation.id, { room: room.number }); writeDb(db);
    return sendJson(res, 200, { ok: true, reservation: publicReservation(db, reservation), folio, balance: folioBalance(folio) });
  }
  params = routeMatch(pathname, '/api/v1/frontdesk/:id/room-move');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const reservation = db.reservations.find(r => r.id === params.id && r.status === 'checked_in');
    const newRoom = db.rooms.find(r => r.id === body.room_id);
    if (!reservation || !newRoom) return sendError(res, 404, 'Reservation or room not found.');
    if (!['clean', 'inspected'].includes(newRoom.status)) return sendError(res, 409, 'New room must be clean or inspected.');
    const oldRoom = db.rooms.find(r => r.id === reservation.room_id);
    if (oldRoom) { oldRoom.status = 'dirty'; oldRoom.updated_at = nowIso(); db.housekeepingTasks.push({ id: uid('hkt'), room_id: oldRoom.id, type: 'cleaning', priority: 'high', status: 'pending', assigned_to: null, due_at: new Date(Date.now() + 3600000).toISOString(), notes: `Room move: ${safeText(body.reason || 'Guest request', 300)}`, created_at: nowIso(), updated_at: nowIso() }); }
    newRoom.status = 'occupied'; newRoom.updated_at = nowIso(); reservation.room_id = newRoom.id; reservation.updated_at = nowIso();
    audit(db, user, 'frontdesk.room_move', 'reservation', reservation.id, { from: oldRoom?.number, to: newRoom.number, reason: safeText(body.reason, 300) }); writeDb(db);
    return sendJson(res, 200, { ok: true, reservation: publicReservation(db, reservation) });
  }
  params = routeMatch(pathname, '/api/v1/frontdesk/:id/check-out');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'frontdesk', 'finance'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { body = {}; }
    const reservation = db.reservations.find(r => r.id === params.id && r.status === 'checked_in');
    if (!reservation) return sendError(res, 404, 'Checked-in reservation not found.');
    const folio = db.folios.find(f => f.reservation_id === reservation.id);
    let balance = folioBalance(folio);
    if (Number(body.payment_amount) > 0 && folio) {
      folio.lines.push({ id: uid('line'), type: 'payment', description: safeText(body.payment_method || 'Checkout payment', 100), amount: -money(body.payment_amount), tax: 0, business_date: today(), created_at: nowIso(), reference: safeText(body.reference, 100) });
      balance = folioBalance(folio);
    }
    if (balance > 0.01 && !parseBool(body.allow_balance)) return sendError(res, 409, `Outstanding folio balance: ETB ${balance.toFixed(2)}`, 'balance_due');
    reservation.status = 'checked_out'; reservation.checked_out_at = nowIso(); reservation.updated_at = nowIso();
    if (folio) { folio.status = balance <= 0.01 ? 'closed' : 'open'; folio.updated_at = nowIso(); }
    const room = db.rooms.find(r => r.id === reservation.room_id);
    if (room) { room.status = 'dirty'; room.updated_at = nowIso(); db.housekeepingTasks.push({ id: uid('hkt'), room_id: room.id, type: 'cleaning', priority: 'high', status: 'pending', assigned_to: null, due_at: new Date(Date.now() + 2 * 3600000).toISOString(), notes: 'Checkout cleaning', created_at: nowIso(), updated_at: nowIso() }); }
    audit(db, user, 'frontdesk.check_out', 'reservation', reservation.id, { balance }); writeDb(db);
    return sendJson(res, 200, { ok: true, reservation: publicReservation(db, reservation), folio, balance });
  }

  if (method === 'GET' && pathname === '/api/v1/rooms') {
    let items = db.rooms.map(r => ({ ...r, room_type_name: roomTypeName(db, r.room_type_id) }));
    const status = url.searchParams.get('status'); if (status) items = items.filter(r => r.status === status);
    return sendJson(res, 200, { ok: true, items, room_types: db.roomTypes, total: items.length });
  }
  if (method === 'POST' && pathname === '/api/v1/rooms') {
    if (!requireRole(user, ['manager'])) return sendError(res, 403, 'Manager permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    if (!safeText(body.number) || !db.roomTypes.some(rt => rt.id === body.room_type_id)) return sendError(res, 422, 'Room number and valid room type are required.');
    if (db.rooms.some(r => r.number === safeText(body.number))) return sendError(res, 409, 'Room number already exists.');
    const room = { id: uid('room'), property_id: db.property.id, room_type_id: body.room_type_id, number: safeText(body.number, 20), floor: Number(body.floor || 1), status: 'clean', notes: safeText(body.notes, 500), version: 1, updated_at: nowIso() };
    db.rooms.push(room); audit(db, user, 'room.created', 'room', room.id, { number: room.number }); writeDb(db);
    return sendJson(res, 201, { ok: true, item: { ...room, room_type_name: roomTypeName(db, room.room_type_id) } });
  }
  params = routeMatch(pathname, '/api/v1/rooms/:id/status');
  if (params && method === 'PATCH') {
    if (!requireRole(user, ['manager', 'frontdesk', 'housekeeping'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const room = db.rooms.find(r => r.id === params.id);
    const statuses = ['clean', 'dirty', 'inspected', 'occupied', 'maintenance'];
    if (!room || !statuses.includes(body.status)) return sendError(res, 422, 'Valid room and status are required.');
    const old = room.status; room.status = body.status; room.notes = safeText(body.notes ?? room.notes, 500); room.updated_at = nowIso(); room.version = Number(room.version || 1) + 1;
    audit(db, user, 'room.status_changed', 'room', room.id, { from: old, to: room.status, reason: safeText(body.reason, 300) }); writeDb(db);
    return sendJson(res, 200, { ok: true, item: { ...room, room_type_name: roomTypeName(db, room.room_type_id) } });
  }
  if (method === 'GET' && pathname === '/api/v1/rooms/housekeeping/tasks') {
    const items = db.housekeepingTasks.map(t => ({ ...t, room_number: roomNumber(db, t.room_id), assignee_name: db.users.find(u => u.id === t.assigned_to)?.name || 'Unassigned' })).sort((a, b) => a.status.localeCompare(b.status));
    return sendJson(res, 200, { ok: true, items });
  }
  if (method === 'POST' && pathname === '/api/v1/rooms/housekeeping/tasks') {
    if (!requireRole(user, ['manager', 'frontdesk', 'housekeeping'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    if (!db.rooms.some(r => r.id === body.room_id)) return sendError(res, 422, 'Valid room is required.');
    const task = { id: uid('hkt'), room_id: body.room_id, type: safeText(body.type || 'cleaning', 50), priority: safeText(body.priority || 'normal', 20), status: 'pending', assigned_to: body.assigned_to || null, due_at: body.due_at || new Date(Date.now() + 2 * 3600000).toISOString(), notes: safeText(body.notes, 500), created_at: nowIso(), updated_at: nowIso() };
    db.housekeepingTasks.push(task); audit(db, user, 'housekeeping.task_created', 'housekeeping_task', task.id, { room: roomNumber(db, task.room_id) }); writeDb(db);
    return sendJson(res, 201, { ok: true, item: task });
  }
  params = routeMatch(pathname, '/api/v1/rooms/housekeeping/tasks/:id');
  if (params && method === 'PATCH') {
    if (!requireRole(user, ['manager', 'housekeeping'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const task = db.housekeepingTasks.find(t => t.id === params.id);
    if (!task) return sendError(res, 404, 'Task not found.');
    for (const key of ['status', 'priority', 'assigned_to', 'notes', 'due_at']) if (body[key] !== undefined) task[key] = body[key];
    task.updated_at = nowIso();
    if (task.status === 'completed') {
      task.completed_at = nowIso();
      const room = db.rooms.find(r => r.id === task.room_id);
      if (room && task.type === 'cleaning') { room.status = parseBool(body.inspected) ? 'inspected' : 'clean'; room.updated_at = nowIso(); }
    }
    audit(db, user, 'housekeeping.task_updated', 'housekeeping_task', task.id, { status: task.status }); writeDb(db);
    return sendJson(res, 200, { ok: true, item: task });
  }

  if (method === 'GET' && pathname === '/api/v1/guests') {
    let items = db.guests.slice(); const q = safeText(url.searchParams.get('q'), 100).toLowerCase();
    if (q) items = items.filter(g => `${g.first_name} ${g.last_name} ${g.phone} ${g.email}`.toLowerCase().includes(q));
    items = items.map(g => ({ ...g, stays: db.reservations.filter(r => r.guest_id === g.id).length }));
    return sendJson(res, 200, { ok: true, items, total: items.length });
  }
  if (method === 'POST' && pathname === '/api/v1/guests') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    if (!safeText(body.first_name) || !safeText(body.last_name) || !safeText(body.phone)) return sendError(res, 422, 'First name, last name and phone are required.');
    const guest = { id: uid('gst'), property_id: db.property.id, first_name: safeText(body.first_name, 80), last_name: safeText(body.last_name, 80), phone: safeText(body.phone, 40), email: safeText(body.email, 160), nationality: safeText(body.nationality || 'Ethiopian', 80), vip: parseBool(body.vip), preferences: Array.isArray(body.preferences) ? body.preferences.slice(0, 20) : [], created_at: nowIso(), updated_at: nowIso() };
    db.guests.push(guest); audit(db, user, 'guest.created', 'guest', guest.id, {}); writeDb(db); return sendJson(res, 201, { ok: true, item: guest });
  }
  params = routeMatch(pathname, '/api/v1/guests/:id');
  if (params && method === 'PATCH') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const guest = db.guests.find(g => g.id === params.id); if (!guest) return sendError(res, 404, 'Guest not found.');
    for (const key of ['first_name', 'last_name', 'phone', 'email', 'nationality', 'vip', 'preferences']) if (body[key] !== undefined) guest[key] = key === 'vip' ? parseBool(body[key]) : body[key];
    guest.updated_at = nowIso(); audit(db, user, 'guest.updated', 'guest', guest.id, { fields: Object.keys(body) }); writeDb(db); return sendJson(res, 200, { ok: true, item: guest });
  }

  if (method === 'GET' && pathname === '/api/v1/folios') {
    const items = db.folios.map(f => { const r = db.reservations.find(x => x.id === f.reservation_id); return { ...f, balance: folioBalance(f), confirmation_no: r?.confirmation_no, guest_name: r ? guestName(db, r.guest_id) : 'Unknown', room_number: r ? roomNumber(db, r.room_id) : '' }; });
    return sendJson(res, 200, { ok: true, items });
  }
  params = routeMatch(pathname, '/api/v1/folios/:id');
  if (params && method === 'GET') {
    const folio = db.folios.find(f => f.id === params.id); if (!folio) return sendError(res, 404, 'Folio not found.');
    return sendJson(res, 200, { ok: true, item: folio, balance: folioBalance(folio) });
  }
  params = routeMatch(pathname, '/api/v1/folios/:id/charges');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'frontdesk', 'finance', 'fb'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const folio = db.folios.find(f => f.id === params.id); if (!folio) return sendError(res, 404, 'Folio not found.');
    const amount = money(body.amount); if (amount <= 0 || !safeText(body.description)) return sendError(res, 422, 'Positive amount and description are required.');
    const line = { id: uid('line'), type: 'charge', description: safeText(body.description, 200), amount, tax: money(body.tax ?? amount * Number(db.settings.tax_rate || 0)), business_date: today(), created_at: nowIso(), department: safeText(body.department, 80) };
    folio.lines.push(line); folio.updated_at = nowIso(); audit(db, user, 'folio.charge_posted', 'folio', folio.id, { amount, description: line.description }); writeDb(db); return sendJson(res, 201, { ok: true, item: line, balance: folioBalance(folio) });
  }
  params = routeMatch(pathname, '/api/v1/folios/:id/payments');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'frontdesk', 'finance'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const folio = db.folios.find(f => f.id === params.id); if (!folio) return sendError(res, 404, 'Folio not found.');
    const amount = money(body.amount); if (amount <= 0) return sendError(res, 422, 'Positive payment amount is required.');
    const line = { id: uid('line'), type: 'payment', description: safeText(body.method || 'Payment', 100), amount: -amount, tax: 0, business_date: today(), created_at: nowIso(), reference: safeText(body.reference, 100) };
    folio.lines.push(line); folio.updated_at = nowIso(); audit(db, user, 'folio.payment_posted', 'folio', folio.id, { amount, method: line.description }); writeDb(db); return sendJson(res, 201, { ok: true, item: line, balance: folioBalance(folio) });
  }
  params = routeMatch(pathname, '/api/v1/folios/:id/refunds');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'finance'])) return sendError(res, 403, 'Manager or finance permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const folio = db.folios.find(f => f.id === params.id); if (!folio) return sendError(res, 404, 'Folio not found.');
    const amount = money(body.amount); if (amount <= 0 || !safeText(body.reason)) return sendError(res, 422, 'Positive amount and refund reason are required.');
    const line = { id: uid('line'), type: 'refund', description: `Refund: ${safeText(body.reason, 160)}`, amount, tax: 0, business_date: today(), created_at: nowIso(), reference: safeText(body.reference, 100) };
    folio.lines.push(line); folio.updated_at = nowIso(); audit(db, user, 'folio.refund_posted', 'folio', folio.id, { amount, reason: body.reason }); writeDb(db); return sendJson(res, 201, { ok: true, item: line, balance: folioBalance(folio) });
  }
  params = routeMatch(pathname, '/api/v1/folios/:id/invoice');
  if (params && method === 'POST') {
    const folio = db.folios.find(f => f.id === params.id); if (!folio) return sendError(res, 404, 'Folio not found.');
    folio.invoice_no = folio.invoice_no || `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`; folio.invoice_issued_at = nowIso(); audit(db, user, 'folio.invoice_issued', 'folio', folio.id, { invoice_no: folio.invoice_no }); writeDb(db);
    return sendJson(res, 200, { ok: true, invoice_no: folio.invoice_no, issued_at: folio.invoice_issued_at, balance: folioBalance(folio) });
  }

  if (method === 'GET' && pathname === '/api/v1/fb/menu') return sendJson(res, 200, { ok: true, items: db.menu });
  if (method === 'GET' && pathname === '/api/v1/fb/orders') return sendJson(res, 200, { ok: true, items: db.fbOrders });
  if (method === 'POST' && pathname === '/api/v1/fb/orders') {
    if (!requireRole(user, ['manager', 'fb'])) return sendError(res, 403, 'F&B permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    if (!Array.isArray(body.items) || !body.items.length) return sendError(res, 422, 'At least one menu item is required.');
    const items = body.items.map(i => { const menu = db.menu.find(m => m.id === i.menu_id); return menu ? { menu_id: menu.id, name: menu.name, qty: Math.max(1, Number(i.qty || 1)), unit_price: menu.price } : null; }).filter(Boolean);
    if (!items.length) return sendError(res, 422, 'No valid menu items supplied.');
    const total = money(items.reduce((s, i) => s + i.qty * i.unit_price, 0));
    const order = { id: uid('fbo'), order_no: `FBO-${String(Date.now()).slice(-6)}`, outlet_id: safeText(body.outlet_id || 'outlet_restaurant', 80), room_id: body.room_id || null, reservation_id: body.reservation_id || null, guest_name: safeText(body.guest_name || (body.reservation_id ? guestName(db, db.reservations.find(r => r.id === body.reservation_id)?.guest_id) : 'Walk-in'), 160), items, total, status: 'new', settlement: safeText(body.settlement || 'cash', 40), created_at: nowIso(), updated_at: nowIso() };
    db.fbOrders.push(order); audit(db, user, 'fb.order_created', 'fb_order', order.id, { total }); writeDb(db); return sendJson(res, 201, { ok: true, item: order });
  }
  params = routeMatch(pathname, '/api/v1/fb/orders/:id/status');
  if (params && method === 'PATCH') {
    if (!requireRole(user, ['manager', 'fb'])) return sendError(res, 403, 'F&B permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const order = db.fbOrders.find(o => o.id === params.id); if (!order) return sendError(res, 404, 'Order not found.');
    const statuses = ['new', 'preparing', 'ready', 'served', 'settled', 'cancelled']; if (!statuses.includes(body.status)) return sendError(res, 422, 'Invalid order status.');
    order.status = body.status; order.updated_at = nowIso(); audit(db, user, 'fb.order_status', 'fb_order', order.id, { status: order.status }); writeDb(db); return sendJson(res, 200, { ok: true, item: order });
  }
  params = routeMatch(pathname, '/api/v1/fb/orders/:id/settle');
  if (params && method === 'POST') {
    if (!requireRole(user, ['manager', 'fb', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { body = {}; }
    const order = db.fbOrders.find(o => o.id === params.id); if (!order) return sendError(res, 404, 'Order not found.');
    order.settlement = safeText(body.settlement || order.settlement || 'cash', 40);
    if (order.settlement === 'room') {
      const reservation = db.reservations.find(r => r.id === (body.reservation_id || order.reservation_id) && r.status === 'checked_in');
      const folio = reservation && db.folios.find(f => f.reservation_id === reservation.id);
      if (!folio) return sendError(res, 409, 'Active room folio not found.');
      folio.lines.push({ id: uid('line'), type: 'charge', description: `F&B ${order.order_no}`, amount: order.total, tax: money(order.total * Number(db.settings.tax_rate || 0)), business_date: today(), created_at: nowIso(), department: 'F&B' }); folio.updated_at = nowIso();
    }
    order.status = 'settled'; order.updated_at = nowIso(); audit(db, user, 'fb.order_settled', 'fb_order', order.id, { settlement: order.settlement, total: order.total }); writeDb(db); return sendJson(res, 200, { ok: true, item: order });
  }

  if (method === 'GET' && pathname === '/api/v1/revenue/overview') {
    const summary = dashboardSummary(db);
    const daily = Array.from({ length: 7 }, (_, i) => ({ date: dateOffset(i - 6), room_revenue: money(summary.kpis.revenue * (0.65 + i * 0.07)), occupancy: Math.min(100, money(summary.kpis.occupancy * (0.75 + i * 0.05))) }));
    const roomRevenue = summary.kpis.revenue; const occupiedRoomNights = Math.max(1, db.reservations.filter(r => r.status === 'checked_in').reduce((s, r) => s + nights(r.check_in, r.check_out), 0));
    return sendJson(res, 200, { ok: true, metrics: { occupancy: summary.kpis.occupancy, adr: money(roomRevenue / occupiedRoomNights), revpar: money((roomRevenue / occupiedRoomNights) * summary.kpis.occupancy / 100), room_revenue: roomRevenue, forecast_30d: money(roomRevenue * 4.6) }, daily, recommendations: db.roomTypes.map(rt => ({ room_type_id: rt.id, room_type: rt.name, current_rate: rt.base_rate, recommended_rate: money(rt.base_rate * (summary.kpis.occupancy > 75 ? 1.12 : summary.kpis.occupancy < 40 ? 0.92 : 1.04)), reason: summary.kpis.occupancy > 75 ? 'High occupancy demand' : summary.kpis.occupancy < 40 ? 'Low occupancy stimulation' : 'Balanced pickup trend' })) });
  }
  if (method === 'GET' && pathname === '/api/v1/revenue/rates') return sendJson(res, 200, { ok: true, items: db.rates.map(r => ({ ...r, room_type_name: roomTypeName(db, r.room_type_id) })) });
  params = routeMatch(pathname, '/api/v1/revenue/rates/:id');
  if (params && method === 'PUT') {
    if (!requireRole(user, ['manager'])) return sendError(res, 403, 'Manager permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const rate = db.rates.find(r => r.id === params.id); if (!rate) return sendError(res, 404, 'Rate not found.');
    if (Number(body.amount) <= 0) return sendError(res, 422, 'Positive amount required.');
    const old = rate.amount; rate.amount = money(body.amount); rate.updated_at = nowIso(); audit(db, user, 'revenue.rate_updated', 'rate', rate.id, { from: old, to: rate.amount }); writeDb(db); return sendJson(res, 200, { ok: true, item: rate });
  }

  params = routeMatch(pathname, '/api/v1/reports/:type');
  if (params && method === 'GET') {
    const type = params.type;
    if (type === 'occupancy') return sendJson(res, 200, { ok: true, report: { generated_at: nowIso(), ...dashboardSummary(db).room_status, occupancy: dashboardSummary(db).kpis.occupancy } });
    if (type === 'finance') return sendJson(res, 200, { ok: true, report: { generated_at: nowIso(), total_revenue: dashboardSummary(db).kpis.revenue, payments: dashboardSummary(db).kpis.payments, receivables: money(db.folios.reduce((s, f) => s + Math.max(0, folioBalance(f)), 0)), refunds: money(db.folios.reduce((s, f) => s + (f.lines || []).filter(l => l.type === 'refund').reduce((a, l) => a + Number(l.amount || 0), 0), 0)) } });
    if (type === 'housekeeping') return sendJson(res, 200, { ok: true, report: { generated_at: nowIso(), pending: db.housekeepingTasks.filter(t => t.status === 'pending').length, in_progress: db.housekeepingTasks.filter(t => t.status === 'in_progress').length, completed: db.housekeepingTasks.filter(t => t.status === 'completed').length, high_priority: db.housekeepingTasks.filter(t => t.priority === 'high' && t.status !== 'completed').length } });
    if (type === 'audit') return sendJson(res, 200, { ok: true, report: db.auditLogs.slice(0, 200) });
    if (type === 'guest') return sendJson(res, 200, { ok: true, report: { total_guests: db.guests.length, vip_guests: db.guests.filter(g => g.vip).length, repeat_guests: db.guests.filter(g => db.reservations.filter(r => r.guest_id === g.id).length > 1).length, sources: Object.fromEntries([...new Set(db.reservations.map(r => r.source))].map(s => [s, db.reservations.filter(r => r.source === s).length])) } });
    return sendError(res, 404, 'Report type not found.');
  }

  if (method === 'GET' && pathname === '/api/v1/admin/users') {
    if (!requireRole(user, ['manager'])) return sendError(res, 403, 'Manager permission required.', 'forbidden');
    return sendJson(res, 200, { ok: true, items: db.users.map(({ password_hash, ...u }) => u) });
  }
  if (method === 'POST' && pathname === '/api/v1/admin/users') {
    if (!requireRole(user, ['manager'])) return sendError(res, 403, 'Manager permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const email = safeText(body.email, 160).toLowerCase(); if (!email || !safeText(body.name) || String(body.password || '').length < 8) return sendError(res, 422, 'Name, email and password of at least 8 characters are required.');
    if (db.users.some(u => u.email.toLowerCase() === email)) return sendError(res, 409, 'Email already exists.');
    const newUser = { id: uid('usr'), property_id: db.property.id, name: safeText(body.name, 120), email, password_hash: passwordHash(body.password), role: safeText(body.role || 'frontdesk', 40), department: safeText(body.department, 80), active: true, created_at: nowIso(), updated_at: nowIso() };
    db.users.push(newUser); audit(db, user, 'admin.user_created', 'user', newUser.id, { role: newUser.role }); writeDb(db); const { password_hash, ...safe } = newUser; return sendJson(res, 201, { ok: true, item: safe });
  }
  params = routeMatch(pathname, '/api/v1/admin/users/:id');
  if (params && method === 'PATCH') {
    if (!requireRole(user, ['manager'])) return sendError(res, 403, 'Manager permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    const target = db.users.find(u => u.id === params.id); if (!target) return sendError(res, 404, 'User not found.');
    for (const key of ['name', 'role', 'department', 'active']) if (body[key] !== undefined) target[key] = key === 'active' ? parseBool(body[key]) : body[key];
    if (body.password) { if (String(body.password).length < 8) return sendError(res, 422, 'Password must be at least 8 characters.'); target.password_hash = passwordHash(body.password); }
    target.updated_at = nowIso(); audit(db, user, 'admin.user_updated', 'user', target.id, { fields: Object.keys(body) }); writeDb(db); const { password_hash, ...safe } = target; return sendJson(res, 200, { ok: true, item: safe });
  }
  if (method === 'GET' && pathname === '/api/v1/admin/audit') {
    if (!requireRole(user, ['manager', 'finance'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    return sendJson(res, 200, { ok: true, items: db.auditLogs.slice(0, Number(url.searchParams.get('limit') || 200)) });
  }
  if (method === 'GET' && pathname === '/api/v1/admin/settings') return sendJson(res, 200, { ok: true, item: db.settings, property: db.property });
  if (method === 'PATCH' && pathname === '/api/v1/admin/settings') {
    if (!requireRole(user, ['manager'])) return sendError(res, 403, 'Manager permission required.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    db.settings = { ...db.settings, ...body }; audit(db, user, 'admin.settings_updated', 'settings', 'property', { fields: Object.keys(body) }); writeDb(db); return sendJson(res, 200, { ok: true, item: db.settings });
  }

  if (method === 'GET' && pathname === '/api/v1/integrations/status') return sendJson(res, 200, { ok: true, items: db.integrations });
  params = routeMatch(pathname, '/api/v1/integrations/webhooks/:provider');
  if (params && method === 'POST') {
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    audit(db, user, 'integration.webhook_received', 'integration', params.provider, { keys: Object.keys(body), idempotency_key: req.headers['idempotency-key'] || null }); writeDb(db); return sendJson(res, 202, { ok: true, accepted: true, provider: params.provider });
  }
  if (method === 'GET' && pathname === '/api/v1/notifications') return sendJson(res, 200, { ok: true, items: db.notifications.slice().reverse() });
  if (method === 'POST' && pathname === '/api/v1/notifications/send') {
    if (!requireRole(user, ['manager', 'frontdesk'])) return sendError(res, 403, 'Insufficient permission.', 'forbidden');
    let body; try { body = await readBody(req); } catch (e) { return sendError(res, e.status || 400, e.message); }
    if (!safeText(body.recipient) || !safeText(body.message)) return sendError(res, 422, 'Recipient and message are required.');
    const notification = { id: uid('ntf'), channel: safeText(body.channel || 'sms', 20), recipient: safeText(body.recipient, 160), message: safeText(body.message, 1000), status: 'queued', created_by: user.id, created_at: nowIso() };
    db.notifications.push(notification); audit(db, user, 'notification.queued', 'notification', notification.id, { channel: notification.channel }); writeDb(db); return sendJson(res, 202, { ok: true, item: notification });
  }

  return sendError(res, 404, 'API endpoint not found.', 'not_found');
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const requested = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!requested.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden.');
  let filePath = requested;
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (!path.extname(pathname)) filePath = path.join(PUBLIC_DIR, 'app.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, 'Page not found.', 'not_found');
    securityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    if (['.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.webmanifest'].includes(path.extname(filePath).toLowerCase())) res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    return sendError(res, err.status || 500, err.status ? err.message : 'Internal server error.', 'internal_error');
  }
});

let shuttingDown = false;

async function startServer() {
  ensureDb();
  const storage = await supabaseStore.initialize({
    readLocal: readDb,
    writeLocal: db => writeDb(db, { skipRemote: true })
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Hamilton International Hotel Smart HMS running on http://localhost:${PORT}`);
    console.log(`Storage backend: ${storage.backend}${storage.connected ? ' (connected)' : ''}`);
    if (storage.last_error) console.warn(`Storage warning: ${storage.last_error}`);
    if (JWT_SECRET.startsWith('development-only')) console.warn('WARNING: Set HMS_JWT_SECRET before production use.');
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: saving pending changes...`);
  try { await supabaseStore.flush(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer().catch(error => {
  console.error(`Failed to start HMS: ${error.message}`);
  process.exit(1);
});

module.exports = { server, seedDatabase, readDb, writeDb, startServer };
