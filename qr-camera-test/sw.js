const CACHE='qr-windows-v13';
const CORE=['./','./index.html','./pair.html','./manifest.webmanifest','./icon.svg','./bridge.js','./scan-opt.js'];

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

function injectScripts(html){
  let tags='';
  if(!html.includes('scan-opt.js'))tags+='<script src="./scan-opt.js?v=13"></script>';
  if(!html.includes('bridge.js'))tags+='<script src="./bridge.js?v=13"></script>';
  if(!tags)return html;
  if(html.includes('</head>'))return html.replace('</head>',tags+'</head>');
  return html.replace('</body>',tags+'</body>');
}

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  const isHTML=e.request.mode==='navigate'&&url.origin===self.location.origin&&url.pathname.startsWith('/GUIDE_mobil_CN/qr-camera-test/');
  if(isHTML){
    e.respondWith((async()=>{
      try{
        const r=await fetch(e.request,{cache:'no-store'});
        const html=injectScripts(await r.text());
        const h=new Headers(r.headers);h.set('Content-Type','text/html; charset=utf-8');h.set('Cache-Control','no-store');
        return new Response(html,{status:r.status,statusText:r.statusText,headers:h});
      }catch(err){
        const cached=await caches.match('./index.html');
        if(!cached)throw err;
        const html=injectScripts(await cached.text());
        return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      }
    })());
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(e.request)));
});
