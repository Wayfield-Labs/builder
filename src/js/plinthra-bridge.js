/*
 * Plinthra ⇄ Builder bridge client (classic script, loaded before the app).
 *
 * Lets the Builder run Plinthra's Pro Celestials (Cloudflare Workers AI, metered
 * in Photons) in addition to the free Puter models. Exposes:
 *   window.PLINTHRA_BRIDGE.connect()          open the connect popup
 *   window.PLINTHRA_BRIDGE.enabled()          true once a token is stored
 *   window.PLINTHRA_BRIDGE.chat(msgs, opts)   streaming async-iterable of chunks
 *   window.aiChat(msgs, opts)                 transport switch used by the app
 */
(function () {
  'use strict';

  var BRIDGE_URL = window.PLINTHRA_BRIDGE_URL || 'https://plinthra-staging.emjay-74c.workers.dev/api/builder/chat';
  var CONNECT_URL = window.PLINTHRA_CONNECT_URL || 'https://plinthra-staging.emjay-74c.workers.dev/builder/connect';
  var KEY = 'plinthra_bridge_token';
  var token = null;
  try { token = localStorage.getItem(KEY); } catch (e) { /* private mode */ }

  function enabled() { return !!token; }

  function setToken(t) {
    token = t || null;
    try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    updateButton();
    window.dispatchEvent(new CustomEvent('plinthra-bridge-changed', { detail: { enabled: enabled() } }));
  }

  function connect() {
    // Popup: /builder/connect verifies the Plinthra session, mints a bridge
    // token, and postMessages it back to this window.
    window.open(CONNECT_URL, 'plinthra_connect', 'width=460,height=560,menubar=no,toolbar=no');
  }

  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'plinthra_builder_token' && e.data.token) setToken(e.data.token);
  });

  async function chat(messages, opts) {
    opts = opts || {};
    var celestial = opts.celestial || (window.PLINTHRA && window.PLINTHRA.current && window.PLINTHRA.current()) || 'andromeda';
    var res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ messages: messages, tools: opts.tools || window.tools || [], celestial: celestial }),
      signal: opts.signal,
    });
    if (!res.ok) {
      var body = await res.text().catch(function () { return ''; });
      var msg = 'Plinthra bridge error (' + res.status + ')';
      try { var j = JSON.parse(body); if (j && j.message) msg += ': ' + j.message; } catch (e) {}
      throw new Error(msg);
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    return (async function* () {
      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try { yield JSON.parse(line); } catch (e) { /* skip malformed */ }
        }
      }
    })();
  }

  // ---- Minimal connect affordance (fixed pill, avoids touching Builder UI) ----
  function updateButton() {
    var b = document.getElementById('plinthra-bridge-btn');
    if (!b) return;
    b.textContent = enabled() ? 'Plinthra Pro ✓' : 'Connect Plinthra';
    b.style.borderColor = enabled() ? 'rgba(255,122,51,0.6)' : 'rgba(255,255,255,0.14)';
    b.style.color = enabled() ? '#ff9a5c' : '#9aa4b2';
  }
  function injectButton() {
    if (document.getElementById('plinthra-bridge-btn')) return;
    var b = document.createElement('button');
    b.id = 'plinthra-bridge-btn';
    b.type = 'button';
    b.title = 'Run Pro Celestials (Horizon, Singularity, Andromeda) through Plinthra, metered in Photons';
    b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483000;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(10,14,22,0.86);color:#9aa4b2;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;cursor:pointer;backdrop-filter:blur(8px)';
    b.addEventListener('click', function () { if (enabled()) setToken(null); else connect(); });
    document.body.appendChild(b);
    updateButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton);
  else injectButton();

  window.PLINTHRA_BRIDGE = { enabled: enabled, setToken: setToken, connect: connect, chat: chat, getToken: function () { return token; } };

  // Transport switch: Pro bridge when connected, otherwise the free Puter path.
  window.aiChat = function (messages, opts) {
    if (enabled() && window.PLINTHRA_BRIDGE) return window.PLINTHRA_BRIDGE.chat(messages, opts);
    return puter.ai.chat(messages, opts);
  };
})();
