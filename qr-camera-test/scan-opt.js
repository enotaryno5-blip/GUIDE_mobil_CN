(() => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  if (!isMobile) return;

  // V17: vẫn yêu cầu 2x ngay khi mở camera.
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia && !md.__qrAcquireZoomV17) {
      const nativeGUM = md.getUserMedia.bind(md);
      const wrappedGUM = async function(constraints) {
        let tuned = constraints;
        try {
          if (constraints && constraints.video && constraints.video !== true) {
            const c = Object.assign({}, constraints);
            const v = Object.assign({}, constraints.video);
            const adv = Array.isArray(v.advanced) ? v.advanced.slice() : [];
            adv.unshift({ zoom: 2.0 });
            v.advanced = adv;
            v.zoom = { ideal: 2.0 };
            c.video = v;
            tuned = c;
          }
        } catch (_) {}
        try { return await nativeGUM(tuned); }
        catch (_) { return nativeGUM(constraints); }
      };
      try { md.getUserMedia = wrappedGUM; }
      catch (_) {
        try { Object.defineProperty(md, 'getUserMedia', { value: wrappedGUM, configurable: true }); } catch (__) {}
      }
      try { md.__qrAcquireZoomV17 = true; } catch (_) {}
    }
  } catch (_) {}

  // Tăng nhịp gọi scanFrame; scanBusy của trang chính vẫn chặn xử lý chồng nhau.
  try {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, delay, ...args) {
      if (typeof fn === 'function' && fn.name === 'scanFrame' && Number(delay) === 85) {
        return nativeSetInterval(fn, 48, ...args);
      }
      return nativeSetInterval(fn, delay, ...args);
    };
  } catch (_) {}

  // Quét nhanh vùng giữa trước; định kỳ mới quét ảnh gốc để giữ độ nhạy với mã khó.
  let fastBuffer = null;
  let qrCallCount = 0;

  function centerSampleRGBA(data, w, h, ratioX = 0.72, ratioY = 0.70, maxW = 920) {
    if (!data || !w || !h) return null;
    const cw = Math.max(1, Math.floor(w * ratioX));
    const ch = Math.max(1, Math.floor(h * ratioY));
    const ox = Math.max(0, Math.floor((w - cw) / 2));
    const oy = Math.max(0, Math.floor((h - ch) / 2));
    const step = Math.max(1, Math.ceil(cw / maxW));
    const nw = Math.max(1, Math.floor(cw / step));
    const nh = Math.max(1, Math.floor(ch / step));
    const need = nw * nh * 4;
    if (!fastBuffer || fastBuffer.length !== need) fastBuffer = new Uint8ClampedArray(need);

    let di = 0;
    for (let y = 0; y < nh; y++) {
      const sy = oy + y * step;
      let si = (sy * w + ox) * 4;
      for (let x = 0; x < nw; x++) {
        fastBuffer[di++] = data[si];
        fastBuffer[di++] = data[si + 1];
        fastBuffer[di++] = data[si + 2];
        fastBuffer[di++] = data[si + 3];
        si += step * 4;
      }
    }
    return { data: fastBuffer, w: nw, h: nh };
  }

  function installFastJsQR() {
    if (typeof window.jsQR !== 'function' || window.jsQR.__fastCenterV17) return false;
    const native = window.jsQR;
    const wrapped = function(data, w, h, opts) {
      qrCallCount++;
      try {
        const fast = centerSampleRGBA(data, w, h, 0.72, 0.70, 920);
        if (fast) {
          const fastOpts = Object.assign({}, opts || {}, { inversionAttempts: 'dontInvert' });
          const hit = native(fast.data, fast.w, fast.h, fastOpts);
          if (hit && hit.data) return hit;
          if (qrCallCount % 3 !== 0) return null;
        }
      } catch (_) {}
      return native(data, w, h, opts);
    };
    wrapped.__fastCenterV17 = true;
    window.jsQR = wrapped;
    return true;
  }

  const jsTimer = setInterval(() => {
    if (installFastJsQR()) clearInterval(jsTimer);
  }, 35);

  function getLiveTrack() {
    const video = document.getElementById('video');
    const stream = video && video.srcObject;
    if (!stream || !stream.getVideoTracks) return null;
    return stream.getVideoTracks().find(t => t.readyState === 'live') || stream.getVideoTracks()[0] || null;
  }

  function setBadge(text) {
    const b = document.getElementById('badge');
    if (b) b.textContent = text;
  }

  async function applyZoomDirect(track, target) {
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      return true;
    } catch (_) {
      try {
        await track.applyConstraints({ zoom: target });
        return true;
      } catch (_) { return false; }
    }
  }

  function uiZoomTarget() {
    const z = document.getElementById('zoom');
    if (!z) return 2.0;
    const min = Number(z.min), max = Number(z.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return Math.max(min, Math.min(max, 2.0));
    }
    return 2.0;
  }

  function currentZoomApprox() {
    const track = getLiveTrack();
    try {
      const s = track && track.getSettings ? track.getSettings() : {};
      const n = Number(s.zoom);
      if (Number.isFinite(n)) return n;
    } catch (_) {}
    const z = document.getElementById('zoom');
    const n = Number(z && z.value);
    return Number.isFinite(n) ? n : NaN;
  }

  async function forceZoom2() {
    const track = getLiveTrack();
    if (!track) return false;
    const target = uiZoomTarget();
    const now = currentZoomApprox();
    if (Number.isFinite(now) && Math.abs(now - target) <= 0.12) return true;

    const z = document.getElementById('zoom');
    const zv = document.getElementById('zoomValue');
    if (z) {
      z.value = String(target);
      if (zv) zv.textContent = target.toFixed(1) + '×';
      try { z.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
    await applyZoomDirect(track, target);
    return false;
  }

  // V17: nút fallback KHÔNG còn phụ thuộc getCapabilities().zoom và KHÔNG đặt trong zoomWrap.
  // Vì iPhone 13 có thể cho kéo zoom bằng tay nhưng báo capability không đầy đủ cho script.
  function installTrustedZoomFallback() {
    if (document.getElementById('zoom2Fallback')) return;
    const controls = document.querySelector('.controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.id = 'zoom2Fallback';
    btn.type = 'button';
    btn.className = 'secondary';
    btn.textContent = 'BẬT ZOOM 2×';
    btn.style.width = '100%';
    btn.style.display = 'none';

    const zoomWrap = document.getElementById('zoomWrap');
    if (zoomWrap && zoomWrap.parentNode === controls) controls.insertBefore(btn, zoomWrap.nextSibling);
    else controls.appendChild(btn);

    function refresh() {
      if (!getLiveTrack()) { btn.style.display = 'none'; return; }
      const now = currentZoomApprox();
      btn.style.display = Number.isFinite(now) && now >= 1.85 ? 'none' : 'block';
    }

    btn.addEventListener('click', async () => {
      const track = getLiveTrack();
      if (!track) return;
      const target = uiZoomTarget();
      const z = document.getElementById('zoom');
      const zv = document.getElementById('zoomValue');

      btn.disabled = true;
      btn.textContent = 'ĐANG BẬT 2×…';

      // Thực hiện ngay trong thao tác chạm thật của người dùng.
      if (z) {
        z.value = String(target);
        if (zv) zv.textContent = target.toFixed(1) + '×';
        try { z.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      }
      await applyZoomDirect(track, target);
      await new Promise(r => setTimeout(r, 180));

      const now = currentZoomApprox();
      const ok = Number.isFinite(now) && now >= 1.85;
      if (ok) {
        btn.style.display = 'none';
        setBadge('Zoom 2.0× · đang tự quét QR');
      } else {
        btn.style.display = 'block';
        btn.textContent = 'THỬ LẠI ZOOM 2×';
        setBadge('Safari chưa đổi zoom · kéo thanh zoom nếu cần');
      }
      btn.disabled = false;
    });

    [700, 1200, 2000, 3500].forEach(ms => setTimeout(refresh, ms));
    setInterval(refresh, 1200);
  }

  async function keepContinuousFocus() {
    const track = getLiveTrack();
    if (!track) return;
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch (_) {}
  }

  function scheduleTune() {
    [60, 180, 360, 700, 1200, 2000, 3200].forEach(ms => {
      setTimeout(() => { forceZoom2(); keepContinuousFocus(); }, ms);
    });
    [100, 400, 900].forEach(ms => setTimeout(installTrustedZoomFallback, ms));
  }

  function startWatch() {
    const video = document.getElementById('video');
    if (video) {
      video.addEventListener('loadedmetadata', scheduleTune);
      video.addEventListener('playing', scheduleTune);
    }
    const select = document.getElementById('cameraSelect');
    if (select) select.addEventListener('change', () => setTimeout(scheduleTune, 120));

    installTrustedZoomFallback();
    scheduleTune();
    let n = 0;
    const watch = setInterval(() => {
      forceZoom2();
      installTrustedZoomFallback();
      if (++n > 60) clearInterval(watch);
    }, 350);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatch, { once: true });
  else startWatch();
})();
