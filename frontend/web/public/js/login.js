'use strict';
if(HMS.token)location.href='/app.html';
const form=document.getElementById('loginForm');
form.addEventListener('submit',async e=>{e.preventDefault();const btn=document.getElementById('loginBtn');btn.disabled=true;btn.textContent='Signing in...';try{const data=await HMS.post('/api/v1/auth/login',{email:document.getElementById('email').value,password:document.getElementById('password').value});localStorage.setItem('hms_token',data.token);HMS.token=data.token;toast(`Welcome, ${data.user.name}`);setTimeout(()=>location.href='/app.html',450)}catch(err){toast(err.message,'error')}finally{btn.disabled=false;btn.textContent='Sign in securely'}});
document.querySelectorAll('.demo-user').forEach(btn=>btn.addEventListener('click',()=>{document.getElementById('email').value=btn.dataset.email;document.getElementById('password').value=btn.dataset.password;toast(`${btn.querySelector('b').textContent} account selected`)}));
