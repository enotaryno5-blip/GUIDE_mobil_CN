(() => {
  const TARGET_ZOOM = 2.0;
  const DIGITAL_CROP = 0.50;

  // V20: mặc định hiệu dụng 2.0x trên mọi thiết bị, không phụ thuộc User-Agent.
  // Ưu tiên zoom thật của camera; nếu trình duyệt không nhận thì dùng zoom số 2x
  // cho cả phần nhìn và bộ giải mã.
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia && !md.__qrAcquireZoomV20) {
      const nativeGUM = md.getUserMedia.bind(md);
      const wrappedGUM = async function(constraints) {
        let tuned = constraints;
        try {
          if (constraints && constraints.video && constraints.video !== true) {
            const c = Object.assign({}, constraints);
            const v = Object.assign({}, constraints.video);

            // Giữ luồng vừa đủ chi tiết để QR rõ nhưng không làm jsQR xử lý 4K không cần thiết.
            v.width = { ideal: 1920, max: 1920 };
            v.height = { ideal: 1080, max: 1080 };
            v.frameRate = { ideal: 30, max: 30 };

            const adv = Array.isArray(v.advanced) ? v.advanced.slice() : [];
            adv.unshift({ zoom: TARGET_ZOOM });
            v.advanced = adv;
            v.zoom = { ideal: TARGET_ZOOM };
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
      try { md.__qrAcquireZoomV20 = true; } catch (_) {}
    }
  } catch (_) {}

  // Tăng nhịp gọi scanFrame; scanBusy của trang chính vẫn ngăn xử lý chồng nhau.
  try {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, delay, ...args) {
      if (typeof fn === 'function' && fn.name === 'scanFrame' && Number(delay) === 85) {
        return nativeSetInterval(fn, 45, ...args);
      }
      return nativeSetInterval(fn, delay, ...args);
    };
  } catch (_) {}

  function getVideo() {
    return document.getElementById('video');
  }

  function getLiveTrack() {
    const video = getVideo();
    const stream = video && video.srcObject;
    if (!stream || !stream.getVideoTracks) return null;
    return stream.getVideoTracks().find(t => t.readyState === 'live') || stream.getVideoTracks()[0] || null;
  }

  function readHardwareZoom() {
    const track = getLiveTrack();
    try {
      const s = track && track.getSettings ? track.getSettings() : {};
      const n = Number(s.zoom);
      return Number.isFinite(n) ? n : NaN;
    } catch (_) { return NaN; }
  }

  function hardwareAt2x() {
    const z = readHardwareZoom();
    return Number.isFinite(z) && z >= 1.85;
  }

  function digitalZoomActive() {
    return !hardwareAt2x();
  }

  async function applyHardwareZoom2() {
    const track = getLiveTrack();
    if (!track || hardwareAt2x()) return hardwareAt2x();
    try {
      await track.applyConstraints({ advanced: [{ zoom: TARGET_ZOOM }] });
    } catch (_) {
      try { await track.applyConstraints({ zoom: TARGET_ZOOM }); } catch (__) {}
    }
    return hardwareAt2x();
  }

  function removeOldZoomButtons() {
    ['zoom2Fallback','zoom2TrustedV18'].forEach(id => {
      try { document.getElementById(id)?.remove(); } catch (_) {}
    });
  }

  function applyEffectiveZoomUI() {
    removeOldZoomButtons();
    const video = getVideo();
    const wrap = document.getElementById('zoomWrap');
    const slider = document.getElementById('zoom');
    const value = document.getElementById('zoomValue');
    const digital = digitalZoomActive();

    // Nếu camera không chịu zoom thật, phóng vùng giữa 2x ngay trên preview.
    if (video) {
      video.style.transformOrigin = '50% 50%';
      video.style.transform = digital ? 'scale(2)' : 'scale(1)';
      video.style.willChange = 'transform';
    }

    // Luôn hiển thị mức zoom hiệu dụng 2.0x, kể cả khi phần cứng vẫn báo 1.0x.
    if (wrap) wrap.style.display = 'block';
    if (value) value.textContent = '2.0×';

    if (slider) {
      if (digital) {
        slider.min = '1';
        slider.max = '2';
        slider.step = '0.1';
        slider.value = '2';
        slider.disabled = true;
      } else {
        slider.disabled = false;
        try {
          const track = getLiveTrack();
          const caps = track && track.getCapabilities ? track.getCapabilities() : {};
          if (caps.zoom) {
            if (Number.isFinite(caps.zoom.min)) slider.min = String(caps.zoom.min);
            if (Number.isFinite(caps.zoom.max)) slider.max = String(caps.zoom.max);
            if (Number.isFinite(caps.zoom.step) && caps.zoom.step > 0) slider.step = String(caps.zoom.step);
          }
          slider.value = String(Math.max(Number(slider.min) || 1, Math.min(Number(slider.max) || TARGET_ZOOM, TARGET_ZOOM)));
        } catch (_) {}
      }
    }
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

  // Bộ giải mã dùng đúng vùng giữa tương đương zoom số 2x; định kỳ vẫn quét rộng để tránh bỏ mã lệch tâm.
  let fastBuffer = null;
  let qrCallCount = 0;

  function centerSampleRGBA(data, w, h, ratioX, ratioY, maxW) {
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
    if (typeof window.jsQR !== 'function' || window.jsQR.__effectiveZoomV20) return false;
    const native = window.jsQR;

    const wrapped = function(data, w, h, opts) {
      qrCallCount++;
      const digital = digitalZoomActive();
      const rx = digital ? DIGITAL_CROP : 0.72;
      const ry = digital ? DIGITAL_CROP : 0.70;
      const maxW = digital ? 900 : 920;

      try {
        const fast = centerSampleRGBA(data, w, h, rx, ry, maxW);
        if (fast) {
          const fastOpts = Object.assign({}, opts || {}, { inversionAttempts: 'dontInvert' });
          const hit = native(fast.data, fast.w, fast.h, fastOpts);
          if (hit && hit.data) return hit;

          const fallbackEvery = digital ? 4 : 3;
          if (qrCallCount % fallbackEvery !== 0) return null;
        }
      } catch (_) {}

      return native(data, w, h, opts);
    };

    wrapped.__effectiveZoomV20 = true;
    window.jsQR = wrapped;
    return true;
  }

  const jsTimer = setInterval(() => {
    if (installFastJsQR()) clearInterval(jsTimer);
  }, 35);

  function scheduleTune() {
    [60, 180, 360, 700, 1200, 2000, 3200].forEach(ms => {
      setTimeout(async () => {
        await applyHardwareZoom2();
        applyEffectiveZoomUI();
        keepContinuousFocus();
      }, ms);
    });
  }

  function startWatch() {
    removeOldZoomButtons();
    applyEffectiveZoomUI();

    const video = getVideo();
    if (video) {
      video.addEventListener('loadedmetadata', scheduleTune);
      video.addEventListener('playing', scheduleTune);
    }

    const select = document.getElementById('cameraSelect');
    if (select) select.addEventListener('change', () => setTimeout(scheduleTune, 120));

    scheduleTune();

    let n = 0;
    const watch = setInterval(async () => {
      removeOldZoomButtons();
      await applyHardwareZoom2();
      applyEffectiveZoomUI();
      if (++n > 80) clearInterval(watch);
    }, 350);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatch, { once: true });
  else startWatch();
})();
