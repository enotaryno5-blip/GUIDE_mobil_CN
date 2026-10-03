(() => {
  // Browsers can block fetch() from this HTTPS PWA to a plain-HTTP Receiver
  // on the LAN. A top-level navigation to the Receiver is allowed more widely.
  // Receiver GET /scan replies HTTP 204, so the scanner page normally stays in place.
  // Apply this bridge on iPhone AND desktop browsers so Surface can also scan
  // with its own camera and send to the local Receiver.
  if (!window.fetch) return;

  const nativeFetch = window.fetch.bind(window);

  function isPrivateIPv4(host) {
    const m = String(host || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = m.slice(1).map(Number);
    if (a.some(n => n < 0 || n > 255)) return false;
    return a[0] === 10 ||
      (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168) ||
      (a[0] === 169 && a[1] === 254);
  }

  function localURL(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const u = new URL(raw, location.href);
      if (u.protocol !== 'http:' || !isPrivateIPv4(u.hostname)) return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  async function bodyText(input, init) {
    try {
      if (init && typeof init.body === 'string') return init.body;
      if (input instanceof Request) return await input.clone().text();
    } catch (_) {}
    return '';
  }

  window.fetch = async function(input, init) {
    const u = localURL(input);
    if (!u) return nativeFetch(input, init);

    // The UI only needs /health to show the saved Receiver as ready. Browsers
    // may block the background fetch even though direct LAN navigation works,
    // so avoid a false red state here. Real /scan requests still go to Receiver.
    if (u.pathname === '/health') {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (u.pathname === '/scan') {
      const text = await bodyText(input, init);
      if (!text) return Promise.reject(new TypeError('Missing scan text'));

      // Reuse token from the saved pairing URL. The Receiver supports
      // GET /scan?token=...&text=... and responds 204 No Content.
      u.searchParams.set('text', text);
      u.searchParams.set('enter', '1');
      u.searchParams.set('source', 'web');

      // Schedule navigation after current UI updates. Receiver v1.3 detects
      // same-PC requests and briefly focuses the last Word/Excel window, types
      // the scan, then restores the browser so continuous scanning can continue.
      setTimeout(() => {
        try { window.location.assign(u.toString()); }
        catch (_) { window.location.href = u.toString(); }
      }, 0);

      return new Response(null, { status: 204 });
    }

    return nativeFetch(input, init);
  };
})();
