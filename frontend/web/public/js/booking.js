'use strict';
const inEl=document.getElementById('checkIn'),outEl=document.getElementById('checkOut'),typeEl=document.getElementById('roomType');
const iso=d=>d.toISOString().slice(0,10);const todayDate=new Date();const tomorrow=new Date(Date.now()+86400000);inEl.value=iso(todayDate);outEl.value=iso(tomorrow);inEl.min=iso(todayDate);outEl.min=iso(tomorrow);
async function loadAvailability(){try{const data=await HMS.get(`/api/v1/public/availability?check_in=${encodeURIComponent(inEl.value)}&check_out=${encodeURIComponent(outEl.value)}`);typeEl.innerHTML=data.room_types.map(rt=>`<option value="${rt.id}" ${rt.available<1?'disabled':''}>${esc(rt.name)} — ${fmtMoney(rt.base_rate)} / night (${rt.available} available)</option>`).join('');document.getElementById('roomCards').innerHTML=data.room_types.map((rt,i)=>`<article class="room-card"><div class="room-art"><span>${['♛','◈','✦','⌂'][i]||'◫'}</span></div><div class="room-content"><h3>${esc(rt.name)}</h3><div class="muted" style="font-size:12px">Up to ${rt.capacity} guests · Smart room service</div><div class="room-price">From ${fmtMoney(rt.base_rate)} / night</div></div></article>`).join('')}catch(err){toast(err.message,'error')}}
inEl.addEventListener('change',()=>{const next=new Date(`${inEl.value}T00:00:00`);next.setDate(next.getDate()+1);outEl.min=iso(next);if(outEl.value<=inEl.value)outEl.value=iso(next);loadAvailability()});outEl.addEventListener('change',loadAvailability);loadAvailability();
document.getElementById('bookingForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const btn=form.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Creating reservation...';try{const body=Object.fromEntries(new FormData(form).entries());body.adults=Number(body.adults);body.children=Number(body.children);const data=await HMS.post('/api/v1/public/reservations',body);form.classList.add('hidden');const result=document.getElementById('bookingResult');result.classList.remove('hidden');result.innerHTML=`<div style="padding:24px;border-radius:16px;background:#e8f7f1;text-align:center"><div style="font-size:38px">✓</div><h3 style="margin:8px 0">Reservation received</h3><p class="muted">Your Hamilton confirmation number is</p><div class="mono" style="font-size:22px;font-weight:900;color:var(--teal)">${esc(data.confirmation_no)}</div><p class="help">Our front desk will review the request and contact you when needed.</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-primary" href="/guest-login.html?confirmation=${encodeURIComponent(data.confirmation_no)}&contact=${encodeURIComponent(body.email||body.phone||'')}">Open guest dashboard</a><button class="btn btn-soft" id="anotherBooking">Make another booking</button></div></div>`;document.getElementById('anotherBooking').onclick=()=>{result.classList.add('hidden');form.classList.remove('hidden');form.reset();inEl.value=iso(todayDate);outEl.value=iso(tomorrow);loadAvailability()}}catch(err){toast(err.message,'error')}finally{btn.disabled=false;btn.textContent='Check availability & reserve'}});


// Public mobile slide menu
const publicMenuBtn=document.getElementById('publicMenuBtn');
const publicMobileMenu=document.getElementById('publicMobileMenu');
const publicMenuOverlay=document.getElementById('publicMenuOverlay');
const publicMenuClose=document.getElementById('publicMenuClose');
function setPublicMenu(open){
  if(!publicMenuBtn||!publicMobileMenu||!publicMenuOverlay)return;
  const shouldOpen=Boolean(open)&&window.matchMedia('(max-width:900px)').matches;
  publicMobileMenu.classList.toggle('open',shouldOpen);
  publicMenuOverlay.classList.toggle('open',shouldOpen);
  document.body.classList.toggle('public-menu-open',shouldOpen);
  publicMenuBtn.setAttribute('aria-expanded',String(shouldOpen));
  publicMobileMenu.setAttribute('aria-hidden',String(!shouldOpen));
  publicMenuBtn.textContent=shouldOpen?'×':'☰';
}
if(publicMenuBtn){
  publicMenuBtn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setPublicMenu(!publicMobileMenu.classList.contains('open'))});
  publicMenuOverlay.addEventListener('click',()=>setPublicMenu(false));
  publicMenuClose.addEventListener('click',()=>setPublicMenu(false));
  publicMobileMenu.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>setPublicMenu(false)));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setPublicMenu(false)});
  window.addEventListener('resize',()=>{if(window.innerWidth>900)setPublicMenu(false)});
}

if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
