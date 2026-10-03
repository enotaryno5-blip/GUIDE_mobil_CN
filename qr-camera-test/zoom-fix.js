(() => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  if (!isMobile) return;

  function getTrack() {
    const v = document.getElementById('video');
    const s = v && v.srcObject;
    if (!s || !s.getVideoTracks) return null;
    return s.getVideoTracks().find(t => t.readyState === 'live') || s.getVideoTracks()[0] || null;
  }

  function getZoomElements() {
    return {
      wrap: document.getElementById('zoomWrap'),
      slider: document.getElementById('zoom'),
      value: document.getElementById('zoomValue')
    };
  }

  function readActualZoom() {
    const t = getTrack();
    try {
      const s = t && t.getSettings ? t.getSettings() : {};
      const z = Number(s.zoom);
      if (Number.isFinite(z)) return z;
    } catch (_) {}
    return NaN;
  }

  async function directZoom2(track) {
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ zoom: 2.0 }] });
      return true;
    } catch (_) {
      try {
        await track.applyConstraints({ zoom: 2.0 });
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function installButton() {
    if (document.getElementById('zoom2TrustedV18')) return true;
    const { wrap, slider } = getZoomElements();
    if (!wrap || !slider) return false;

    const btn = document.createElement('button');
    btn.id = 'zoom2TrustedV18';
    btn.type = 'button';
    btn.textContent = 'BẬT ZOOM 2×';
    btn.style.cssText = [
      'display:block',
      'width:100%',
      'margin-top:12px',
      'padding:14px 16px',
      'border:0',
      'border-radius:14px',
      'font:inherit',
      'font-weight:800',
      'font-size:16px',
      'background:#1677ff',
      'color:#fff',
      'min-height:50px',
      'position:relative',
      'z-index:9999'
    ].join(';');

    wrap.appendChild(btn);

    btn.addEventListener('click', async () => {
      const track = getTrack();
      if (!track) {
        btn.textContent = 'CAMERA CHƯA SẴN SÀNG';
        setTimeout(() => { btn.textContent = 'BẬT ZOOM 2×'; }, 900);
        return;
      }

      const { slider, value } = getZoomElements();
      btn.disabled = true;
      btn.textContent = 'ĐANG BẬT 2×…';

      // Đi đúng đường mà thao tác kéo tay đang dùng, ngay trong lần chạm thật của người dùng.
      if (slider) {
        let target = 2.0;
        const min = Number(slider.min), max = Number(slider.max);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          target = Math.max(min, Math.min(max, 2.0));
        }
        slider.value = String(target);
        if (value) value.textContent = target.toFixed(1) + '×';
        try { slider.dispatchEvent(new Event('input', { bubbles:true })); } catch (_) {}
        try { slider.dispatchEvent(new Event('change', { bubbles:true })); } catch (_) {}
      }

      await directZoom2(track);
      await new Promise(r => setTimeout(r, 220));

      const actual = readActualZoom();
      if (Number.isFinite(actual) && actual >= 1.85) {
        if (value) value.textContent = actual.toFixed(1) + '×';
        btn.textContent = '✓ ZOOM 2× ĐÃ BẬT';
        setTimeout(() => { btn.style.display = 'none'; }, 700);
      } else {
        // Nếu Safari không trả zoom thật qua getSettings, giữ nút hiện để người dùng biết
        // bản V18 đang chạy; thanh zoom phía trên sẽ cho thấy camera có đổi thực tế hay không.
        btn.textContent = 'THỬ LẠI ZOOM 2×';
        btn.disabled = false;
      }
    });

    // Chỉ ẩn khi Safari thật sự báo camera đã ở gần 2x. Nếu không báo được thì cứ hiện.
    const watch = setInterval(() => {
      if (!document.body.contains(btn)) { clearInterval(watch); return; }
      if (!getTrack()) { btn.style.display = 'block'; return; }
      const actual = readActualZoom();
      if (Number.isFinite(actual) && actual >= 1.85) btn.style.display = 'none';
      else btn.style.display = 'block';
    }, 800);

    return true;
  }

  function start() {
    if (installButton()) return;
    let n = 0;
    const timer = setInterval(() => {
      if (installButton() || ++n > 80) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
