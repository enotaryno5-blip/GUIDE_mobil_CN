const CACHE='qr-windows-v4';
const CORE=['./','./index.html','./manifest.webmanifest','./icon.svg','./bridge.js'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
});

self.addEventListener('activate',e=>{
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  ]));
});

self.addEventListener('fetch',e=>{
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isHTMLNavigation = e.request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    url.pathname.startsWith('/GUIDE_mobil_CN/qr-camera-test/');

  if (isHTMLNavigation) {
    e.respondWith((async()=>{
      try {
        const r = await fetch(e.request, {cache:'no-store'});
        let html = await r.text();
        if (!html.includes('bridge.js')) {
          html = html.replace('</body>', '<script src="./bridge.js?v=4"></script></body>');
        }
        const headers = new Headers(r.headers);
        headers.set('Content-Type','text/html; charset=utf-8');
        headers.set('Cache-Control','no-store');
        return new Response(html,{status:r.status,statusText:r.statusText,headers});
      } catch (_) {
        const cached = await caches.match('./index.html');
        if (!cached) throw _;
        let html = await cached.text();
        if (!html.includes('bridge.js')) {
          html = html.replace('</body>', '<script src="./bridge.js?v=4"></script></body>');
        }
        return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      }
    })());
    return;
  }

  e.respondWith(fetch(e.request).then(r=>{
    const copy=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
    return r;
  }).catch(()=>caches.match(e.request)));
});
