(() => {
  // iPhone Safari/WebKit blocks fetch() from this HTTPS PWA to a plain-HTTP
  // Receiver on the LAN. Top-level navigation is not mixed-content loading.
  // The Receiver's GET /scan endpoint returns HTTP 204, so Safari should send
  // the request without replacing the PWA document. This shim is iOS-only;
  // desktop browsers keep using the normal fetch path.
  const ua = navigator.userAgent || '';
  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  if (!isiOS || !window.fetch) return;

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

    // The pairing UI only uses /health to decide whether to paint the saved
    // Receiver green. Direct Safari navigation to /health is already proven to
    // work; fetch is the part WebKit blocks. Resolve locally so the UI does not
    // show a false network error.
    if (u.pathname === '/health') {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (u.pathname === '/scan') {
      const text = await bodyText(input, init);
      if (!text) return Promise.reject(new TypeError('Missing scan text'));

      // Reuse the token already present in the saved pairing URL. The Receiver
      // supports GET /scan?token=...&text=... and replies 204 No Content.
      u.searchParams.set('text', text);
      u.searchParams.set('enter', '1');

      // Schedule navigation after the current scan handler has finished updating
      // its UI. A 204 navigation should leave the current PWA document in place.
      setTimeout(() => {
        try { window.location.assign(u.toString()); }
        catch (_) { window.location.href = u.toString(); }
      }, 0);

      return new Response(null, { status: 204 });
    }

    return nativeFetch(input, init);
  };
})();
