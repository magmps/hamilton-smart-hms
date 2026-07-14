'use strict';
const GuestPortal={
  token:localStorage.getItem('hms_guest_token')||'',
  async request(path,options={}){
    const res=await fetch(path,{...options,headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.token}`,...(options.headers||{})}});
    const data=await res.json().catch(()=>({}));
    if(res.status===401){localStorage.removeItem('hms_guest_token');location.href='/guest-login.html';throw new Error('Guest session expired')}
    if(!res.ok)throw new Error(data?.error?.message||`Request failed (${res.status})`);
    return data;
  },
  get(path){return this.request(path)},
  post(path,body={}){return this.request(path,{method:'POST',body:JSON.stringify(body)})}
};
let guestData=null;
function statusBadge(status){return `<span class="badge ${esc(status)}">${esc(String(status||'').replaceAll('_',' '))}</span>`}
function renderKpis(data){
  const active=data.reservations.filter(r=>!['cancelled','checked_out','no_show'].includes(r.status));
  const outstanding=data.reservations.reduce((s,r)=>s+Math.max(0,Number(r.folio?.balance||0)),0);
  const next=active.slice().sort((a,b)=>String(a.check_in).localeCompare(String(b.check_in)))[0];
  document.getElementById('guestKpis').innerHTML=`
    <article class="guest-kpi"><span>Active bookings</span><b>${active.length}</b></article>
    <article class="guest-kpi"><span>Next check-in</span><b class="guest-kpi-date">${next?fmtDate(next.check_in):'—'}</b></article>
    <article class="guest-kpi"><span>Outstanding balance</span><b>${fmtMoney(outstanding)}</b></article>
    <article class="guest-kpi"><span>Service requests</span><b>${data.requests.length}</b></article>`;
}
function renderReservations(items){
  const root=document.getElementById('guestReservations');
  if(!items.length){root.innerHTML='<div class="empty">No reservations found.</div>';return}
  root.innerHTML=items.map(r=>{
    const lines=r.folio?.lines||[];
    const payments=Math.abs(lines.filter(l=>l.type==='payment').reduce((s,l)=>s+Number(l.amount||0),0));
    return `<article class="guest-reservation-card">
      <div class="guest-reservation-head"><div><span class="mono guest-confirmation">${esc(r.confirmation_no)}</span><h3>${esc(r.room_type_name)}</h3></div>${statusBadge(r.status)}</div>
      <div class="guest-reservation-grid">
        <div><span>Check-in</span><b>${fmtDate(r.check_in)}</b></div><div><span>Check-out</span><b>${fmtDate(r.check_out)}</b></div>
        <div><span>Room</span><b>${esc(r.room_number||'Unassigned')}</b></div><div><span>Guests</span><b>${Number(r.adults||0)} adults · ${Number(r.children||0)} children</b></div>
        <div><span>Nightly rate</span><b>${fmtMoney(r.rate)}</b></div><div><span>Estimated stay</span><b>${fmtMoney(r.estimated_total)}</b></div>
        <div><span>Paid</span><b>${fmtMoney(payments||r.deposit||0)}</b></div><div><span>Folio balance</span><b>${fmtMoney(r.folio?.balance||0)}</b></div>
      </div>
      ${r.notes?`<div class="guest-note"><b>Booking note:</b> ${esc(r.notes)}</div>`:''}
      <div class="guest-reservation-actions"><button class="btn btn-soft btn-sm" data-request-reservation="${esc(r.id)}">Request service</button>${r.status==='reserved'?`<button class="btn btn-danger btn-sm" data-cancel-reservation="${esc(r.id)}">Cancel booking</button>`:''}</div>
    </article>`
  }).join('');
  root.querySelectorAll('[data-request-reservation]').forEach(btn=>btn.onclick=()=>{document.getElementById('requestReservation').value=btn.dataset.requestReservation;document.getElementById('requestMessage').focus();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})});
  root.querySelectorAll('[data-cancel-reservation]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Cancel this reservation?'))return;try{await GuestPortal.post(`/api/v1/guest/reservations/${encodeURIComponent(btn.dataset.cancelReservation)}/cancel`);toast('Reservation cancelled');await loadDashboard()}catch(err){toast(err.message,'error')}});
}
function renderRequests(items){
  const root=document.getElementById('guestRequests');
  root.innerHTML=items.length?items.map(x=>`<div class="guest-request-item"><div><b>${esc(x.type)}</b>${statusBadge(x.status)}</div><p>${esc(x.message)}</p><small>${new Date(x.created_at).toLocaleString()}</small></div>`).join(''):'<div class="empty">No requests yet.</div>';
}
async function loadDashboard(){
  if(!GuestPortal.token){location.href='/guest-login.html';return}
  try{
    const data=await GuestPortal.get('/api/v1/guest/dashboard');guestData=data;
    document.getElementById('guestName').textContent=`${data.guest.first_name} ${data.guest.last_name}`;
    document.getElementById('guestContactText').textContent=data.guest.email||data.guest.phone||'';
    document.getElementById('welcomeTitle').textContent=`Welcome, ${data.guest.first_name}`;
    document.getElementById('requestReservation').innerHTML=data.reservations.map(r=>`<option value="${esc(r.id)}">${esc(r.confirmation_no)} · ${esc(r.room_type_name)}</option>`).join('');
    renderKpis(data);renderReservations(data.reservations);renderRequests(data.requests);
  }catch(err){toast(err.message,'error')}
}
document.getElementById('guestLogoutBtn').onclick=()=>{localStorage.removeItem('hms_guest_token');location.href='/guest-login.html'};
document.getElementById('guestRefreshBtn').onclick=loadDashboard;
document.getElementById('guestRequestForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Sending...';try{await GuestPortal.post('/api/v1/guest/requests',{reservation_id:document.getElementById('requestReservation').value,type:document.getElementById('requestType').value,message:document.getElementById('requestMessage').value.trim()});document.getElementById('requestMessage').value='';toast('Your request was sent to the hotel');await loadDashboard()}catch(err){toast(err.message,'error')}finally{btn.disabled=false;btn.textContent='Send request'}});
loadDashboard();
