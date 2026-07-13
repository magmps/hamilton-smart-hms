'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 18888;
const TEST_DATA = path.join(ROOT, 'backend/api-gateway/data/test-hotel.json');
try { fs.unlinkSync(TEST_DATA); } catch {}
const child = spawn(process.execPath, [path.join(ROOT, 'backend/api-gateway/src/server.js')], { env: { ...process.env, PORT: String(PORT), HMS_JWT_SECRET: 'test-secret-that-is-long-enough', HMS_DATA_FILE: TEST_DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
let output=''; child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function req(pathname, options={}){const res=await fetch(`http://127.0.0.1:${PORT}${pathname}`,options);const data=await res.json();if(!res.ok)throw new Error(`${res.status} ${JSON.stringify(data)}`);return data}
(async()=>{try{
  await sleep(550);
  const health=await req('/api/v1/health'); if(!health.ok)throw new Error('health failed');
  const login=await req('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@hamiltonhotel.et',password:'Admin@123'})});
  const headers={'Authorization':`Bearer ${login.token}`,'Content-Type':'application/json'};
  const dash=await req('/api/v1/dashboard/summary',{headers}); if(typeof dash.kpis.occupancy!=='number')throw new Error('dashboard failed');
  const rooms=await req('/api/v1/rooms',{headers}); if(!rooms.items.length)throw new Error('rooms failed');
  const reservations=await req('/api/v1/reservations',{headers}); if(!reservations.items.length)throw new Error('reservations failed');
  const publicAvail=await req('/api/v1/public/availability'); if(!publicAvail.room_types.length)throw new Error('public availability failed');
  console.log('API smoke tests passed');
  child.kill('SIGTERM'); try{fs.unlinkSync(TEST_DATA)}catch{}; process.exit(0);
}catch(err){console.error(err);console.error(output);child.kill('SIGTERM');try{fs.unlinkSync(TEST_DATA)}catch{};process.exit(1)}})();
