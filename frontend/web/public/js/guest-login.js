'use strict';
const existingGuestToken=localStorage.getItem('hms_guest_token');
if(existingGuestToken)location.href='/guest.html';
const params=new URLSearchParams(location.search);
document.getElementById('confirmationNo').value=params.get('confirmation')||'';
document.getElementById('guestContact').value=params.get('contact')||'';
document.getElementById('guestLoginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=document.getElementById('guestLoginBtn');
  btn.disabled=true;btn.textContent='Verifying booking...';
  try{
    const data=await HMS.post('/api/v1/guest/auth',{
      confirmation_no:document.getElementById('confirmationNo').value.trim(),
      contact:document.getElementById('guestContact').value.trim()
    });
    localStorage.setItem('hms_guest_token',data.token);
    toast(`Welcome, ${data.guest.name}`);
    setTimeout(()=>location.href='/guest.html',350);
  }catch(err){toast(err.message,'error')}
  finally{btn.disabled=false;btn.textContent='Open guest dashboard'}
});
