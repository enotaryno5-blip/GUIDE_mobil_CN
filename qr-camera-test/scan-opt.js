(() => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  if (!isMobile) return;

  // V15: yêu cầu zoom ngay trong lúc xin camera. Một số iPhone (đặc biệt iPhone 13)
  // cho kéo zoom bằng tay nhưng từ chối applyConstraints nếu gọi muộn sau khi stream đã chạy.
  // Đặt zoom như "ideal" ở chính getUserMedia giúp WebKit có cơ hội mở track ở gần 2x ngay từ đầu.
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia && !md.__qrAcquireZoomV15) {
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
        try {
          return await nativeGUM(tuned);
        } catch (_) {
          return nativeGUM(constraints);
        }
      };
      try { md.getUserMedia = wrappedGUM; }
      catch (_) {
        try { Object.defineProperty(md, 'getUserMedia', { value: wrappedGUM, configurable: true }); } catch (__) {}
      }
      try { md.__qrAcquireZoomV15 = true; } catch (_) {}
    }
  } catch (_) {}

  // Tăng nhịp gọi bộ quét; scanBusy trong trang chính vẫn chặn xử lý chồng nhau.
  try {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, delay, ...args) {
      if (typeof fn === 'function' && fn.name === 'scanFrame' && Number(delay) === 85) {
        return nativeSetInterval(fn, 48, ...args);
      }
      return nativeSetInterval(fn, delay, ...args);
    };
  } catch (_) {}

  // Tầng nhanh: chỉ giải mã phần giữa ảnh trước. Đây là "zoom số cho bộ giải mã",
  // nên ngay cả khi iPhone 13 không chịu tự đổi zoom quang học thì QR ở giữa khung
  // vẫn được xử lý trên vùng nhỏ hơn, ít nền thừa hơn và nhanh hơn.
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
    if (typeof window.jsQR !== 'function' || window.jsQR.__fastCenterV15) return false;
    const native = window.jsQR;
    const wrapped = function(data, w, h, opts) {
      qrCallCount++;
      try {
        const fast = centerSampleRGBA(data, w, h, 0.72, 0.70, 920);
        if (fast) {
          const fastOpts = Object.assign({}, opts || {}, { inversionAttempts: 'dontInvert' });
          const hit = native(fast.data, fast.w, fast.h, fastOpts);
          if (hit && hit.data) return hit;
          // 1/3 lượt dùng toàn ảnh gốc để vẫn bắt QR lệch khung, rất nhỏ, mờ hoặc đảo màu.
          if (qrCallCount % 3 !== 0) return null;
        }
      } catch (_) {}
      return native(data, w, h, opts);
    };
    wrapped.__fastCenterV15 = true;
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
    return stream.getVideoTracks().find(t => t.readyState === 'live') || null;
  }

  async function applyZoomDirect(track, target) {
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

  // Sau khi stream đã mở vẫn thử lại theo đúng đường điều khiển của thanh zoom.
  // Không đánh dấu hoàn tất cho tới khi getSettings báo giá trị thực tế gần 2x.
  const zoomAttempts = new WeakMap();

  async function forceZoom2() {
    const track = getLiveTrack();
    if (!track) return false;

    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (_) {}
    if (!caps.zoom || !Number.isFinite(caps.zoom.min) || !Number.isFinite(caps.zoom.max) || caps.zoom.max <= caps.zoom.min) return false;

    const target = Math.max(caps.zoom.min, Math.min(caps.zoom.max, 2.0));
    let current = NaN;
    try { current = Number(track.getSettings?.().zoom); } catch (_) {}
    if (Number.isFinite(current) && Math.abs(current - target) <= 0.08) {
      const z = document.getElementById('zoom');
      const zv = document.getElementById('zoomValue');
      if (z) z.value = String(current);
      if (zv) zv.textContent = current.toFixed(1) + '×';
      return true;
    }

    const attempts = (zoomAttempts.get(track) || 0) + 1;
    zoomAttempts.set(track, attempts);
    if (attempts > 24) return false;

    const z = document.getElementById('zoom');
    const zv = document.getElementById('zoomValue');
    let usedUI = false;
    if (z) {
      const zmin = Number(z.min), zmax = Number(z.max);
      if (Number.isFinite(zmin) && Number.isFinite(zmax) && zmax > zmin) {
        const uiTarget = Math.max(zmin, Math.min(zmax, target));
        z.value = String(uiTarget);
        if (zv) zv.textContent = uiTarget.toFixed(1) + '×';
        try { z.dispatchEvent(new Event('input', { bubbles: true })); usedUI = true; } catch (_) {}
      }
    }

    await new Promise(r => setTimeout(r, usedUI ? 130 : 30));
    try { current = Number(track.getSettings?.().zoom); } catch (_) { current = NaN; }
    if (!Number.isFinite(current) || Math.abs(current - target) > 0.08) {
      await applyZoomDirect(track, target);
      await new Promise(r => setTimeout(r, 110));
      try { current = Number(track.getSettings?.().zoom); } catch (_) { current = NaN; }
    }

    if (Number.isFinite(current)) {
      if (z) z.value = String(current);
      if (zv) zv.textContent = current.toFixed(1) + '×';
    }
    return Number.isFinite(current) && Math.abs(current - target) <= 0.12;
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
    [60, 160, 320, 600, 1000, 1600, 2400, 3500, 5000].forEach(ms => {
      setTimeout(() => { forceZoom2(); keepContinuousFocus(); }, ms);
    });
  }

  function startWatch() {
    const video = document.getElementById('video');
    if (video) {
      video.addEventListener('loadedmetadata', scheduleTune);
      video.addEventListener('playing', scheduleTune);
    }

    const select = document.getElementById('cameraSelect');
    if (select) select.addEventListener('change', () => setTimeout(scheduleTune, 120));

    scheduleTune();
    let n = 0;
    const watch = setInterval(() => {
      forceZoom2();
      if (++n > 80) clearInterval(watch);
    }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatch, { once: true });
  else startWatch();
})();
