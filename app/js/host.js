/* Expert Report: the bridge between the page and whatever is hosting it.
 *   In the Mac app      messages go to the native side (WKScriptMessageHandlerWithReply named "host").
 *   In local preview    the same calls go to dev/serve.py over HTTP.
 *   Opened as a file    a small fallback keeps data in the browser so the page still works.
 * Calls: info, list, put, remove, saveExport, openInPages, saveAs, reveal, copy, pickImage.
 */
(function (root) {
  'use strict';
  var native = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.host;
  var mode = native ? 'app' : (/^https?:$/.test(location.protocol) ? 'server' : 'local');

  function download(name, b64, type) {
    var bytes = Docx.b64ToBytes(b64), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  var local = {
    info: function () { return { mode: 'local', dataDir: 'this browser', version: 'file' }; },
    list: function (p) { var out = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('er/' + p.collection + '/') === 0) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) { } } } return out; },
    put: function (p) { localStorage.setItem('er/' + p.collection + '/' + p.id, JSON.stringify(p.doc)); return true; },
    remove: function (p) { localStorage.removeItem('er/' + p.collection + '/' + p.id); return true; },
    saveExport: function (p) { download(p.name, p.data); return { path: p.name, downloaded: true }; },
    openInPages: function () { return { ok: false, downloaded: true }; },
    saveAs: function (p) { download(p.name, p.data); return { path: p.name }; },
    reveal: function () { return false; },
    copy: function (p) {
      if (navigator.clipboard && root.ClipboardItem) return navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([p.html], { type: 'text/html' }), 'text/plain': new Blob([p.text], { type: 'text/plain' }) })]).then(function () { return true; });
      return navigator.clipboard.writeText(p.text).then(function () { return true; });
    },
    pickImage: function () { return null; }
  };

  function call(method, params) {
    params = params || {};
    if (mode === 'app') return native.postMessage({ method: method, params: params }).then(function (r) { if (r && r.error) throw new Error(r.error); return r ? r.result : null; });
    if (mode === 'server') return fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: method, params: params }) })
      .then(function (res) { return res.json(); }).then(function (r) { if (r.error) throw new Error(r.error); return r.result; });
    return Promise.resolve().then(function () { return local[method](params); });
  }
  root.Host = { call: call, mode: mode };
})(window);
