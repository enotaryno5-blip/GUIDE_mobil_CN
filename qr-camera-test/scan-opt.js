(() => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  if (!isMobile) return;

  // Tăng nhịp gọi bộ quét; scanBusy trong trang chính vẫn chặn xử lý chồng nhau.
  try {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, delay, ...args) {
      if (typeof fn === 'function' && fn.name === 'scanFrame' && Number(delay) === 85) {
        return nativeSetInterval(fn, 55, ...args);
      }
      return nativeSetInterval(fn, delay, ...args);
    };
  } catch (_) {}

  // Giải mã nhanh trước trên ảnh giảm mẫu. Định kỳ mới dùng ảnh gốc làm tầng dự phòng.
  // Mục tiêu: QR ở giữa khung được nhận nhanh hơn, còn QR nhỏ/khó vẫn có lượt quét đầy đủ.
  let fastBuffer = null;
  let fastW = 0, fastH = 0;
  let qrCallCount = 0;

  function downsampleRGBA(data, w, h, maxW = 1050) {
    if (!data || !w || !h || w <= maxW) return null;
    const step = Math.max(2, Math.ceil(w / maxW));
    const nw = Math.max(1, Math.floor(w / step));
    const nh = Math.max(1, Math.floor(h / step));
    const need = nw * nh * 4;
    if (!fastBuffer || fastBuffer.length !== need) fastBuffer = new Uint8ClampedArray(need);
    fastW = nw; fastH = nh;

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
    return { data: fastBuffer, w: fastW, h: fastH };
  }

  function installFastJsQR() {
    if (typeof window.jsQR !== 'function' || window.jsQR.__fastCenterV13) return false;
    const native = window.jsQR;
    const wrapped = function(data, w, h, opts) {
      qrCallCount++;
      try {
        const fast = downsampleRGBA(data, w, h, 1050);
        if (fast) {
          const fastOpts = Object.assign({}, opts || {}, { inversionAttempts: 'dontInvert' });
          const hit = native(fast.data, fast.w, fast.h, fastOpts);
          if (hit && hit.data) return hit;
          // Khoảng 1/5 lượt quét dùng ảnh gốc để bắt mã nhỏ, mờ hoặc đảo màu.
          if (qrCallCount % 5 !== 0) return null;
        }
      } catch (_) {}
      return native(data, w, h, opts);
    };
    wrapped.__fastCenterV13 = true;
    window.jsQR = wrapped;
    return true;
  }

  const jsTimer = setInterval(() => {
    if (installFastJsQR()) clearInterval(jsTimer);
  }, 40);

  // Mặc định zoom xấp xỉ 2.0x khi camera cho phép. Người dùng vẫn có thể kéo lại sau đó.
  const tunedTracks = new WeakSet();

  async function tuneTrack(track) {
    if (!track || track.readyState !== 'live' || tunedTracks.has(track)) return;
    tunedTracks.add(track);
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const adv = [];

      if (caps.zoom && Number.isFinite(caps.zoom.min) && Number.isFinite(caps.zoom.max)) {
        const target = Math.max(caps.zoom.min, Math.min(caps.zoom.max, 2.0));
        if (caps.zoom.max > caps.zoom.min && Math.abs((track.getSettings?.().zoom || caps.zoom.min) - target) > 0.05) {
          adv.push({ zoom: target });
        }
      }

      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        adv.push({ focusMode: 'continuous' });
      }

      for (const c of adv) {
        try { await track.applyConstraints({ advanced: [c] }); } catch (_) {}
      }

      const s = track.getSettings ? track.getSettings() : {};
      if (Number.isFinite(s.zoom)) {
        const z = document.getElementById('zoom');
        const zv = document.getElementById('zoomValue');
        if (z) z.value = String(s.zoom);
        if (zv) zv.textContent = Number(s.zoom).toFixed(1) + '×';
      }
    } catch (_) {}
  }

  function inspectVideo() {
    const video = document.getElementById('video');
    const stream = video && video.srcObject;
    if (!stream || !stream.getVideoTracks) return;
    const track = stream.getVideoTracks().find(t => t.readyState === 'live');
    if (track) tuneTrack(track);
  }

  function startWatch() {
    inspectVideo();
    const video = document.getElementById('video');
    if (video) {
      video.addEventListener('loadedmetadata', () => setTimeout(inspectVideo, 80));
      video.addEventListener('playing', () => setTimeout(inspectVideo, 120));
    }
    let n = 0;
    const watch = setInterval(() => {
      inspectVideo();
      if (++n > 80) clearInterval(watch);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatch, { once: true });
  else startWatch();
})();
