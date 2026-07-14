'use strict';
const CACHE='hamilton-hms-v5';
const CORE=['/','/guest-login.html','/guest.html','/login.html','/app.html','/css/styles.css?v=5','/js/api.js?v=5','/js/guest-login.js?v=5','/js/guest.js?v=5','/assets/hamilton-logo-mark.png?v=5','/assets/hamilton-logo-192.png?v=5'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).catch(()=>{}))});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.pathname.startsWith('/api/'))return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});return response}).catch(()=>caches.match(event.request).then(r=>r||caches.match('/'))))});
