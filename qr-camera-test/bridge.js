(() => {
  const KEY='qr_windows_receiver_url_v1';

  function isPrivateIPv4(host){
    const m=String(host||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if(!m)return false;
    const a=m.slice(1).map(Number);
    if(a.some(n=>n<0||n>255))return false;
    return a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||(a[0]===169&&a[1]===254);
  }

  function validReceiver(raw){
    try{
      const u=new URL(String(raw||''));
      if(u.protocol!=='http:'||!isPrivateIPv4(u.hostname)||u.pathname!=='/scan')return '';
      const token=u.searchParams.get('token')||'';
      if(token.length<12)return '';
      return u.toString();
    }catch(_){return ''}
  }

  // Quan trọng: bridge được nạp ở HEAD trước script chính của trình quét.
  // Nếu lần ghép nối đầu truyền Receiver qua #receiver=..., lưu nó NGAY tại đây
  // để script chính đọc được cổng/token ngay từ lần mở đầu tiên.
  try{
    const h=location.hash||'';
    if(h.startsWith('#receiver=')){
      const receiver=validReceiver(decodeURIComponent(h.slice(10)));
      if(receiver){
        localStorage.setItem(KEY,receiver);
        history.replaceState(null,'',location.pathname+location.search);
      }
    }
  }catch(_){}

  if(!window.fetch)return;
  const nativeFetch=window.fetch.bind(window);

  function localURL(input){
    try{const raw=input instanceof Request?input.url:String(input);const u=new URL(raw,location.href);if(u.protocol!=='http:'||!isPrivateIPv4(u.hostname))return null;return u}catch(_){return null}
  }
  async function bodyText(input,init){
    try{if(init&&typeof init.body==='string')return init.body;if(input instanceof Request)return await input.clone().text()}catch(_){}return'';
  }
  function cameraLooksLive(){
    const v=document.getElementById('video');
    const s=v&&v.srcObject;
    if(!s||!s.getVideoTracks)return false;
    return s.getVideoTracks().some(t=>t.readyState==='live');
  }
  let recoverTimer=null;
  function ensureCamera(delay=250){
    clearTimeout(recoverTimer);
    recoverTimer=setTimeout(()=>{
      if(document.visibilityState==='hidden'||cameraLooksLive())return;
      const start=document.getElementById('start');
      if(start&&!start.disabled){try{start.click()}catch(_){}}
    },delay);
  }
  function recoveryBurst(){
    ensureCamera(180);setTimeout(()=>ensureCamera(420),420);setTimeout(()=>ensureCamera(950),950);setTimeout(()=>ensureCamera(1700),1700);
  }

  window.fetch=async function(input,init){
    const u=localURL(input);
    if(!u)return nativeFetch(input,init);

    if(u.pathname==='/health'){
      return new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}});
    }

    if(u.pathname==='/scan'){
      const text=await bodyText(input,init);
      if(!text)return Promise.reject(new TypeError('Missing scan text'));

      try{
        const c=new AbortController();
        const tid=setTimeout(()=>c.abort(),900);
        let req;
        try{
          req=new Request(u.toString(),{method:'POST',mode:'no-cors',cache:'no-store',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:text,signal:c.signal,targetAddressSpace:'local'});
        }catch(_){
          req=new Request(u.toString(),{method:'POST',mode:'no-cors',cache:'no-store',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:text,signal:c.signal});
        }
        await nativeFetch(req);
        clearTimeout(tid);
        return new Response(null,{status:204});
      }catch(_){}

      u.searchParams.set('text',text);
      u.searchParams.set('enter','1');
      u.searchParams.set('source','web');
      try{sessionStorage.setItem('qr_resume_camera','1')}catch(_){}
      setTimeout(()=>{try{location.assign(u.toString())}catch(_){location.href=u.toString()}},0);
      setTimeout(()=>recoveryBurst(),1100);
      return new Response(null,{status:204});
    }
    return nativeFetch(input,init);
  };

  function initUI(){
    const saved=localStorage.getItem(KEY)||'';
    const connect=document.getElementById('connect');
    if(saved&&connect)connect.textContent='ĐỔI WINDOWS';
    if(saved)recoveryBurst();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initUI,{once:true});else initUI();
  window.addEventListener('pageshow',()=>{try{if(sessionStorage.getItem('qr_resume_camera'))sessionStorage.removeItem('qr_resume_camera')}catch(_){}recoveryBurst()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recoveryBurst()});
})();
