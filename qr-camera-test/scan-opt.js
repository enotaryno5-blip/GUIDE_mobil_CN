(() => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  if (!isMobile) return;

  // Tăng nhịp gọi bộ quét; scanBusy trong trang chính vẫn chặn xử lý chồng nhau.
  try {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, delay, ...args) {
      if (typeof fn === 'function' && fn.name === 'scanFrame' && Number(delay) === 85) {
        return nativeSetInterval(fn, 50, ...args);
      }
      return nativeSetInterval(fn, delay, ...args);
    };
  } catch (_) {}

  // jsQR của trang chính vẫn nhận ảnh đã lấy từ canvas. Ta giảm mẫu trước khi giải mã
  // để ưu tiên tốc độ; định kỳ mới dùng ảnh gốc làm tầng dự phòng cho mã khó/nhỏ.
  let fastBuffer = null;
  let qrCallCount = 0;

  function downsampleRGBA(data, w, h, maxW = 900) {
    if (!data || !w || !h || w <= maxW) return null;
    const step = Math.max(2, Math.ceil(w / maxW));
    const nw = Math.max(1, Math.floor(w / step));
    const nh = Math.max(1, Math.floor(h / step));
    const need = nw * nh * 4;
    if (!fastBuffer || fastBuffer.length !== need) fastBuffer = new Uint8ClampedArray(need);

    let di = 0;
    for (let y = 0; y < nh; y++) {
      const sy = y * step;
      let si = (sy * w) * 4;
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
    if (typeof window.jsQR !== 'function' || window.jsQR.__fastCenterV14) return false;
    const native = window.jsQR;
    const wrapped = function(data, w, h, opts) {
      qrCallCount++;
      try {
        const fast = downsampleRGBA(data, w, h, 900);
        if (fast) {
          const fastOpts = Object.assign({}, opts || {}, { inversionAttempts: 'dontInvert' });
          const hit = native(fast.data, fast.w, fast.h, fastOpts);
          if (hit && hit.data) return hit;
          // 1/4 lượt dùng ảnh gốc để giữ độ nhạy với QR nhỏ, mờ, tương phản kém hoặc đảo màu.
          if (qrCallCount % 4 !== 0) return null;
        }
      } catch (_) {}
      return native(data, w, h, opts);
    };
    wrapped.__fastCenterV14 = true;
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

  // V13 thử đặt zoom quá sớm và đánh dấu track là đã xử lý ngay cả khi Safari từ chối.
  // V14 chỉ coi là xong khi giá trị thực tế đã lên gần 2x, và thử lại sau khi giao diện
  // zoom của trang chính đã được khởi tạo. Ưu tiên dispatch input vì đây chính là đường
  // điều khiển đã được người dùng xác nhận hoạt động khi kéo tay.
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
    if (attempts > 12) return false;

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

    await new Promise(r => setTimeout(r, usedUI ? 110 : 20));
    try { current = Number(track.getSettings?.().zoom); } catch (_) { current = NaN; }
    if (!Number.isFinite(current) || Math.abs(current - target) > 0.08) {
      await applyZoomDirect(track, target);
      await new Promise(r => setTimeout(r, 90));
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
    [80, 220, 450, 800, 1300, 2100, 3200].forEach(ms => {
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
      if (++n > 60) clearInterval(watch);
    }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatch, { once: true });
  else startWatch();
})();
