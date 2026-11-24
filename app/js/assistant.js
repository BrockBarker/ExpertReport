/* Expert Report: the assistant panel shown in a window of its own (assistant.html).
 * This page only draws and listens. The main window's page (agent.js) sends what to show, and whatever is clicked or typed
 * here is sent back to it, so the conversation, the tools and the case all stay in one place.
 *   In the Mac app      messages travel through the native side (message handler "panel", and window.__panel coming back).
 *   In local preview    the two pages talk over a BroadcastChannel.
 */
(function () {
  'use strict';
  var native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.panel;
  var chan = !native && window.BroadcastChannel ? new BroadcastChannel('er-assistant') : null;
  var root = document.getElementById('agent');
  function $(s) { return document.querySelector(s); }
  function say(m) { if (native) native.postMessage(m); else if (chan) chan.postMessage({ to: 'main', m: m }); }
  function box() { return $('#agent-in'); }
  function bottom() { var lg = $('#agent-log'); if (lg) lg.scrollTop = lg.scrollHeight; }
  function toEnd(b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }

  window.__panel = function (m) {
    if (!m || typeof m !== 'object') return;
    var b = box();
    if (m.t === 'paint') {
      // What is being typed here is kept through a redraw unless the main page sends its own text.
      var keep = typeof m.value === 'string' ? m.value : (b ? b.value : ''), had = b && document.activeElement === b;
      root.innerHTML = String(m.html || ''); b = box();
      if (b) { b.value = keep; if ((had || m.focus) && !b.disabled) toEnd(b); }
      bottom();
    } else if (m.t === 'live') {
      var el = $('#agent-live'); if (el) { el.textContent = m.text || ''; el.hidden = !m.text; bottom(); }
    } else if (m.t === 'value') {
      if (b) { b.value = String(m.value || ''); b.scrollTop = b.scrollHeight; if (m.focus && !b.disabled) toEnd(b); }
    } else if (m.t === 'focus') {
      if (b && !b.disabled) { if (m.end) toEnd(b); else b.focus(); }
    } else if (m.t === 'bye') {
      window.close();
    } else if (m.t === 'probe') {
      // Used by the app's self-test: type and click here the way a person would, then report what this window shows.
      if (typeof m.type === 'string' && b) { b.value = m.type; b.dispatchEvent(new Event('input', { bubbles: true })); }
      var hit = m.click ? $(m.click) : null; if (hit) hit.click();
      var live = $('#agent-live'), lg = $('#agent-log'); b = box();
      say({ t: 'probe', panel: !!$('.agent-panel'), dock: !!$('[data-act=agent-dock]'), value: b ? b.value : null, log: lg ? lg.textContent : '', live: live && !live.hidden ? live.textContent : '', clicked: !!hit });
    }
  };
  if (chan) chan.onmessage = function (e) { if (e.data && e.data.to === 'panel') window.__panel(e.data.m); };

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-act]'); if (!a || a.disabled) return;
    e.preventDefault(); var b = box();
    say({ t: 'act', act: a.dataset.act, text: a.textContent, value: b ? b.value : '' });
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'agent-in') say({ t: 'draft', value: e.target.value }); });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'agent-in' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say({ t: 'act', act: 'agent-send', text: '', value: e.target.value }); }
  });
  window.addEventListener('pagehide', function () { if (chan) say({ t: 'closed' }); });   // the Mac app reports its own window closing
  say({ t: 'ready' });
})();
