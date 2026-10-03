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

  // Bridge được nạp trong HEAD trước script chính. Khi ghép nối lần đầu,
  // lưu Receiver ngay để trang quét có IP/cổng/token từ lần mở đầu tiên.
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

  // iPhone 13 trong thực tế đang chạy iOS 26.x: camera web 4K làm jsQR phải xử lý
  // khung hình quá lớn và bắt mã chậm hơn nhiều so với bộ quét QR native của Shortcuts.
  // Với iOS <= 26, hạ luồng camera web về 1080p: vẫn đủ chi tiết cho QR/CCCD nhưng
  // giảm đáng kể lượng pixel phải đọc. iOS 27+ giữ nguyên để không làm thay đổi
  // hành vi đang chạy tốt trên iPhone 16/17 của người dùng.
  function getIOSMajor(){
    const ua=navigator.userAgent||'';
    const m=ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS)\s*(\d+)[._]/i);
    return m?Number(m[1]):0;
  }
  const IOS_MAJOR=getIOSMajor();
  const IOS_OLD=IOS_MAJOR>0&&IOS_MAJOR<=26;

  function installIOSCameraOptimizer(){
    if(!IOS_OLD||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return;
    const md=navigator.mediaDevices;
    if(md.__qrIOSOptimized)return;
    const nativeGUM=md.getUserMedia.bind(md);
    const wrapped=function(constraints){
      try{
        if(!constraints||!constraints.video||constraints.video===true)return nativeGUM(constraints);
        const c=Object.assign({},constraints);
        const v=Object.assign({},constraints.video);
        v.width={ideal:1920,max:1920};
        v.height={ideal:1080,max:1080};
        v.frameRate={ideal:30,max:30};
        if(!v.deviceId)v.facingMode={ideal:'environment'};
        c.video=v;
        return nativeGUM(c).catch(()=>nativeGUM(constraints));
      }catch(_){return nativeGUM(constraints)}
    };
    try{md.getUserMedia=wrapped}catch(_){
      try{Object.defineProperty(md,'getUserMedia',{value:wrapped,configurable:true})}catch(__){}
    }
    try{md.__qrIOSOptimized=true}catch(_){}
  }
  installIOSCameraOptimizer();

  if(!window.fetch)return;
  const nativeFetch=window.fetch.bind(window);

  function localURL(input){
    try{const raw=input instanceof Request?input.url:String(input);const u=new URL(raw,location.href);if(u.protocol!=='http:'||!isPrivateIPv4(u.hostname))return null;return u}catch(_){return null}
  }
  async function bodyText(input,init){
    try{if(init&&typeof init.body==='string')return init.body;if(input instanceof Request)return await input.clone().text()}catch(_){}return'';
  }
  function getVideo(){return document.getElementById('video')}
  function getTrack(){
    const v=getVideo(),s=v&&v.srcObject;
    if(!s||!s.getVideoTracks)return null;
    return s.getVideoTracks().find(t=>t.readyState==='live')||s.getVideoTracks()[0]||null;
  }
  function cameraLooksLive(){return !!getTrack()}
  function setStatus(text){const b=document.getElementById('badge');if(b)b.textContent=text}

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

  function addControlStyles(){
    if(document.getElementById('qr-camera-control-style'))return;
    const s=document.createElement('style');
    s.id='qr-camera-control-style';
    s.textContent=`
      #zoom{height:38px;min-height:38px;touch-action:none;cursor:pointer}
      #zoom::-webkit-slider-thumb{width:30px;height:30px}
      .qrZoomBtn{min-width:54px;padding:11px 10px;font-size:22px;line-height:1}
      .qrCameraTools{grid-template-columns:1fr 1fr 1fr!important}
      .qrCameraTools button{min-height:50px;padding:12px 7px;font-size:14px}
      #focusAssist{background:#253047}
    `;
    document.head.appendChild(s);
  }

  function enhanceZoom(){
    const zoom=document.getElementById('zoom');
    if(!zoom||zoom.dataset.enhanced==='1')return;
    zoom.dataset.enhanced='1';
    const row=zoom.closest('.zoomrow');
    if(!row)return;

    const minus=document.createElement('button');
    minus.type='button';minus.className='secondary qrZoomBtn';minus.textContent='−';
    const plus=document.createElement('button');
    plus.type='button';plus.className='secondary qrZoomBtn';plus.textContent='+';
    row.insertBefore(minus,zoom);row.insertBefore(plus,zoom.nextSibling);

    function n(v,f){const x=Number(v);return Number.isFinite(x)?x:f}
    function change(dir){
      const min=n(zoom.min,1),max=n(zoom.max,1),step=Math.max(n(zoom.step,.1),.1);
      const cur=n(zoom.value,min);
      const next=Math.max(min,Math.min(max,Math.round((cur+dir*step)*100)/100));
      zoom.value=String(next);
      zoom.dispatchEvent(new Event('input',{bubbles:true}));
    }
    minus.addEventListener('click',()=>change(-1));
    plus.addEventListener('click',()=>change(1));
  }

  async function focusNow(btn){
    const track=getTrack();
    if(!track){setStatus('Chưa mở camera');return}
    const caps=track.getCapabilities?track.getCapabilities():{};
    const modes=Array.isArray(caps.focusMode)?caps.focusMode:[];
    const old=btn.textContent;btn.disabled=true;btn.textContent='ĐANG NÉT…';
    let ok=false;
    try{
      if(modes.includes('single-shot')){
        await track.applyConstraints({advanced:[{focusMode:'single-shot'}]});
        ok=true;
        await new Promise(r=>setTimeout(r,180));
      }
      if(modes.includes('continuous')){
        await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
        ok=true;
      }
      if(!ok&&modes.length){
        await track.applyConstraints({advanced:[{focusMode:modes[0]}]});
        ok=true;
      }
    }catch(_){}
    btn.disabled=false;btn.textContent=old;
    setStatus(ok?'Đã lấy nét · đang tự quét QR':'Camera đang tự lấy nét');
  }

  async function toggleTorch(btn,e){
    if(e){e.preventDefault();e.stopImmediatePropagation()}
    const track=getTrack();
    if(!track){setStatus('Chưa mở camera');return}
    const caps=track.getCapabilities?track.getCapabilities():{};
    if(!caps.torch){btn.disabled=true;btn.textContent='ĐÈN: KHÔNG HỖ TRỢ';setStatus('Camera/trình duyệt này không cho điều khiển đèn');return}
    const cur=btn.dataset.torchOn==='1';
    const next=!cur;
    btn.disabled=true;
    try{
      await track.applyConstraints({advanced:[{torch:next}]});
      btn.dataset.torchOn=next?'1':'0';
      btn.textContent=next?'ĐÈN: BẬT':'ĐÈN: TẮT';
      setStatus(next?'Đã bật đèn':'Đã tắt đèn');
    }catch(_){
      btn.textContent='ĐÈN: LỖI';
      setStatus('Không điều khiển được đèn trên camera này');
    }finally{setTimeout(()=>{if(track.readyState==='live')btn.disabled=false},120)}
  }

  function enhanceCameraTools(){
    const torch=document.getElementById('torch');
    const clear=document.getElementById('clear');
    if(!torch||!clear)return;
    const row=torch.parentElement;
    if(row)row.classList.add('qrCameraTools');

    if(torch.dataset.enhanced!=='1'){
      torch.dataset.enhanced='1';
      torch.addEventListener('click',e=>toggleTorch(torch,e),true);
    }

    if(!document.getElementById('focusAssist')){
      const focus=document.createElement('button');
      focus.id='focusAssist';focus.type='button';focus.className='secondary';focus.textContent='LẤY NÉT';
      focus.addEventListener('click',()=>focusNow(focus));
      row.insertBefore(focus,clear);
    }
  }

  let rearTried=false;
  function preferRearCameraOnWindows(){
    if(rearTried||!/Windows/i.test(navigator.userAgent))return;
    const sel=document.getElementById('cameraSelect');
    if(!sel||sel.options.length<2)return;
    const opts=[...sel.options];
    const rear=opts.find(o=>/(rear|back|environment|world|camera sau|phía sau|phia sau)/i.test(o.textContent||''));
    if(!rear)return;
    rearTried=true;
    if(sel.value!==rear.value){
      sel.value=rear.value;
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      setStatus('Đang chuyển sang camera phía sau…');
    }
  }

  // Trên iOS 26.x, nếu Safari vô tình chọn Ultra Wide/Tele thì đổi sang camera sau
  // chính. Chỉ đổi khi nhãn hiện tại rõ ràng là ống kính phụ để không làm xáo trộn
  // iPhone 16/17 đang hoạt động tốt.
  let iosRearTried=false;
  function preferMainRearCameraOnOlderIOS(){
    if(iosRearTried||!IOS_OLD)return;
    const sel=document.getElementById('cameraSelect');
    if(!sel||sel.options.length<2||sel.selectedIndex<0)return;
    const cur=sel.options[sel.selectedIndex];
    const curLabel=String(cur.textContent||'');
    if(!/(ultra\s*wide|telephoto|tele\b|front|camera trước|phía trước|phia truoc)/i.test(curLabel))return;
    const opts=[...sel.options];
    const rear=opts.find(o=>{
      const s=String(o.textContent||'');
      return /(rear|back|environment|world|camera sau|phía sau|phia sau)/i.test(s)&&
             !/(ultra\s*wide|telephoto|tele\b|front|camera trước|phía trước|phia truoc)/i.test(s);
    });
    if(!rear)return;
    iosRearTried=true;
    if(sel.value!==rear.value){
      sel.value=rear.value;
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      setStatus('Đang tối ưu camera sau để bắt QR nhanh hơn…');
    }
  }

  function initUI(){
    addControlStyles();
    enhanceZoom();
    enhanceCameraTools();
    const saved=localStorage.getItem(KEY)||'';
    const connect=document.getElementById('connect');
    if(saved&&connect)connect.textContent='ĐỔI WINDOWS';
    if(saved)recoveryBurst();
    setTimeout(preferRearCameraOnWindows,900);
    setTimeout(preferRearCameraOnWindows,1700);
    setTimeout(preferMainRearCameraOnOlderIOS,900);
    setTimeout(preferMainRearCameraOnOlderIOS,1800);
    setTimeout(preferMainRearCameraOnOlderIOS,3000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initUI,{once:true});else initUI();
  window.addEventListener('pageshow',()=>{try{if(sessionStorage.getItem('qr_resume_camera'))sessionStorage.removeItem('qr_resume_camera')}catch(_){}recoveryBurst();setTimeout(preferRearCameraOnWindows,700);setTimeout(preferMainRearCameraOnOlderIOS,1000)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recoveryBurst()});
})();
