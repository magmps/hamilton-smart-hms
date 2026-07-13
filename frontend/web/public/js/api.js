'use strict';
const HMS={
  token:localStorage.getItem('hms_token')||'',
  async request(path,options={}){
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(this.token)headers.Authorization=`Bearer ${this.token}`;
    const res=await fetch(path,{...options,headers});
    const data=await res.json().catch(()=>({ok:false,error:{message:'Invalid server response'}}));
    if(res.status===401&&location.pathname.endsWith('app.html')){localStorage.removeItem('hms_token');location.href='/login.html';throw new Error('Session expired');}
    if(!res.ok)throw new Error(data?.error?.message||`Request failed (${res.status})`);
    return data;
  },
  get(path){return this.request(path)},
  post(path,body={}){return this.request(path,{method:'POST',body:JSON.stringify(body)})},
  patch(path,body={}){return this.request(path,{method:'PATCH',body:JSON.stringify(body)})},
  put(path,body={}){return this.request(path,{method:'PUT',body:JSON.stringify(body)})}
};
function fmtMoney(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'ETB',maximumFractionDigits:0}).format(Number(v||0))}
function fmtDate(v){if(!v)return'—';const d=new Date(`${String(v).slice(0,10)}T00:00:00`);return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(d)}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(message,type='success'){const wrap=document.getElementById('toasts');if(!wrap)return;const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<b>${type==='error'?'Action failed':'Hamilton HMS'}</b><div style="font-size:12px;margin-top:3px">${esc(message)}</div>`;wrap.appendChild(el);setTimeout(()=>el.remove(),3800)}
