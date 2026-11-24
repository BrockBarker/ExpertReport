/* Expert Report: the Report tab. A word processor for the case's report.
 * The first version is generated from the case, optionally drafted by Claude from the photos, emails and notes;
 * after that the arborist edits it here. The document is saved in the case folder (Case data/report.json).
 * A case can hold three versions of its report: Version 1 is report.json, Versions 2 and 3 are report-v2.json and report-v3.json.
 * W.docs[caseId] is always the version on screen (W.ver[caseId]), so everything else works on that one. */
(function () {
  'use strict';
  const A = App, S = A.S, $ = A.$, $$ = A.$$, esc = A.esc, toast = A.toast, plural = A.plural, C = CaseUI, CR = CaseReport;
  const W = { docs: {}, state: {}, dirty: {}, ver: {}, have: {}, timer: null, checkTimer: null, busy: null };
  const MODELS = [['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-fable-5-2', 'Claude Fable 5.2 (most capable, costs more)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, costs less)']];
  const PRICE = { 'claude-opus-5-5': [4, 20], 'claude-fable-5-2': [8, 40], 'claude-sonnet-5-5': [2, 10] }; // dollars per million tokens, in and out

  const modelName = id => { const m = MODELS.find(x => x[0] === id); return m ? m[1].replace(/ \(.*$/, '') : id || 'Claude'; };
  const VERSIONS = [1, 2, 3];
  const verOf = id => W.ver[id] || 1;
  const docName = (id, v) => { v = v || verOf(id); return v === 1 ? 'report' : 'report-v' + v; };
  const ctxFor = (c, r) => ({ path: r.path, files: C.filesOf(c), photos: C.photosIn(c), appraisals: C.caseAppraisals(c).filter(a => !(c.apOut && c.apOut[a.id])), settings: S.settings, ratings: S.ratings, sheets: S.sheets });
  function load(id) {
    const r = S.cases[id], v = verOf(id); W.state[id] = 'loading';
    Promise.all([Host.call('caseGet', { path: r.path, name: docName(id, v) }).catch(() => null), Host.call('caseNames', { path: r.path, prefix: 'report' }).catch(() => [])])
      .then(got => {
        if (verOf(id) !== v) return;   // the user picked another version while this one was opening
        const d = got[0]; W.docs[id] = d && typeof d.html === 'string' ? d : null;
        W.have[id] = {}; (got[1] || []).forEach(n => { const m = /^report(?:-v(\d))?$/.exec(n); if (m) W.have[id][+(m[1] || 1)] = true; });
        W.state[id] = 'ready';
        if (S.route.view === 'case' && S.route.id === id && S.route.tab === 'report') A.render();
      });
  }
  function putDoc(id) {
    const r = S.cases[id], d = W.docs[id]; delete W.dirty[id]; if (!r || !d) return Promise.resolve();
    d.updatedAt = Date.now();
    const v = verOf(id);
    return Host.call('casePut', { path: r.path, name: docName(id, v), doc: d }).then(() => { (W.have[id] = W.have[id] || {})[v] = true; setNote('Saved in the case folder'); }, e => { W.dirty[id] = 1; setNote('Not saved: ' + (e.message || e)); });
  }
  function flushDocs() { clearTimeout(W.timer); return Promise.all(Object.keys(W.dirty).map(putDoc)); }
  function saveDoc(id, ms) { W.dirty[id] = 1; clearTimeout(W.timer); W.timer = setTimeout(flushDocs, ms === undefined ? 700 : ms); }
  const setNote = t => { const n = $('#ed-note'); if (n) n.textContent = t; };

  // ---------- keeping the document clean ----------
  const KEEP = { P: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1 };
  function clean(root) {
    // Auto blocks are emptied; they are filled in fresh whenever the report is shown or exported.
    root.querySelectorAll('[data-auto]').forEach(n => { const k = n.getAttribute('data-auto'); while (n.attributes.length) n.removeAttribute(n.attributes[0].name); n.setAttribute('data-auto', k); n.innerHTML = ''; });
    (function walk(node) {
      Array.from(node.children).forEach(el => {
        if (el.hasAttribute('data-auto')) return;
        walk(el);
        if (!KEEP[el.tagName]) { const top = el.parentNode === root; if (top && el.tagName === 'DIV' && !el.querySelector('p,h2,h3,ul,ol,div')) { const p = document.createElement('p'); while (el.firstChild) p.appendChild(el.firstChild); el.replaceWith(p); } else { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); } }
        else while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
      });
    })(root);
    Array.from(root.childNodes).forEach(n => { if (n.nodeType === 3) { if (n.nodeValue.trim()) { const p = document.createElement('p'); p.textContent = n.nodeValue; n.replaceWith(p); } else n.remove(); } else if (n.nodeType === 1 && /^(B|STRONG|I|EM|U|BR|LI)$/.test(n.tagName)) { const p = document.createElement('p'); n.replaceWith(p); p.appendChild(n); } });
    return root;
  }
  const serialize = ed => clean(ed.cloneNode(true)).innerHTML;
  const TOOLS = '<span class="auto-t"><button class="link" data-act="auto-after" tabindex="-1" title="Start a paragraph right below this">Write below</button><button class="link" data-act="auto-del" tabindex="-1">Remove</button></span>';
  function hydrateBlock(n, c, cx) {
    const key = n.getAttribute('data-auto'); n.setAttribute('contenteditable', 'false');
    if (key === 'break') { n.className = 'auto brk'; n.innerHTML = '<span>Page break</span>' + TOOLS; return; }
    n.className = 'auto';
    const body = CR.html(CR.auto(c, cx, key), { thumbs: true });
    n.innerHTML = '<div class="auto-h"><span>' + esc(CR.autoLabel(key, cx)) + '</span>' + TOOLS + '</div>' + (body || '<p class="hint">Nothing to show yet. Fill it in on its tab.</p>');
  }
  function hydrate() {
    const ed = $('#ed'), r = C.rec(); if (!ed || !r || !W.docs[r.doc.id]) return;
    ed.innerHTML = W.docs[r.doc.id].html; const cx = ctxFor(r.doc, r);
    ed.querySelectorAll('[data-auto]').forEach(n => hydrateBlock(n, r.doc, cx));
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
  }
  function sync() { const ed = $('#ed'), r = C.rec(); if (ed && r && W.docs[r.doc.id] && ed.dataset.caseId === r.doc.id && ed.childNodes.length) W.docs[r.doc.id].html = serialize(ed); }

  // ---------- the tab ----------
  function versionBar(c) {
    const v = verOf(c.id), known = W.have[c.id], has = n => (known && known[n]) || (n === v && !!W.docs[c.id]);
    return '<div class="row" style="margin-bottom:12px;gap:12px;align-items:center"><div class="seg" role="group" aria-label="Report version">' +
      VERSIONS.map(n => '<button type="button" data-act="doc-ver" data-v="' + n + '" aria-pressed="' + (n === v) + '"' + (W.busy ? ' disabled' : '') + '>Version ' + n + (known && !has(n) ? ' <span style="font-weight:400;opacity:.7">(empty)</span>' : '') + '</button>').join('') +
      '</div><span class="hint">Each version is its own report for this case, saved separately in the case folder.</span></div>';
  }
  function copyOffer(c) {
    const v = verOf(c.id), others = VERSIONS.filter(n => n !== v && W.have[c.id] && W.have[c.id][n]);
    return others.length ? '<div class="row" style="margin-top:10px;gap:8px;align-items:center"><span class="hint">Or start from a copy of</span>' + others.map(n => '<button class="btn" data-act="doc-copy" data-v="' + n + '">Version ' + n + '</button>').join('') + '</div>' : '';
  }
  function checksHTML(c, r) {
    const d = W.docs[c.id], list = CR.checks(c, ctxFor(c, r), d ? d.html : null);
    return '<ul class="checks">' + (list.length ? list.map(k => '<li data-l="' + k.level + '">' + esc(k.text) + '</li>').join('') : '<li class="ok">Nothing missing and nothing flagged.</li>') + '</ul>';
  }
  C.TAB.report = function (c, r) {
    if (!W.state[c.id]) { load(c.id); return versionBar(c) + '<p class="hint">Opening the report…</p>'; }
    if (W.state[c.id] === 'loading') return versionBar(c) + '<p class="hint">Opening the report…</p>';
    sync();
    const d = W.docs[c.id];
    if (W.busy && W.busy.caseId === c.id) return versionBar(c) + '<div class="card"><h2>Drafting the report</h2><p class="sub" id="ai-progress">' + esc(W.busy.text || 'Sending the case material…') + '</p><p class="hint" style="margin-top:8px">This usually takes a minute or two. You can look at other tabs while it works.</p></div>';
    if (!d) return versionBar(c) + '<div class="card"><h2>Write ' + (verOf(c.id) === 1 ? 'the report' : 'Version ' + verOf(c.id) + ' of the report') + '</h2><p class="sub">Start with a first version built from this case, then edit it here like any document. The cover, tables, signature lines and photo pages come from the other tabs and stay up to date.</p>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary big" data-act="ai-draft">Draft it with Claude…</button><button class="btn big" data-act="doc-start">Start from the outline only</button></div>' + copyOffer(c) +
      '<p class="hint" style="margin-top:8px">Claude writes a first draft of each section from the case’s photos, emails and notes. It is told to write only what that material supports and to leave your opinions for you, marked in [square brackets]. You will see exactly what is sent before anything leaves this Mac.</p></div>' + C.outlineCards(c);
    const q = d.questions || [];
    return versionBar(c) + '<div class="edbar"><select class="in" data-block aria-label="Paragraph style" style="width:150px"><option value="p">Body text</option><option value="h2">Heading</option><option value="h3">Subheading</option></select>' +
      '<button class="tb" data-cmd="bold" title="Bold" aria-label="Bold"><b>B</b></button><button class="tb" data-cmd="italic" title="Italic" aria-label="Italic"><i>I</i></button><button class="tb" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>' +
      '<button class="tb" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">• List</button><button class="tb" data-cmd="insertOrderedList" title="Numbered list" aria-label="Numbered list">1. List</button>' +
      '<select class="in" data-insert aria-label="Insert" style="width:190px"><option value="">Insert…</option><option value="break">Page break</option><option value="materials">Materials reviewed</option>' + ctxFor(c, r).appraisals.map(a => '<option value="appraisal:' + a.id + '">Appraisal table: ' + esc(A.R.title(a)) + '</option>' + (A.E.compareKeys(a).length ? '<option value="compare:' + a.id + '">Comparison of editions and methods: ' + esc(A.R.title(a)) + '</option>' : '')).join('') +
      '<option value="risk">Risk tables</option><option value="zones">Protection zones</option><option value="recs">Preservation recommendations</option><option value="signatures">Signature lines</option><option value="photos">Photo pages</option><option value="appendix">Appraisal worksheet</option><option value="cover">Cover page</option></select>' +
      '<span class="sp"></span><span class="hint" id="ed-note">Saved in the case folder</span><button class="btn primary" data-act="doc-pdf">Export PDF</button><button class="btn" data-act="doc-pages">Open in Pages</button>' +
      '<select class="in" data-more aria-label="More" style="width:120px"><option value="">More…</option><option value="ai">Draft again with Claude…</option><option value="rebuild">Rebuild from the case…</option>' + (d.previous ? '<option value="restore">Go back to the version before the last rebuild</option>' : '') + '</select></div>' +
      '<div class="edwrap"><div id="ed" class="sheet" contenteditable="true" spellcheck="true" data-case-id="' + c.id + '" role="textbox" aria-multiline="true" aria-label="Report"></div>' +
      '<aside class="edside"><div class="card"><h2>Checks</h2><div id="ed-checks">' + checksHTML(c, r) + '</div></div>' +
      '<div class="card" data-ed-cover><h2>Cover</h2><div style="display:grid;gap:10px">' + A.field('Title on the cover', 'reportTitle', c.reportTitle) + A.field('Report date', 'reportDate', c.reportDate, { type: 'date' }) + '</div><p class="hint" style="margin-top:8px">Who it is submitted to and by is on the Overview tab.</p></div>' +
      (q.length ? '<div class="card"><div class="row"><h2 style="margin:0">Questions from the draft</h2><span class="sp"></span><button class="link" data-act="ai-q-clear">Clear</button></div><p class="hint" style="margin:6px 0">What Claude could not find in the case material.</p><ul class="ref">' + q.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') +
      (d.ai ? '<p class="hint" style="margin-top:10px">Drafted with ' + esc(modelName(d.ai.model)) + (d.ai.fallback ? ' (the model you chose declined, so the service used this one)' : '') + ' on ' + esc(C.fmtDate(new Date(d.ai.at).toISOString())) + (d.ai.cost ? ', about ' + esc(d.ai.cost) : '') + '. Everything in it is yours to check.</p>' : '') + '</aside></div>' +
      '<details class="outline" data-ed-outline' + (W.outlineOpen ? ' open' : '') + '><summary>Outline: the sections a new draft or a rebuild starts from</summary><p class="hint" style="margin:8px 0 12px">Changing the outline does not change the document above. It is used the next time you choose “Draft again with Claude” or “Rebuild from the case” under More.</p>' + C.outlineCards(c) + '</details>';
  };
  const prevAfter = A.after['case'];
  A.after['case'] = function (r) { if (r.tab === 'report') hydrate(); if (prevAfter) prevAfter(r); };

  // ---------- editing ----------
  function caretIn(p) { const ed = $('#ed'), rg = document.createRange(), sel = window.getSelection(); ed.focus(); rg.setStart(p, 0); rg.collapse(true); sel.removeAllRanges(); sel.addRange(rg); }
  function refreshAutos() { const ed = $('#ed'), r = C.rec(); if (!ed || !r) return; const cx = ctxFor(r.doc, r); ed.querySelectorAll('[data-auto]').forEach(n => hydrateBlock(n, r.doc, cx)); if (prevAfter) prevAfter(S.route); }
  function topBlock(node) { const ed = $('#ed'); while (node && node.parentNode !== ed) node = node.parentNode; return node; }
  function changed() {
    const r = C.rec(), ed = $('#ed'); if (!r || !ed || !W.docs[r.doc.id]) return;
    if (!ed.firstChild) { const p = document.createElement('p'); p.appendChild(document.createElement('br')); ed.appendChild(p); caretIn(p); }
    else if (Array.from(ed.childNodes).some(n => n.nodeType === 3 && n.nodeValue.trim())) { try { document.execCommand('formatBlock', false, 'p'); } catch (e) { } }
    setNote('Saving…'); W.docs[r.doc.id].html = serialize(ed); saveDoc(r.doc.id);
    clearTimeout(W.checkTimer); W.checkTimer = setTimeout(() => { const el = $('#ed-checks'), rr = C.rec(); if (el && rr) el.innerHTML = checksHTML(rr.doc, rr); }, 900);
  }
  document.addEventListener('input', e => { if (e.target.id === 'ed') changed(); else if (e.target.closest && e.target.closest('[data-ed-cover]')) { clearTimeout(W.coverTimer); W.coverTimer = setTimeout(() => { refreshAutos(); const el = $('#ed-checks'), rr = C.rec(); if (el && rr) el.innerHTML = checksHTML(rr.doc, rr); }, 250); } });
  document.addEventListener('mousedown', e => { const b = e.target.closest && e.target.closest('[data-cmd]'); if (!b) return; e.preventDefault(); $('#ed').focus(); document.execCommand(b.dataset.cmd, false, null); changed(); });
  document.addEventListener('paste', e => { if (!e.target.closest || !e.target.closest('#ed')) return; e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); if (t) document.execCommand('insertText', false, t); });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.target.closest && e.target.closest('#ed')) { const cmd = { b: 'bold', i: 'italic', u: 'underline' }[String(e.key).toLowerCase()]; if (cmd) { e.preventDefault(); document.execCommand(cmd, false, null); changed(); return; } }
    if (e.key !== 'Enter' || e.shiftKey || !e.target.closest || !e.target.closest('#ed')) return;
    const sel = window.getSelection(), blk = sel.rangeCount ? topBlock(sel.anchorNode) : null;
    if (blk && /^H[23]$/.test(blk.tagName)) { e.preventDefault(); const p = document.createElement('p'); p.appendChild(document.createElement('br')); blk.after(p); const rg = document.createRange(); rg.setStart(p, 0); rg.collapse(true); sel.removeAllRanges(); sel.addRange(rg); changed(); }
  });
  document.addEventListener('toggle', e => { if (e.target.hasAttribute && e.target.hasAttribute('data-ed-outline')) W.outlineOpen = e.target.open; }, true);
  document.addEventListener('selectionchange', () => { const s = $('[data-block]'), sel = window.getSelection(); if (!s || !sel.rangeCount || !$('#ed') || !$('#ed').contains(sel.anchorNode)) return; const b = topBlock(sel.anchorNode); s.value = b && b.tagName === 'H2' ? 'h2' : b && b.tagName === 'H3' ? 'h3' : 'p'; });
  document.addEventListener('change', e => {
    const el = e.target, r = C.rec(); if (!r) return;
    if (el.hasAttribute('data-block')) { $('#ed').focus(); document.execCommand('formatBlock', false, el.value); changed(); }
    else if (el.hasAttribute('data-insert') && el.value) { insertAuto(el.value); el.value = ''; }
    else if (el.hasAttribute('data-more') && el.value) { const v = el.value; el.value = ''; if (v === 'ai') A.ACT['ai-draft'](); else if (v === 'rebuild') rebuild(true); else if (v === 'restore') restore(); }
    else if (el.hasAttribute('data-ai-model')) { S.settings.aiModel = el.value; A.save('library', 'settings'); }
  });
  function insertAuto(key) {
    const ed = $('#ed'), r = C.rec(), sel = window.getSelection(); let at = sel.rangeCount && ed.contains(sel.anchorNode) ? topBlock(sel.anchorNode) : ed.lastChild;
    const n = document.createElement('div'); n.setAttribute('data-auto', key); if (at) at.after(n); else ed.appendChild(n);
    hydrateBlock(n, r.doc, ctxFor(r.doc, r)); const p = document.createElement('p'); p.appendChild(document.createElement('br')); n.after(p);
    changed(); if (prevAfter) prevAfter(S.route); n.scrollIntoView({ block: 'center' });
  }
  // When the document is replaced from outside the page (a rebuild, a new draft, going back a version), the page on screen is stale.
  // It is emptied at once, so its old contents can never be read back over the new document.
  function dropPage(id) { const ed = $('#ed'); if (ed && ed.dataset.caseId === id) ed.textContent = ''; }
  function startDoc(c, r, extra) { sync(); const old = W.docs[c.id]; W.docs[c.id] = Object.assign({ html: CR.outline(c, ctxFor(c, r)), createdAt: Date.now(), previous: old ? old.html : null }, extra || {}); dropPage(c.id); saveDoc(c.id, 0); }
  function rebuild(ask) {
    const r = C.rec(); if (!r) return; sync();
    if (ask) { S.modal = { type: 'rebuild' }; A.openModal('<h2>Rebuild from the case?</h2><p class="sub">This replaces the document with a fresh one built from the outline and the text in each section on the outline, as they were last drafted. Your current version is kept, and “More” will offer to go back to it.</p><div class="row end" style="margin-top:14px"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="doc-rebuild-ok">Rebuild</button></div>', true); return; }
    startDoc(r.doc, r); A.closeModal(); A.render(); toast('Rebuilt from the case');
  }
  async function switchVersion(id, v) {
    if (W.busy || !S.cases[id] || VERSIONS.indexOf(v) < 0 || verOf(id) === v) return;
    sync(); await flushDocs();   // the version on screen is written to its own file before the other one opens
    dropPage(id); W.ver[id] = v; delete W.docs[id]; delete W.state[id]; A.render();
  }
  async function copyVersion(id, from) {
    const r = S.cases[id], v = verOf(id); if (!r || W.busy || from === v) return;
    const src = await Host.call('caseGet', { path: r.path, name: docName(id, from) }).catch(() => null);
    if (verOf(id) !== v) return;
    if (!src || typeof src.html !== 'string') { toast('Version ' + from + ' has nothing in it yet'); return; }
    W.docs[id] = Object.assign({}, src, { createdAt: Date.now(), previous: null, copiedFrom: from }); W.state[id] = 'ready';
    dropPage(id); saveDoc(id, 0); A.render(); toast('Version ' + v + ' started as a copy of Version ' + from);
  }
  function restore() { const r = C.rec(); if (!r) return; sync(); const d = W.docs[r.doc.id]; if (!d || !d.previous) return; const cur = d.html; d.html = d.previous; d.previous = cur; dropPage(r.doc.id); saveDoc(r.doc.id, 0); A.render(); toast('Went back to the earlier version'); }

  // ---------- exports ----------
  const fileBase = c => (c.reportTitle || c.name || 'Report').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + (verOf(c.id) > 1 ? ' - Version ' + verOf(c.id) : '');
  async function exportDoc(kind, b) {
    const r = C.rec(), c = r.doc; sync(); const d = W.docs[c.id]; if (!d) return;
    const old = b.textContent; b.disabled = true; b.textContent = kind === 'pdf' ? 'Making the PDF…' : 'Building…';
    try {
      await A.flush(); await flushDocs(); const cx = ctxFor(c, r);
      if (kind === 'pdf') {
        const html = await CR.printable(c, cx, d.html);
        const out = await Host.call('exportPDF', { path: r.path, name: fileBase(c) + ' - ' + A.today() + '.pdf', html: html, title: c.name || c.reportTitle || '', logo: S.settings.logo || null });
        toast(out && out.pages ? 'PDF saved in the case’s Reports folder: ' + plural(out.pages, 'page') : (out && out.note) || 'Saved in the case’s Reports folder');
      } else {
        const built = await CR.build(c, cx, d.html);
        const saved = await Host.call('caseSaveReport', { path: r.path, name: fileBase(c) + ' - ' + A.today() + '.docx', data: Docx.bytesToB64(built.bytes) });
        await Host.call('openInPages', { path: saved.path }); toast('Opening in Pages…');
      }
    } catch (e) { toast('Could not export: ' + (e.message || e)); }
    b.disabled = false; b.textContent = old;
  }

  // ---------- drafting with Claude ----------
  const SCHEMA = { type: 'object', additionalProperties: false, required: ['letter', 'sections', 'captions', 'field_notes', 'questions'], properties: {
    letter: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } },
    captions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['photo', 'caption'], properties: { photo: { type: 'integer' }, caption: { type: 'string' } } } },
    field_notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'text'], properties: { page: { type: 'integer' }, text: { type: 'string' } } } },
    questions: { type: 'array', items: { type: 'string' } } } };
  const SYSTEM = [
    'You are helping a consulting arborist prepare the first draft of a written report. The arborist is the expert and the author: they will edit every word, sign the report, and may have to defend it under cross-examination. Your job is to organize what the case material says into clear prose so they start from a draft instead of a blank page.',
    'Write only what the material you are given supports. Do not invent observations, measurements, dates, names, quotations or sources, and do not cite any publication unless it appears in the material. If two sources disagree, say so and name them.',
    'Opinions and conclusions belong to the arborist. Where the material records their opinion (in their notes, for example), write it up in their voice. Where a section needs their observation, measurement or professional opinion and the material does not supply it, put a short placeholder in square brackets that says what is needed, such as [your opinion on the cause of the decline], and add a matching entry to "questions". Never fill such a gap with a plausible guess. A draft with honest gaps is far more useful than one that reads complete and is wrong.',
    'Voice: first person, plain and measured, the way a careful professional writes to a client or to counsel. Use "I" for one author and "we" for more than one, as stated in the case facts. Past tense for what was seen on site. Refer to the trees at issue as the subject trees once they have been introduced. No headings inside a section, no bold, no lists unless a list is clearly the natural form (observations usually are). For a list, start each line with "- ". Separate paragraphs with a blank line.',
    'Photos are numbered in the order given. When a statement rests on a photo, refer to it in parentheses, as in (Photo 3). For each photo that has no caption yet, write a caption of one or two factual sentences saying what the photo shows; if the material says who supplied it or when it was taken, include that. Describe only what is visible.',
    'Field note pages are photographs of handwritten notes. Transcribe each one as faithfully as you can into "field_notes", keeping the writer’s numbers and units exactly, and mark anything you cannot read with [?]. Use what the notes say in the draft, and list any doubtful reading in "questions" so the arborist can check it against the page.',
    'The application adds these parts itself, so do not write them: the cover, the qualifications, the list of materials reviewed, the certification, and all tables (appraisal values, risk ratings, tree protection zones) and the preservation recommendations list. You may refer to them, as in "the appraisal is set out in the table below". The numbers in any such table are given to you under "Figures the application will print"; if you mention one, use exactly that figure.',
    'Return the letter body (no greeting, no sign-off), one entry in "sections" for every section id you were given (an empty string is right for a section the material says nothing about), the captions, the field note transcriptions, and the questions.'
  ].join('\n\n');

  // The text under each heading of the document as it stands, in the plain form the outline uses.
  function docSections(html) {
    const out = {}; let cur = null;
    CR.parse(html).forEach(b => {
      if (b.t === 'h') { cur = b.text; out[cur] = []; return; }
      if (!cur || b.t !== 'rich') return;
      const t = b.runs.map(x => x.text).join('').trim(); if (!t && !out[cur].length) return;
      out[cur].push({ text: t, list: !!(b.bullet || b.num) });
    });
    Object.keys(out).forEach(k => { let txt = ''; out[k].forEach((x, i) => { const prev = out[k][i - 1]; txt += (i ? (x.list && prev.list ? '\n' : '\n\n') : '') + (x.list ? '- ' : '') + x.text; }); out[k] = txt.trim(); });
    return out;
  }
  async function gather(c, r) {
    const files = C.filesOf(c), cx = ctxFor(c, r), who = CR.people(c, S.settings), sent = [], skipped = [], content = [], T = [];
    const sections = c.sections.filter(s => s.on && ['qualifications', 'materials', 'certification'].indexOf(s.key) < 0);
    T.push('CASE FACTS', 'Short name: ' + (c.name || ''), 'Kind of case: ' + (C.TYPES.find(t => t[0] === c.type) || ['', ''])[1], 'Report title: ' + (c.reportTitle || ''), 'Submitted to: ' + ((c.to && c.to.name) || ''),
      'Authors (' + who.length + '): ' + who.map(p => p.name).join('; '), 'Site visit date or dates: ' + (c.visits ? c.visits + (c.visitsFrom === 'photos' ? ' (the day most of the site photographs were taken)' : '') : 'not stated'), 'Date of loss or incident: ' + (c.lossDate || 'not stated'), 'Retained by: ' + (c.retainedBy || 'not stated'), 'Matter: ' + (c.matter || 'not stated'), 'The arborist’s own notes on the case: ' + (c.notes || 'none'), '');
    T.push('SECTIONS TO DRAFT (id, heading, and anything the arborist has already written, which you should keep and build on)');
    const inDoc = W.docs[c.id] ? docSections(W.docs[c.id].html) : {}, written = s => String(inDoc[s.title] !== undefined ? inDoc[s.title] : s.text || '').trim();
    sections.forEach(s => T.push('- id ' + s.id + ' | ' + s.title + (written(s) ? ' | already written:\n' + written(s) : '')));
    T.push('', 'LETTER: write the body of a short cover letter to the person the report is submitted to, saying what was asked for and what the report is based on.', '');
    const figs = [];
    cx.appraisals.forEach(a => { const R0 = A.E.calcAppraisal(a); figs.push('Appraisal "' + A.R.title(a) + '" (' + (A.E.edition(a) === '9' ? '9th' : '10th') + ' edition): ' + R0.n + ' trees, trees ' + A.E.money(R0.trees) + ', other costs ' + A.E.money(R0.lines) + ', total ' + A.E.money(R0.total) + '.\n' + A.R.tableTSV(A.R.summary(a, R0))); });
    cx.appraisals.forEach(a => { const ks = A.E.compareKeys(a); if (ks.length) { const cmp = A.E.compare(a); figs.push('Comparison for "' + A.R.title(a) + '", total for the trees under each: ' + ks.map(k => A.E.approach(k).name + ' ' + A.E.money(cmp.by[k].A.trees)).join('; ') + '. The report prints a table of these; do not choose between them or say which is right.'); } });
    (c.risk.trees || []).forEach((t, i) => { const k = Risk.calcTree(t); figs.push('Risk, tree ' + Risk.label(t, i) + ' (' + (t.species || 'species not stated') + '): overall ' + (k.overall || 'not rated') + '. ' + (t.location || '') + (t.mitigation ? ' Mitigation noted: ' + t.mitigation : '')); });
    (c.preserve.trees || []).forEach((t, i) => { const k = Zones.calcTree(t, c.preserve); if (k.r !== null) figs.push('Protection zone, tree ' + Zones.label(t, i) + ' (' + (t.species || '') + ', ' + t.dbh + ' in): radius ' + Zones.fmt(k.r, 1) + ' ft' + (k.total !== null ? ', about ' + Zones.fmt(k.total, 0) + '% disturbed' : '') + '.' + (t.notes ? ' Notes: ' + t.notes : '')); });
    if (c.preserve.project) figs.push('Project near the trees: ' + c.preserve.project);
    if (figs.length) T.push('FIGURES THE APPLICATION WILL PRINT', figs.join('\n'), '');
    // written material: notes, emails and other text files
    let chars = 0; const texts = files.filter(f => (f.kind === 'text' || f.kind === 'email') && f.folder !== 'Reports');
    for (const f of texts) {
      if (f.size > 1500000 || chars > 600000) { skipped.push(f.rel + ' (too long to send whole)'); continue; }
      try { const t = await Host.call('caseReadText', { path: r.path, rel: f.rel }); chars += t.length; const m = c.files[f.rel] || {}; T.push('FILE: ' + f.rel + (m.desc ? ' | ' + m.desc : '') + (m.source ? ' | from ' + m.source : ''), t.trim(), 'END OF FILE', ''); sent.push(f.rel); } catch (e) { skipped.push(f.rel + ' (could not be read)'); }
    }
    const others = files.filter(f => ['pdf', 'doc', 'sheet', 'video', 'other'].indexOf(f.kind) >= 0 && f.folder !== 'Reports');
    if (others.length) T.push('OTHER FILES IN THE CASE (listed for reference; only the PDFs marked as sent below are attached)', others.map(f => { const m = c.files[f.rel] || {}; return '- ' + f.rel + (m.desc ? ': ' + m.desc : '') + (m.source ? ' (from ' + m.source + ')' : ''); }).join('\n'), '');
    if (String(c.otherMaterials || '').trim()) T.push('OTHER MATERIALS THE ARBORIST REVIEWED', c.otherMaterials.trim(), '');
    // PDFs the arborist marked as reviewed, within the size the service accepts in one request
    let bytes = 0; const pdfs = [];
    files.filter(f => f.kind === 'pdf' && f.folder !== 'Reports').forEach(f => { const m = c.files[f.rel] || {}; if (!m.reviewed) { skipped.push(f.rel + ' (PDF not ticked as reviewed on the Files tab)'); return; } if (bytes + f.size > 18000000) { skipped.push(f.rel + ' (too large to send with the rest)'); return; } bytes += f.size; pdfs.push(f); });
    // photos: the ones chosen for the report, or failing that the first twenty in the case; then field note pages
    const chosen = cx.photos.length ? cx.photos : files.filter(f => f.kind === 'image' && !C.isNote(c, f) && f.folder !== 'Reports').slice(0, 20);
    const photos = chosen.slice(0, 24); chosen.slice(24).forEach(f => skipped.push(f.rel + ' (more photos than one request should carry)'));
    const notes = files.filter(f => C.isNote(c, f) && photos.indexOf(f) < 0).slice(0, 10);
    content.push({ type: 'text', text: T.join('\n') });
    pdfs.forEach(f => { content.push({ type: 'text', text: 'PDF: ' + f.rel + ((c.files[f.rel] || {}).desc ? ' | ' + c.files[f.rel].desc : '') }, { type: 'case_pdf', rel: f.rel }); sent.push(f.rel); });
    photos.forEach((f, i) => { const m = c.files[f.rel] || {}; content.push({ type: 'text', text: 'Photo ' + (i + 1) + ' | file ' + f.name + (f.taken ? ' | taken ' + f.taken.slice(0, 10) : '') + (m.source ? ' | source: ' + m.source : '') + (String(m.caption || '').trim() ? ' | caption already written (keep it): ' + m.caption.trim() : ' | needs a caption') }, { type: 'case_image', rel: f.rel, max: 1200 }); sent.push(f.rel); });
    notes.forEach((f, i) => { const m = c.files[f.rel] || {}; content.push({ type: 'text', text: 'Field note page ' + (i + 1) + ' | file ' + f.name + (String(m.transcript || '').trim() ? ' | the arborist’s own typed copy (trust it over your reading): ' + m.transcript.trim() : '') }, { type: 'case_image', rel: f.rel, max: 2000 }); sent.push(f.rel); });
    content.push({ type: 'text', text: 'Draft the report sections now, following your instructions. Remember: nothing that the material does not support, and bracketed placeholders with matching questions wherever the arborist’s own knowledge or opinion is needed.' });
    return { content: content, sent: sent, skipped: skipped, sections: sections, photos: photos, notes: notes, usedReportPhotos: cx.photos.length > 0 };
  }
  function applyDraft(c, r, g, out, meta) {
    const byId = {}; (out.sections || []).forEach(s => { byId[s.id] = s.text; });
    c.sections.forEach(s => { if (byId[s.id] !== undefined && String(byId[s.id]).trim()) { if (String(s.text || '').trim()) s.before = s.text; s.text = byId[s.id]; } });
    if (String(out.letter || '').trim()) { c.letterBefore = c.letter; c.letter = out.letter.trim(); }
    if (!g.usedReportPhotos) c.photos = g.photos.map(f => f.rel);   // the photos Claude numbered become the photos in the report
    (out.captions || []).forEach(k => { const f = g.photos[k.photo - 1]; if (!f) return; const m = (c.files[f.rel] = c.files[f.rel] || {}); if (!String(m.caption || '').trim() && String(k.caption || '').trim()) { m.caption = k.caption.trim(); m.captionBy = 'draft'; } });
    (out.field_notes || []).forEach(k => { const f = g.notes[k.page - 1]; if (!f) return; const m = (c.files[f.rel] = c.files[f.rel] || {}); if (!String(m.transcript || '').trim() && String(k.text || '').trim()) { m.transcript = k.text.trim(); m.transcriptBy = 'draft'; } });
    A.save('cases', c.id, 0);      // by id: the user may have moved to another case while the draft was being written
    startDoc(c, r, { questions: out.questions || [], ai: meta });
  }
  async function runDraft() {
    const r = C.rec(), c = r.doc, g = W.pending; if (!g) return; W.pending = null; A.closeModal(); sync();
    W.busy = { caseId: c.id, text: 'Sending the case material…' }; A.render();
    try {
      const model = S.settings.aiModel || MODELS[0][0];
      const res = await Host.call('ai', { path: r.path, model: model, effort: 'high', maxTokens: 64000, system: SYSTEM, content: g.content, schema: SCHEMA });
      if (res.stop === 'refusal') throw new Error('Anthropic\u2019s safety filter declined this request' + (res.detail ? ' (category: ' + res.detail + ')' : '') + '. That can happen by mistake with ordinary case material. Try again, or pick a different model in the drafting window.');
      if (res.stop === 'max_tokens') throw new Error('The draft ran past the length limit and was cut off. Try again with fewer sections switched on.');
      let out; try { out = JSON.parse(res.text); } catch (e) { try { out = JSON.parse(res.tail); } catch (e2) { throw new Error('The draft came back in a form the app could not read. Try again.'); } }
      if (!out || typeof out !== 'object' || !Array.isArray(out.sections)) throw new Error('The draft came back in a form the app could not read. Try again.');
      const p = PRICE[res.model] || PRICE[model], u = res.usage || {}, cost = p && u.input_tokens ? '$' + ((u.input_tokens * p[0] + (u.output_tokens || 0) * p[1]) / 1e6).toFixed(2) : '';
      W.busy = null; applyDraft(c, r, g, out, { at: Date.now(), model: res.model || model, usage: u, cost: cost, sent: g.sent.length, fallback: !!res.fallback });
      if (S.route.view === 'case' && S.route.id === c.id) { S.route.tab = 'report'; A.render(); }
      toast('Draft ready' + (cost ? ' (about ' + cost + ')' : '') + '. Check it against the case before you rely on it.');
    } catch (e) { W.busy = null; A.render(); A.openModal('<h2>The draft did not finish</h2><p class="sub">' + esc(e.message || String(e)) + '</p><p class="hint" style="margin-top:8px">Nothing in the case was changed.</p><div class="row end" style="margin-top:14px"><button class="btn primary" data-act="close-modal">Close</button></div>', true); }
  }
  // The Mac app calls this while the draft streams in.
  window.__aiProgress = function (chars) { if (W.treeBusy) { const t = $('#ai-progress'); if (t) t.textContent = 'Claude is reading\u2026'; return; } if (!W.busy) return; W.busy.text = 'Claude is writing… about ' + Math.round(chars / 6).toLocaleString('en-US') + ' words so far.'; const el = $('#ai-progress'); if (el) el.textContent = W.busy.text; };

  Object.assign(A.ACT, {
    'doc-start': () => { const r = C.rec(); startDoc(r.doc, r); A.render(); },
    'doc-ver': b => { const r = C.rec(); if (r) switchVersion(r.doc.id, +b.dataset.v); },
    'doc-copy': b => { const r = C.rec(); if (r) copyVersion(r.doc.id, +b.dataset.v); },
    'doc-rebuild-ok': () => rebuild(false),
    'doc-pdf': b => exportDoc('pdf', b), 'doc-pages': b => exportDoc('pages', b),
    'auto-del': b => { const n = b.closest('[data-auto]'); if (n) { n.remove(); changed(); } },
    'auto-after': b => { const n = b.closest('[data-auto]'); if (!n) return; const p = document.createElement('p'); p.appendChild(document.createElement('br')); n.after(p); caretIn(p); changed(); },
    'ai-q-clear': () => { const r = C.rec(); sync(); W.docs[r.doc.id].questions = []; saveDoc(r.doc.id, 0); A.render(); },
    'ai-draft': async () => {
      const r = C.rec(), c = r.doc; sync();
      try {
        const st = await Host.call('aiKeyStatus');
        if (!st || !st.set) { A.openModal('<h2>Add your Claude API key first</h2><p class="sub">Drafting uses your own Anthropic account. Add the key once in Settings; it is kept in this Mac’s keychain and never shown again.</p><div class="row end" style="margin-top:14px"><button class="btn" data-act="close-modal">Not now</button><button class="btn primary" data-act="ai-open-settings">Open Settings</button></div>', true); return; }
        const g = await gather(c, r); W.pending = g;
        const nP = g.photos.length, nN = g.notes.length, nT = g.sent.length - nP - nN, model = S.settings.aiModel || MODELS[0][0];
        S.modal = { type: 'ai' };
        A.openModal('<h2>Draft the report with Claude</h2><p class="sub">This sends the material below to Anthropic through your own account and returns a first draft of ' + plural(g.sections.length, 'section') + ', captions for photos that have none, and a typed copy of each field note page.</p>' +
          '<div class="body"><h3>What will be sent</h3><ul class="ref"><li>The case facts from the Overview tab, anything already written on the outline, and the figures from the Appraisal, Risk and Preservation tabs.</li>' +
          '<li>' + plural(nT, 'written file') + ' (notes, emails, PDFs you ticked as reviewed)' + (nT ? ': ' + esc(g.sent.slice(0, nT).join(', ')) : '') + '</li><li>' + plural(nP, 'photo') + (g.usedReportPhotos ? ' (the ones chosen on the Photos tab)' : nP ? ' (none are chosen on the Photos tab, so the first ' + nP + ' in the case; they will become the report’s photos)' : '') + '</li><li>' + plural(nN, 'field note page') + '</li></ul>' +
          (g.skipped.length ? '<h3>Not sent</h3><ul class="ref">' + g.skipped.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
          '<h3>What it will and will not do</h3><ul class="ref"><li>It writes only what this material supports, and leaves your observations and opinions as [bracketed gaps] with a list of questions.</li><li>It replaces the text on the outline and the current document. Your current version is kept, and “More” will offer to go back to it.</li><li>Captions and typed field notes you have already written are left alone.</li></ul>' +
          '<label class="f" style="margin-top:10px;max-width:420px"><span>Model</span><select data-ai-model>' + MODELS.map(m => '<option value="' + m[0] + '"' + (m[0] === model ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></label></div>' +
          '<p class="hint" style="margin-top:10px">If a court order or the attorney you work for limits who may see this material, check before you send it.</p>' +
          '<div class="row end" style="margin-top:12px"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="ai-send">Send and draft</button></div>');
      } catch (e) { toast('Could not get ready to draft: ' + (e.message || e)); }
    },
    'ai-send': () => runDraft(),
    'ai-open-settings': () => { A.closeModal(); A.go({ view: 'settings' }); },
    'ai-key-save': async () => { const el = $('[data-ai-key]'), v = (el.value || '').trim(); if (!v) return; try { await Host.call('aiKeySet', { key: v }); el.value = ''; toast('Key saved in the keychain'); A.render(); } catch (e) { toast('Could not save the key: ' + (e.message || e)); } },
    'ai-key-clear': async b => { if (!A.armed(b, 'Click again to remove')) return; try { await Host.call('aiKeyClear'); toast('Key removed'); A.render(); } catch (e) { toast('Could not remove the key'); } }
  });

  // ---------- reading the trees out of field notes and photos ----------
  const TREE_SCHEMA = { type: 'object', additionalProperties: false, required: ['trees', 'questions'], properties: {
    trees: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tag', 'species', 'diameter', 'condition', 'condition_guess', 'location_guess', 'rating_basis', 'notes', 'source', 'unsure'],
      properties: { tag: { type: 'string' }, species: { type: 'string' }, diameter: { type: 'string' }, condition: { type: 'string' }, condition_guess: { type: 'string' }, location_guess: { type: 'string' }, rating_basis: { type: 'string' }, notes: { type: 'string' }, source: { type: 'string' }, unsure: { type: 'boolean' } } } },
    pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['image', 'text'], properties: { image: { type: 'string' }, text: { type: 'string' } } } },
    visit_date: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } } } };
  TREE_SCHEMA.required.push('pages', 'visit_date');
  const TREE_SYSTEM = [
    'You are helping a consulting arborist move field data into a tree appraisal table. The arborist will check every cell against the original notes, so accuracy and honesty about doubt matter more than completeness.',
    'The field notes always arrive as photographs of handwritten pages, taken with a phone, sometimes at an angle, in shade, or with a thumb or clipboard in the frame. Reading them is the main job. Each image is labelled either "Field note page" (the arborist marked it as notes) or "Photo". A "Photo" may still be a photograph of a page of notes; treat any image that shows written notes as a field note page. Read every page in full before listing anything, because a heading, a column title or a remark on one page often explains the entries on another.',
    'Interpret the notes the way an arborist would. They are usually a rough table or list: a tree number, a species, a trunk diameter, sometimes a height, a condition, and remarks. Expect field shorthand: DBH or a bare number with an inch mark for trunk diameter; "circ" or "C" for circumference; "stump" or "@ grade" for a measurement at the cut; ditto marks or a vertical line meaning the same as the line above; a number written twice or joined by a plus sign, a slash or an ampersand for a tree with more than one stem; species initials such as LO, WO, SO, BC, LP. Spell out an abbreviation only when the rest of the notes or the photos make it certain, and say in notes what was actually written. When a number could be read two ways (a 1 or a 7, a 4 or a 9, 21 or 27), give your best reading, set unsure, and put both readings in questions.',
    'pages: for every image that shows notes, a faithful typed copy of the page: the label you were given for that image exactly as written (for example "Field note page 2" or "Photo 5") and the text, line for line, keeping the writer\u2019s numbers, units and abbreviations exactly, with [?] after anything doubtful and [illegible] where a word cannot be read. Do not tidy, reorder or correct it. visit_date: the date of the site visit if it is written on the notes, as YYYY-MM-DD; if the notes give a day and month without a year, take the year from the date the page was photographed; empty if no date is written.',
    'List each tree recorded in the field notes, one entry per tree, in the order recorded. Use only what is written in the notes or typed by the arborist. Photographs are there to help you tie a tree to its notes and to describe what is plainly visible; never estimate a trunk diameter or a height from a photograph.',
    'The arborist has asked for a first guess at the ratings, so that the appraisal can be worked out at once. They will review every one and replace it with their own, and each guess is shown to them marked as a guess. condition_guess: only when the notes give no condition rating, your best first estimate of the tree\u2019s condition as it stood before it was cut or damaged, as a percent from 0 to 100, digits only. Base it on what the notes say about health, structure and defects and on what the photographs plainly show (sound wood or decay on a stump face, cavities, dieback, lean, the crowns of similar trees still standing). When there is nothing to go on, give 70. Leave it empty when the notes give a rating. location_guess: your best first estimate of the location rating as a percent from 0 to 100, digits only: how well the site, the tree\u2019s contribution to the property and its placement served the property, judged from the setting the notes and photographs show. When there is nothing to go on, give 70. rating_basis: one short sentence saying what each guess rests on, or "No information; placeholder figures." when it rests on nothing. Do not present a guess as a finding anywhere else in your answer.',
    'tag: the tree number or label as written; empty if there is none. species: the common name as written, with an abbreviation spelled out only when it is unambiguous. diameter: the trunk diameter in inches as written, digits only, with several stems joined by a plus sign, as in 21+24; empty if it was not recorded. If a circumference or a stump diameter was recorded instead, give that number and say which it is in notes. condition: a percent from 0 to 100, digits only, and only if the notes give a condition rating; otherwise empty.',
    'notes: a short plain statement of what the notes record about the tree (defects, health, location, what was done to it), and, where a photograph can be tied to the tree by its caption or a visible tag, what that photograph plainly shows, as in "Photo 2 shows a flush cut at the base." source: where the entry came from, as in "field note page 2". unsure: true if any part of the entry rests on a doubtful reading of handwriting or on a guess about which tree a line refers to.',
    'questions: every doubtful reading and every gap the arborist should resolve, each naming the tree and the page. If the notes record no individual trees, return an empty list of trees and say so in questions.'
  ].join('\n\n');
  async function gatherTrees(c, r) {
    const files = C.filesOf(c), cx = ctxFor(c, r), content = [], sent = [], T = ['CASE: ' + (c.name || ''), 'The arborist’s own notes on the case: ' + (c.notes || 'none'), ''];
    for (const f of files.filter(x => x.kind === 'text' && (x.folder === 'Field notes' || x.folder === 'Notes') && x.size < 400000)) {
      try { const t = await Host.call('caseReadText', { path: r.path, rel: f.rel }); T.push('FILE: ' + f.rel, t.trim(), 'END OF FILE', ''); sent.push(f.rel); } catch (e) { }
    }
    const pages = files.filter(f => C.isNote(c, f)).slice(0, 12);
    // With no page marked as notes, every photo is sent large enough to read, and Claude is asked to find the note pages among them.
    const others = files.filter(f => f.kind === 'image' && f.folder !== 'Reports' && !C.isNote(c, f));
    const photos = (pages.length ? (cx.photos.length ? cx.photos.filter(f => pages.indexOf(f) < 0) : others).slice(0, 16) : others.slice(0, 12)), big = pages.length ? 1000 : 2000, more = pages.length ? 0 : Math.max(0, others.length - 12);
    const when = f => f.taken ? ' | photographed ' + f.taken.slice(0, 10) : '';
    content.push({ type: 'text', text: T.join('\n') });
    pages.forEach((f, i) => { const m = c.files[f.rel] || {}; content.push({ type: 'text', text: 'Field note page ' + (i + 1) + ' | file ' + f.name + when(f) + (String(m.transcript || '').trim() && m.transcriptBy !== 'draft' ? ' | typed copy on file (trust it over your own reading where the arborist typed it): ' + m.transcript.trim() : '') }, { type: 'case_image', rel: f.rel, max: 2000 }); sent.push(f.rel); });
    photos.forEach((f, i) => { const m = c.files[f.rel] || {}; content.push({ type: 'text', text: 'Photo ' + (i + 1) + ' | file ' + f.name + when(f) + (String(m.caption || '').trim() ? ' | caption: ' + m.caption.trim() : '') }, { type: 'case_image', rel: f.rel, max: big }); sent.push(f.rel); });
    content.push({ type: 'text', text: 'Read the field note pages and list the trees now, following your instructions.' });
    return { content: content, sent: sent, pages: pages, photos: photos, more: more, texts: sent.length - pages.length - photos.length };
  }
  function addReadTrees(c, target, out, meta) {
    let a = S.appraisals[target];
    if (!a) { a = A.blankAppraisal(c.name || '', target === 'new10' ? '10' : '9'); a.client = (c.to && c.to.name) || ''; S.appraisals[a.id] = a; S.apHome[a.id] = c.id; }
    (out.trees || []).forEach(x => {
      const t = A.newTree(a), name = String(x.species || '').trim(); t.sp = '';
      if (name) { const sp = A.speciesByName(a, name) || A.addSpecies(a, name); t.sp = sp.id; }
      t.tag = String(x.tag || '').trim(); t.size = String(x.diameter || '').trim(); t.cond = A.E.num(x.condition);
      // First guesses at the ratings the notes do not give. They are flagged, shaded on the Trees tab and listed in the checks until the arborist edits or keeps them.
      const pctOf = v => { const n = A.E.num(v); return n !== null && n >= 0 && n <= 100 ? n : null; }, cg = pctOf(x.condition_guess), lg = pctOf(x.location_guess);
      if (t.cond === null && cg !== null) { t.cond = cg; (t.guess = t.guess || {}).cond = true; }
      if (lg !== null) { t.loc = lg; (t.guess = t.guess || {}).loc = true; }
      t.note = [String(x.notes || '').trim(), x.source ? '(' + String(x.source).trim() + ')' : '', t.guess && String(x.rating_basis || '').trim() ? 'Ratings guessed: ' + String(x.rating_basis).trim() : '', x.unsure ? 'CHECK AGAINST THE NOTES' : ''].filter(Boolean).join(' ');
      t.read = true; a.trees.push(t);
    });
    a.readFrom = { at: Date.now(), model: meta.model, questions: out.questions || [], count: (out.trees || []).length };
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(out.visit_date || '')) ? out.visit_date : '';
    if (iso && !String(a.inspected || '').trim()) a.inspected = iso;
    A.save('appraisals', a.id, 0);
    return a;
  }
  // Keeps what was read off the pages: the typed copy of each page, which photos turned out to be notes, and the date on them.
  function keepPages(c, g, out) {
    const k = { typed: 0, found: 0, date: '', setVisit: false };
    (out.pages || []).forEach(p => {
      const m = /^\s*(field note page|photo)\s+(\d+)/i.exec(String(p.image || '')); if (!m || !String(p.text || '').trim()) return;
      const isPage = /^field/i.test(m[1]), f = (isPage ? g.pages : g.photos)[+m[2] - 1]; if (!f) return;
      const fm = C.meta(c, f.rel);
      if (!isPage) { fm.fieldNote = true; c.photos = (c.photos || []).filter(x => x !== f.rel); k.found++; }
      if (!String(fm.transcript || '').trim() || fm.transcriptBy === 'draft') { fm.transcript = String(p.text).trim(); fm.transcriptBy = 'draft'; k.typed++; }
    });
    // The visit date follows the site photos (the day most of them were taken). A date written on the notes is used only when no photo carries one.
    const written = /^\d{4}-\d{2}-\d{2}$/.test(String(out.visit_date || '')) ? out.visit_date : '', pv = C.visitFromPhotos(c);
    if (pv) { C.syncVisit(c); k.date = pv.date; k.from = 'photos'; k.basis = pv.n + ' of ' + pv.total; if (written && written !== pv.date) k.conflict = written; }
    else if (written) { k.date = written; k.from = 'notes'; if (!String(c.visits || '').trim()) { c.visits = A.R.longDate(written); c.visitsFrom = 'notes'; k.setVisit = true; } }
    out.visit_date = k.date || '';
    return k;
  }
  async function runTrees() {
    const r = C.rec(), c = r.doc, g = W.pendingTrees; if (!g) return; W.pendingTrees = null;
    const target = ($('[data-ai-target]') || {}).value || 'new9', model = S.settings.aiModel || MODELS[0][0];
    W.treeBusy = true;
    A.openModal('<h2>Reading the field notes</h2><p class="sub" id="ai-progress">Sending the field notes and photos…</p><p class="hint" style="margin-top:8px">This usually takes under a minute.</p>', true);
    try {
      const res = await Host.call('ai', { path: r.path, model: model, effort: 'high', maxTokens: 32000, system: TREE_SYSTEM, content: g.content, schema: TREE_SCHEMA });
      if (res.stop === 'refusal') throw new Error('Anthropic’s safety filter declined this request' + (res.detail ? ' (category: ' + res.detail + ')' : '') + '. Try again, or pick a different model.');
      if (res.stop === 'max_tokens') throw new Error('The list ran past the length limit and was cut off. Nothing was added.');
      let out; try { out = JSON.parse(res.text); } catch (e) { try { out = JSON.parse(res.tail); } catch (e2) { out = null; } }
      if (!out || !Array.isArray(out.trees)) throw new Error('The answer came back in a form the app could not read. Try again.');
      W.treeBusy = false;
      if (!out.trees.length) { A.openModal('<h2>No trees found</h2><p class="sub">Nothing in the field notes could be read as a list of trees.</p>' + ((out.questions || []).length ? '<ul class="ref">' + out.questions.map(q => '<li>' + esc(q) + '</li>').join('') + '</ul>' : '') + '<div class="row end" style="margin-top:14px"><button class="btn primary" data-act="close-modal">Close</button></div>', true); return; }
      const kept = keepPages(c, g, out);
      const a = addReadTrees(c, target, out, { model: res.model || model }), doubt = out.trees.filter(t => t.unsure).length, q = out.questions || [];
      A.save('cases', c.id, 0); A.render();
      A.openModal('<h2>' + plural(out.trees.length, 'tree') + ' added to the appraisal</h2><p class="sub">Species, trunk diameters and any condition ratings written in the notes are now in the Trees table, where every cell can be changed. Ratings the notes do not give were guessed so that values appear at once; they are shaded until you type over them or keep them, and the Method options tab shows each way the trees can be valued. ' + (doubt ? plural(doubt, 'tree') + (doubt === 1 ? ' rests on a doubtful reading and says' : ' rest on a doubtful reading and say') + ' CHECK AGAINST THE NOTES in the Note column.' : '') + '</p>' +
        '<p class="hint" style="margin-top:8px">' + (kept.typed ? plural(kept.typed, 'page') + ' of notes typed up; the typed copy is beside each page on the Photos tab. ' : '') + (kept.found ? plural(kept.found, 'photo') + ' turned out to be field notes and ' + (kept.found === 1 ? 'is' : 'are') + ' now filed as such. ' : '') + (kept.from === 'photos' ? 'Site visit date from the photos: ' + esc(A.R.longDate(kept.date)) + ' (' + kept.basis + ' dated site photos).' + (kept.conflict ? ' The notes are dated ' + esc(A.R.longDate(kept.conflict)) + '; the date follows the photos, so check which is right.' : '')
          : kept.date ? 'No site photo carries a date, so the date written on the notes was used: ' + esc(A.R.longDate(kept.date)) + '.' : '') + '</p>' +
        '<div class="body">' + (q.length ? '<h3>Questions to settle</h3><ul class="ref">' + q.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
        '<h3>Still yours to enter</h3><ul class="ref"><li>Ratings the notes did not give. Nothing was estimated from a photograph.</li><li>Replacement tree prices for each species, on the Species and costs tab.</li></ul></div>' +
        '<div class="row end" style="margin-top:14px"><button class="btn" data-act="close-modal">Stay here</button><button class="btn primary" data-act="ai-trees-open" data-id="' + a.id + '">Open the appraisal</button></div>');
    } catch (e) { W.treeBusy = false; A.openModal('<h2>The trees were not read</h2><p class="sub">' + esc(e.message || String(e)) + '</p><p class="hint" style="margin-top:8px">Nothing in the case was changed.</p><div class="row end" style="margin-top:14px"><button class="btn primary" data-act="close-modal">Close</button></div>', true); }
  }
  const apTab0 = C.TAB.appraisal;
  C.TAB.appraisal = function (c, r) {
    return '<div class="card"><h2>Fill the tree table from field notes</h2><div class="row"><button class="btn" data-act="ai-trees">Read the trees from field notes and photos…</button><span class="hint">Photograph your handwritten field notes and add the pictures to the case. Claude reads the pages, types them up, and puts each tree with its species, trunk diameter and any condition rating you wrote down into an appraisal table for you to check and change.</span></div></div>' + apTab0(c, r);
  };
  Object.assign(A.ACT, {
    'ai-trees': async () => {
      const r = C.rec(), c = r.doc;
      try {
        const st = await Host.call('aiKeyStatus');
        if (!st || !st.set) { A.openModal('<h2>Add your Claude API key first</h2><p class="sub">Reading field notes uses your own Anthropic account. Add the key once in Settings; it is kept in this Mac’s keychain.</p><div class="row end" style="margin-top:14px"><button class="btn" data-act="close-modal">Not now</button><button class="btn primary" data-act="ai-open-settings">Open Settings</button></div>', true); return; }
        const g = await gatherTrees(c, r); W.pendingTrees = g;
        if (!g.pages.length && !g.photos.length && !g.texts) { W.pendingTrees = null; A.openModal('<h2>No field notes in this case yet</h2><p class="sub">Photograph your field notes and add the pictures to the case with “Add field note photos” on the Photos tab, then try again.</p><div class="row end" style="margin-top:14px"><button class="btn primary" data-act="close-modal">Close</button></div>', true); return; }
        const list = C.caseAppraisals(c), model = S.settings.aiModel || MODELS[0][0];
        A.openModal('<h2>Read the trees from field notes and photos</h2><p class="sub">This sends the material below to Anthropic through your own account and returns a list of the trees recorded in it.</p>' +
          '<div class="body"><h3>What will be sent</h3><ul class="ref">' + (g.pages.length ? '<li>' + plural(g.pages.length, 'photographed page') + ' of field notes, at full reading size</li><li>' + plural(g.photos.length, 'other photo') + (g.photos.length ? ', to tie trees to the notes' : '') + '</li>'
            : '<li>' + plural(g.photos.length, 'photo') + '. None is marked as a field note page, so ' + (g.more ? 'the first ' + g.photos.length + ' of ' + (g.photos.length + g.more) + ' are' : 'all of them are') + ' sent at reading size and Claude picks out the pages of notes.'  + ' Marking the pages first (Photos tab, “This is a field note page”) sends less and reads better.</li>') + (g.texts ? '<li>' + plural(g.texts, 'typed note') + '</li>' : '') + '</ul>' +
          '<h3>What it will and will not do</h3><ul class="ref"><li>It reads your handwriting, types up each page, and copies what the notes record into the table: tree number, species, trunk diameter, condition rating and remarks.</li><li>The site visit date is taken from the photos (the day most of them were taken), not from the handwriting.</li><li>It never estimates a trunk diameter from a photograph. Where the notes give no condition or location rating, it makes a first guess from the notes and photos and shades it, for you to replace.</li><li>Doubtful handwriting is marked for you to check. Every cell stays editable.</li></ul>' +
          '<label class="f" style="margin-top:10px;max-width:420px"><span>Put the trees in</span><select data-ai-target><option value="new9">A new appraisal (9th edition)</option><option value="new10">A new appraisal (10th edition)</option>' + list.map(a => '<option value="' + a.id + '">' + esc(A.R.title(a)) + ' (add to its ' + plural(a.trees.length, 'tree') + ')</option>').join('') + '</select></label>' +
          '<label class="f" style="margin-top:10px;max-width:420px"><span>Model</span><select data-ai-model>' + MODELS.map(m => '<option value="' + m[0] + '"' + (m[0] === model ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></label></div>' +
          '<p class="hint" style="margin-top:10px">If a court order or the attorney you work for limits who may see this material, check before you send it.</p>' +
          '<div class="row end" style="margin-top:12px"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="ai-trees-send">Send and read</button></div>');
      } catch (e) { toast('Could not get ready: ' + (e.message || e)); }
    },
    'ai-trees-send': () => runTrees(),
    'ai-trees-open': b => { A.closeModal(); A.go({ view: 'appraisal', id: b.dataset.id, tab: 'trees' }); }
  });

  // Settings: the API key and the model.
  const prevSettings = A.settingsExtra;
  A.settingsExtra = function () {
    const model = S.settings.aiModel || MODELS[0][0];
    setTimeout(() => Host.call('aiKeyStatus').then(st => { const el = $('#ai-key-state'); if (el) el.textContent = st && st.set ? (st.mock ? 'Preview mode: drafts are made up, nothing is sent.' : 'A key is saved in this Mac’s keychain.') : 'No key saved yet.'; }, () => { }), 0);
    return (prevSettings ? prevSettings() : '') + '<div class="card"><h2>Drafting with Claude</h2><p class="sub">Drafting a report from a case uses your own Anthropic API key. The key is kept in this Mac’s keychain, not in the app’s files, and is only ever sent to Anthropic.</p>' +
      '<p class="hint" id="ai-key-state" style="margin-top:8px">Checking…</p><div class="row" style="margin-top:8px"><input class="in" type="password" data-ai-key placeholder="Paste your API key" autocomplete="off" style="max-width:420px" aria-label="Claude API key"><button class="btn small primary" data-act="ai-key-save">Save key</button><button class="btn small danger" data-act="ai-key-clear">Remove key</button></div>' +
      '<label class="f" style="margin-top:12px;max-width:420px"><span>Model for drafting</span><select data-ai-model>' + MODELS.map(m => '<option value="' + m[0] + '"' + (m[0] === model ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></label></div>';
  };

  // Quitting the app waits for the document and any open note to be written.
  if (window.__app) { const f0 = window.__app.flush; window.__app.flush = () => Promise.all([f0(), flushDocs(), C.flushNote()]); }
  window.addEventListener('beforeunload', flushDocs);

  // Used by the Mac app's self-test: writes a report for the test case, saves it, and exports it both ways.
  window.__writeSelfTest = async function (caseId) {
    const out = {}, r = S.cases[caseId], c = r.doc;
    S.route = { view: 'case', id: caseId, tab: 'report' }; W.state[caseId] = 'ready'; W.docs[caseId] = null; A.render();
    out.startPanel = !!$('[data-act=ai-draft]') && !!$('[data-act=doc-start]');
    startDoc(c, r); A.render();
    const ed = $('#ed'); if (!ed) { out.editor = false; return out; }
    out.editor = true; out.blocks = ed.children.length; out.autos = Array.from(ed.querySelectorAll('[data-auto]')).map(n => n.getAttribute('data-auto').split(':')[0]).join(',');
    const p = document.createElement('p'); p.innerHTML = 'Self test sentence with <b>bold</b> in it. (Photo 1)'; ed.insertBefore(p, ed.querySelector('h2').nextSibling); changed(); await flushDocs();
    const saved = await Host.call('caseGet', { path: r.path, name: 'report' });
    out.saved = !!saved && saved.html.indexOf('Self test sentence with <b>bold</b> in it.') > 0 && !/contenteditable|class=|<img/.test(saved.html);
    const cx = ctxFor(c, r), html = W.docs[caseId].html;
    out.checks = CR.checks(c, cx, html).length;
    const pdf = await Host.call('exportPDF', { path: r.path, name: 'Self test report.pdf', html: await CR.printable(c, cx, html), title: c.name, logo: S.settings.logo || null });
    out.pdfPages = pdf.pages; out.pdfPlanned = pdf.planned; out.pdfPath = pdf.path;
    const built = await CR.build(c, cx, html); out.docxBytes = built.bytes.length; out.docxBlocks = built.blocks;
    out.keySet = (await Host.call('aiKeyStatus')).set;
    const g = await gather(c, r); out.gather = g.content.map(b => b.type).join(',').replace(/(text,)+/g, 'text,').replace(/,$/, ''); out.gatherSent = g.sent.length; out.gatherSections = g.sections.length;
    applyDraft(c, r, g, { letter: 'Self test letter.', sections: g.sections.map(x => ({ id: x.id, text: 'Drafted ' + x.title + '. [your opinion]' })), captions: [], field_notes: [], questions: ['Self test question?'] }, { at: Date.now(), model: 'claude-opus-5-5' });
    A.render(); await flushDocs(); await A.flush();
    const text = () => ($('#ed') || {}).textContent || '';
    out.draftApplied = /Drafted /.test(text()) && /Self test letter\./.test(text()) && !/Self test sentence/.test(text()) && /Self test question/.test(($('.edside') || {}).textContent || '');
    restore(); await flushDocs(); out.wentBack = /Self test sentence/.test(text()) && !/Drafted /.test(text());
    restore(); await flushDocs(); out.andForward = /Drafted /.test(text()) && !/Self test sentence/.test(text());
    rebuild(false); await flushDocs(); out.rebuilt = /Drafted /.test(text()) && /Self test sentence/.test(W.docs[caseId].previous || '') === false && !!W.docs[caseId].previous;
    const onDisk = await Host.call('caseGet', { path: r.path, name: 'report' }); out.diskMatches = !!onDisk && onDisk.html === W.docs[caseId].html && onDisk.html === serialize($('#ed'));
    // versions: Version 2 starts empty, can start as a copy of Version 1, is saved in its own file, and leaves Version 1 alone
    const ready = () => new Promise(res => { let n = 0; const t = setInterval(() => { if (W.state[caseId] === 'ready' || ++n > 250) { clearInterval(t); res(); } }, 20); });
    const v1 = W.docs[caseId].html; await switchVersion(caseId, 2); await ready();
    out.versionEmpty = verOf(caseId) === 2 && !W.docs[caseId] && !!$('[data-act=doc-copy][data-v="1"]');
    await copyVersion(caseId, 1); await flushDocs();
    const v2disk = await Host.call('caseGet', { path: r.path, name: 'report-v2' }), v1disk = await Host.call('caseGet', { path: r.path, name: 'report' });
    out.versionCopied = !!v2disk && v2disk.html === v1 && !!v1disk && v1disk.html === v1 && !!$('#ed');
    await switchVersion(caseId, 1); await ready(); A.render();
    out.versionBack = verOf(caseId) === 1 && !!W.docs[caseId] && W.docs[caseId].html === v1 && /Version 2/.test(($('[data-act=doc-ver][data-v="2"]') || {}).textContent || '') && !/empty/.test(($('[data-act=doc-ver][data-v="2"]') || {}).textContent || '');
    // field notes arrive as photographs: an unmarked photo that turns out to be a page of notes is filed as one, typed up, and read into the table
    const gt = await gatherTrees(c, r); out.treeGather = gt.pages.length + ' pages, ' + gt.photos.length + ' photos at ' + gt.content.filter(b => b.type === 'case_image').map(b => b.max).join(',');
    // the visit date is the day most of the site photos were taken; a page of notes photographed later does not count
    const fs = C.filesOf(c).filter(f => f.kind === 'image'); fs[0].taken = '2026-10-29T09:10:00'; fs[1].taken = '2026-11-04T18:00:00'; fs[2].taken = '2026-10-29T09:42:00';
    c.visits = ''; c.visitsFrom = ''; C.syncVisit(c); const pv = C.visitFromPhotos(c);
    out.visitFromPhotos = c.visits === 'October 29, 2026' && c.visitsFrom === 'photos' && pv.n === 2 && pv.total === 3 && pv.others[0].date === '2026-11-04';
    const f2 = gt.photos[1], kp = keepPages(c, gt, { pages: [{ image: 'Photo 2', text: '1  LO  30"' }], visit_date: '2026-11-04' });
    out.visitAfterNotes = c.visits === 'October 29, 2026' && kp.from === 'photos' && kp.conflict === '2026-11-04' && C.visitFromPhotos(c).total === 2;
    c.visits = 'October 30, 2026'; c.visitsFrom = ''; C.syncVisit(c); out.typedDateKept = c.visits === 'October 30, 2026'; c.visits = ''; C.syncVisit(c);
    out.notesKept = kp.found === 1 && kp.typed === 1 && C.isNote(c, f2) && c.photos.indexOf(f2.rel) < 0 && C.meta(c, f2.rel).transcript === '1  LO  30"';
    const a2 = addReadTrees(c, 'new9', { trees: [{ tag: '1', species: 'Live oak', diameter: '30', condition: '', notes: 'Written as LO.', source: 'Photo 2', unsure: true }], questions: [], visit_date: kp.date }, { model: 'test' });
    const a3 = addReadTrees(c, 'new9', { trees: [{ tag: '7', species: 'Live oak', diameter: '24', condition: '', condition_guess: '60', location_guess: '80', rating_basis: 'Sound stump face in Photo 1.', notes: 'Cut.', source: 'Photo 2', unsure: false },
      { tag: '8', species: 'Live oak', diameter: '20', condition: '85', condition_guess: '40', location_guess: '', rating_basis: '', notes: '', source: 'Photo 2', unsure: false }], questions: [], visit_date: '' }, { model: 'test' });
    out.ratingsGuessed = a3.trees[0].cond === 60 && a3.trees[0].loc === 80 && a3.trees[0].guess.cond === true && a3.trees[0].guess.loc === true && /Ratings guessed: Sound stump face/.test(a3.trees[0].note) && a3.trees[1].cond === 85 && !a3.trees[1].guess && A.guesses(a3).trees === 1;
    out.firstAppraisalWorksOut = a3.species[0].repl.length > 1 && A.E.calcAppraisal(a3).done === 2 && A.E.options(a3, a3.species[0].id).list.length > 4 && A.R.checks(a3, A.E.calcAppraisal(a3)).some(x => /guess/.test(x.text));
    out.treesAdded = a2.trees.length === 1 && a2.trees[0].size === '30' && a2.trees[0].cond === null && a2.inspected === '2026-10-29' && /CHECK AGAINST THE NOTES/.test(a2.trees[0].note) && S.apHome[a2.id] === caseId;
    const gt2 = await gatherTrees(c, r); out.treeGather2 = gt2.pages.length + ' pages, ' + gt2.photos.length + ' photos at ' + gt2.content.filter(b => b.type === 'case_image').map(b => b.max).join(',');
    await A.flush();
    return out;
  };

  window.WriteUI = { W: W, docName: docName, verOf: verOf, switchVersion: switchVersion, copyVersion: copyVersion, dropPage: dropPage, saveDoc: saveDoc, keepPages: keepPages, gatherTrees: gatherTrees, addReadTrees: addReadTrees, TREE_SYSTEM: TREE_SYSTEM, TREE_SCHEMA: TREE_SCHEMA, flushDocs: flushDocs, docSections: docSections, SYSTEM: SYSTEM, SCHEMA: SCHEMA, gather: gather, applyDraft: applyDraft, serialize: serialize, clean: clean, ctxFor: ctxFor, startDoc: startDoc, sync: sync };
})();
