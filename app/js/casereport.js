/* Expert Report: the report as a document.
 * The report the arborist writes is a flat run of headings, paragraphs and lists, with "auto" blocks standing in for
 * things that come from the rest of the case (cover, materials list, appraisal tables, risk tables, protection zones,
 * recommendations, signatures, photo pages, appraisal worksheet). Auto blocks are filled in fresh each time the report is
 * shown or exported, so they never go stale. The same description feeds the page on screen, the PDF and the Pages export. */
(function (root) {
  'use strict';
  var E = root.Engine, R = root.Report;

  function people(c, st) { var out = []; (c.authors || []).forEach(function (id) { ((st && st.people) || []).forEach(function (p) { if (p.id === id) out.push(p); }); }); return out; }
  function names(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }
  function pron(text, many) { return String(text).replace(/\{I\}/g, many ? 'We' : 'I').replace(/\{i\}/g, many ? 'we' : 'I').replace(/\{My\}/g, many ? 'Our' : 'My').replace(/\{my\}/g, many ? 'our' : 'my').replace(/\{me\}/g, many ? 'us' : 'me'); }
  function lines(text) { return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // Typed text becomes paragraphs; a run of lines starting with a hyphen becomes a bulleted list.
  function paras(text) {
    var out = [], bullets = [];
    function flush() { if (bullets.length) { out.push({ t: 'bullets', items: bullets }); bullets = []; } }
    lines(text).forEach(function (l) { var m = /^[-•–]\s+(.*)$/.exec(l); if (m) bullets.push(m[1]); else { flush(); out.push({ t: 'p', text: l }); } });
    flush(); return out;
  }
  function tbl(t, heading, blocks) { t.t = 'table'; if (t.rows.length > 22) t.caption = heading; else if (heading) blocks.push({ t: 'p', text: heading, bold: true, keep: true, after: 80 }); blocks.push(t); }
  function materials(c, files) {
    var out = [];
    (files || []).forEach(function (f) { var m = (c.files || {})[f.rel]; if (m && m.reviewed) out.push((m.desc && String(m.desc).trim()) || f.name.replace(/\.[A-Za-z0-9]+$/, '')); });
    return out.concat(lines(c.otherMaterials));
  }
  // Photo numbers mentioned in text, e.g. "(Photo 3)", "Photos 5-8", "Photos 2, 4".
  function photoRefs(text) {
    var out = {}, re = /Photos?\s+((?:\d+\s*(?:[-–,&]|and|to)?\s*)+)/gi, m;
    while ((m = re.exec(text))) {
      var part = m[1], r = /(\d+)\s*(?:[-–]|to)\s*(\d+)/g, x;
      while ((x = r.exec(part))) { for (var i = +x[1]; i <= +x[2] && i - +x[1] < 200; i++) out[i] = 1; }
      (part.match(/\d+/g) || []).forEach(function (n) { out[+n] = 1; });
    }
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
  }

  // ---------- auto blocks: what each one contributes, as generic blocks ----------
  var AUTO = { cover: 'Cover page, from the Overview tab', 'break': 'Page break', materials: 'Materials reviewed, from the Files tab', risk: 'Risk tables, from the Risk tab', zones: 'Protection zones, from the Preservation tab',
    recs: 'Recommendations, from the Preservation tab', signatures: 'Signature lines, from the Overview tab and Settings', photos: 'Photo pages, from the Photos tab', appendix: 'Appraisal worksheet, from the Appraisal tab' };
  function autoLabel(key, ctx) {
    if (key.indexOf('appraisal:') === 0) { var a = (ctx.appraisals || []).filter(function (x) { return x.id === key.slice(10); })[0]; return 'Appraisal table' + (a ? ': ' + R.title(a) : ' (appraisal not found)') + ', from the Appraisal tab'; }
    if (key.indexOf('compare:') === 0) { var a2 = (ctx.appraisals || []).filter(function (x) { return x.id === key.slice(8); })[0]; return 'Comparison of editions and methods' + (a2 ? ': ' + R.title(a2) : ' (appraisal not found)') + ', from the Appraisal tab'; }
    return AUTO[key] || key;
  }
  function auto(c, ctx, key) {
    var st = ctx.settings || {}, who = people(c, st), many = who.length > 1, b = [], aps = ctx.appraisals || [], K = root.Risk, k;
    if (key === 'break') return [{ t: 'break' }];
    if (key === 'cover') {
      b.push({ t: 'space', after: 700 }, { t: 'title', text: c.reportTitle || c.name || 'Report' }, { t: 'space', after: 160 }, { t: 'center', text: 'Submitted to:', size: 13 });
      [(c.to && c.to.name) || ''].concat(lines(c.to && c.to.address)).filter(Boolean).forEach(function (l) { b.push({ t: 'center', text: l, size: 13 }); });
      b.push({ t: 'space', after: 260 }, { t: 'center', text: 'Submitted by:', size: 13 });
      if (who.length) b.push({ t: 'center', text: names(who.map(function (p) { return p.name; })) + ', Consulting Arborist' + (many ? 's' : ''), size: 13 });
      [st.companyName || ''].concat(lines(st.companyAddress)).filter(Boolean).forEach(function (l) { b.push({ t: 'center', text: l, size: 13 }); });
      b.push({ t: 'space', after: 300 }, { t: 'left', text: 'Report date:', size: 9, after: 60 }, { t: 'left', text: R.longDate(c.reportDate) || '', size: 9 });
    } else if (key === 'materials') {
      materials(c, ctx.files).forEach(function (m, i) { b.push({ t: 'p', text: (i + 1) + '. ' + m, after: 60 }); });
    } else if (key.indexOf('appraisal:') === 0) {
      var a = aps.filter(function (x) { return x.id === key.slice(10); })[0];
      if (a) { var A = E.calcAppraisal(a); tbl(R.summary(a, A), '', b); var cl = R.costLines(a, A); if (cl.rows.length) { tbl(cl, '', b); b.push({ t: 'p', text: 'Total of trees and other costs: ' + E.money(A.total), bold: true }); } }
    } else if (key.indexOf('compare:') === 0) {
      var ac = aps.filter(function (x) { return x.id === key.slice(8); })[0];
      if (ac && E.compareKeys(ac).length) { var ct = R.compare(ac); tbl(ct, ct.rows.length > 22 ? 'Appraised value under each edition and method' : '', b); b.push({ t: 'small', text: R.compareNote(ct) }); }
    } else if (key === 'risk') {
      k = c.risk || {}; var meta = [];
      if (k.level) meta.push(k.level); if (k.date) meta.push('Date: ' + k.date); if (k.timeframe) meta.push('Time frame: ' + k.timeframe);
      if (meta.length) b.push({ t: 'p', text: meta.join('. ') + '.' });
      paras(k.scope).forEach(function (x) { b.push(x); });
      if ((k.trees || []).length > 1) tbl(K.summary(k), '', b);
      (k.trees || []).forEach(function (t, i) {
        b.push({ t: 'p', text: 'Tree ' + K.label(t, i) + (t.species ? ': ' + t.species : '') + (t.dbh ? ', ' + t.dbh + ' in diameter' : '') + (t.height ? ', ' + t.height + ' ft tall' : ''), bold: true, keep: true, after: 80 });
        if (t.location) b.push({ t: 'p', text: t.location });
        var tb = K.table(t); if (tb.rows.length) tbl(tb, '', b);
        var c2 = K.calcTree(t), tail = [];
        if (c2.overall) tail.push('Overall risk rating: ' + c2.overall.toLowerCase() + '.');
        if (t.residual) tail.push('Residual risk after mitigation: ' + t.residual.toLowerCase() + '.');
        if (t.interval) tail.push('Next inspection: ' + t.interval + '.');
        if (tail.length) b.push({ t: 'p', text: tail.join(' ') });
        if (String(t.mitigation || '').trim()) { b.push({ t: 'p', text: 'Mitigation options:', keep: true, after: 60 }); paras(t.mitigation).forEach(function (x) { b.push(x); }); }
        paras(t.notes).forEach(function (x) { b.push(x); });
      });
    } else if ((key === 'zones' || key === 'recs') && root.Zones && root.Zones.reportBlocks) {
      root.Zones.reportBlocks(c.preserve, key === 'recs' ? 'recommendations' : 'zones', b, tbl, paras);
    } else if (key === 'signatures') {
      who.forEach(function (p) { b.push({ t: 'sig', text: p.name + (p.credential ? ', ' + p.credential : ''), key: 'sig:' + p.id }); });
    } else if (key === 'photos') {
      var photos = ctx.photos || [];
      if (photos.length) b.push({ t: 'left', text: 'PHOTOS', after: 120 });
      photos.forEach(function (f, i) {
        var m = (c.files || {})[f.rel] || {};
        if (i) b.push({ t: 'break' });
        b.push({ t: 'image', key: 'ph:' + i, rel: f.rel, maxW: 6.5, maxH: 6.0 }, { t: 'p', text: 'Photo ' + (i + 1) + ': ' + (String(m.caption || '').trim() || '[caption]') });
      });
    } else if (key === 'appendix') {
      if (aps.length) b.push({ t: 'left', text: 'APPRAISAL WORKSHEET', after: 160 });
      aps.forEach(function (a2) {
        var A2 = E.calcAppraisal(a2), ed = E.edition(a2);
        if (aps.length > 1) b.push({ t: 'p', text: R.title(a2), bold: true, keep: true, after: 80 });
        tbl(R.basis(a2, A2), 'Basis of costs' + (ed === '9' ? ' and species ratings' : ''), b);
        var ld = R.ladder(a2); if (ld) tbl(ld, 'Replacement tree prices', b);
        var d = R.detail(a2, A2); d.after = 60; tbl(d, 'Appraisal worksheet', b);
        b.push({ t: 'small', text: R.legend(a2, A2) }, { t: 'p', text: 'Method', bold: true, keep: true, after: 80 });
        (a2.methodText && String(a2.methodText).trim() ? String(a2.methodText).split(/\n\s*\n/) : R.methodText(a2, A2, ctx)).forEach(function (p) { b.push({ t: 'p', text: p.trim() }); });
        b.push({ t: 'p', text: 'Sources', bold: true, keep: true, after: 80 }, { t: 'bullets', items: R.sources(a2, ctx) });
        // Every edition and method ticked for comparison gets its own worksheet, with all of its figures.
        var cmp = E.compare(a2);
        cmp.keys.forEach(function (k) {
          var v = cmp.by[k], dv = R.detail(v.a, v.A); dv.after = 60;
          tbl(dv, 'Worksheet: ' + E.approach(k).name, b);
          b.push({ t: 'small', text: R.legend(v.a, v.A) });
        });
      });
    }
    return b;
  }

  // ---------- blocks to HTML, for the page on screen and for the PDF ----------
  // o.images: { key: dataURL } for export. o.thumbs: true to leave <img data-thumb> for the screen to fill in.
  function html(blocks, o) {
    o = o || {};
    return blocks.map(function (b) {
      switch (b.t) {
        case 'title': return '<p class="r-title">' + esc(b.text) + '</p>';
        case 'center': return '<p class="r-center"' + (b.size ? ' style="font-size:' + b.size + 'pt"' : '') + '>' + esc(b.text) + '</p>';
        case 'left': return '<p class="r-left"' + (b.size ? ' style="font-size:' + b.size + 'pt"' : '') + '>' + esc(b.text) + '</p>';
        case 'h': return '<h2>' + esc(b.text) + '</h2>';
        case 'p': return '<p' + (b.keep ? ' class="r-keep"' : '') + '>' + (b.bold ? '<b>' + esc(b.text) + '</b>' : esc(b.text)) + '</p>';
        case 'small': return '<p class="r-small">' + esc(b.text) + '</p>';
        case 'bullets': return '<ul>' + b.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
        case 'table': return (b.caption ? '<p class="r-keep"><b>' + esc(b.caption) + '</b></p>' : '') + '<div class="r-table">' + R.tableHTML(b, true) + '</div>';
        case 'break': return '<div class="pb"></div>';
        case 'space': return '<div style="height:' + Math.round((b.after || 120) / 20) + 'pt"></div>';
        case 'image': var src = o.images && o.images[b.key]; return '<p class="r-img">' + (src ? '<img src="' + src + '" style="max-width:' + (b.maxW || 6.5) + 'in;max-height:' + (b.maxH || 6) + 'in">' : o.thumbs && b.rel ? '<img data-thumb="' + esc(b.rel) + '" alt="" style="max-height:2.6in">' : '') + '</p>';
        case 'sig': var s = o.images && o.images[b.key]; return '<p class="r-keep r-sig">' + esc(b.text) + '</p>' + (s ? '<p class="r-sigimg"><img src="' + s + '" style="max-height:0.45in;max-width:2.4in"></p>' : '<div style="height:22pt"></div>');
        default: return '';
      }
    }).join('');
  }

  // ---------- the starting document, built from the case ----------
  function ptext(t) { return '<p>' + (t ? esc(t) : '<br>') + '</p>'; }
  function typed(text) { return paras(text).map(function (b) { return b.t === 'bullets' ? '<ul>' + b.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : ptext(b.text); }).join(''); }
  function au(key) { return '<div data-auto="' + esc(key) + '"></div>'; }
  function outline(c, ctx) {
    var st = ctx.settings || {}, who = people(c, st), many = who.length > 1, aps = ctx.appraisals || [], h = [au('cover'), au('break')];
    [(c.to && c.to.name) || ''].concat(lines(c.to && c.to.address)).filter(Boolean).forEach(function (l) { h.push(ptext(l)); });
    h.push(ptext(''), ptext('Dear ' + ((c.to && (c.to.salutation || c.to.name)) || '') + ','), typed(c.letter), ptext('Respectfully submitted,'), ptext(''));
    who.forEach(function (p) { h.push(ptext(p.name), ptext('')); });
    h.push(au('break'));
    (c.sections || []).filter(function (s) { return s.on; }).forEach(function (s) {
      h.push('<h2>' + esc(s.title || 'Section') + '</h2>');
      var text = String(s.text || '').trim();
      if (s.key === 'qualifications' && !text) who.forEach(function (p) { if (p.qual) h.push(ptext(p.qual)); });
      else if (s.key === 'certification') {
        var cert = lines(st.certLines).map(function (l) { return pron(l, many); });
        if (aps.length) cert.push(pron('{I} reserve the right to adjust this appraisal value based upon any new information {i} receive regarding this matter.', many));
        who.forEach(function (p) { if (p.cert) cert.push(p.cert); });
        h.push(ptext(pron('{I}', many) + ', ' + names(who.map(function (p) { return p.name; })) + ', certify that:'), '<ul>' + cert.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>', ptext(''), au('signatures'));
      } else if (s.key !== 'materials') h.push(text ? typed(text) : ptext(''));
      if (s.key === 'materials') h.push(au('materials'));
      if (s.key === 'appraisal') aps.forEach(function (a) { h.push(au('appraisal:' + a.id)); if (E.compareKeys(a).length) h.push(ptext('The same trees were also valued under each edition and method shown below.'), au('compare:' + a.id)); });
      if (s.key === 'risk') h.push(au('risk'));
      if (s.key === 'zones') h.push(au('zones'));
      if (s.key === 'recommendations') h.push(au('recs'));
    });
    if ((ctx.photos || []).length) h.push(au('break'), au('photos'));
    if (aps.length) h.push(au('break'), au('appendix'));
    return h.join('');
  }

  // ---------- reading the edited document ----------
  function parse(docHtml) {
    var doc = new DOMParser().parseFromString('<div id="r">' + (docHtml || '') + '</div>', 'text/html'), out = [], listNo = 9;
    function runs(node, f, acc) {
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { if (n.nodeValue) acc.push({ text: n.nodeValue.replace(/ /g, ' '), bold: f.b, italic: f.i, underline: f.u }); }
        else if (n.nodeType === 1) { var tag = n.tagName; if (tag === 'BR') { if (acc.length) acc.push({ text: ' ' }); } else runs(n, { b: f.b || tag === 'B' || tag === 'STRONG', i: f.i || tag === 'I' || tag === 'EM', u: f.u || tag === 'U' }, acc); }
      });
      return acc;
    }
    doc.getElementById('r').childNodes.forEach(function (n) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) out.push({ t: 'rich', runs: [{ text: n.nodeValue }] }); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (n.hasAttribute('data-auto')) out.push({ t: 'auto', key: n.getAttribute('data-auto') });
      else if (tag === 'H1' || tag === 'H2') out.push({ t: 'h', text: n.textContent.trim() });
      else if (tag === 'H3') out.push({ t: 'rich', runs: [{ text: n.textContent.trim(), bold: true }], keep: true });
      else if (tag === 'UL' || tag === 'OL') { var num = tag === 'OL' ? ++listNo : 0; var lis = n.querySelectorAll('li'); lis.forEach(function (li, i) { var b = num ? { t: 'rich', num: num, runs: runs(li, {}, []) } : { t: 'rich', bullet: true, runs: runs(li, {}, []) }; if (i < lis.length - 1) b.after = 60; out.push(b); }); }
      else out.push({ t: 'rich', runs: runs(n, {}, []) });
    });
    return out;
  }
  function plainText(docHtml) { return parse(docHtml).map(function (b) { return b.t === 'h' ? b.text : b.t === 'rich' ? b.runs.map(function (r) { return r.text; }).join('') : ''; }).join('\n'); }
  function docBlocks(c, ctx, docHtml) { var out = []; parse(docHtml).forEach(function (b) { if (b.t === 'auto') auto(c, ctx, b.key).forEach(function (x) { out.push(x); }); else out.push(b); }); return out; }
  function richHTML(b) {
    var inner = b.runs.map(function (r) { var t = esc(r.text); if (r.bold) t = '<b>' + t + '</b>'; if (r.italic) t = '<i>' + t + '</i>'; if (r.underline) t = '<u>' + t + '</u>'; return t; }).join('');
    return inner || '<br>';
  }
  // The whole document as HTML for printing, with every auto block filled in.
  function docHTML(c, ctx, docHtml, images) {
    var out = [], list = null;
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    parse(docHtml).forEach(function (b) {
      var want = b.t === 'rich' && b.bullet ? 'ul' : b.t === 'rich' && b.num ? 'ol' : null;
      if (want !== list) { close(); if (want) { out.push('<' + want + '>'); list = want; } }
      if (b.t === 'auto') out.push(html(auto(c, ctx, b.key), { images: images }));
      else if (b.t === 'h') out.push('<h2>' + esc(b.text) + '</h2>');
      else if (want) out.push('<li>' + richHTML(b) + '</li>');
      else out.push('<p' + (b.keep ? ' class="r-keep"' : '') + '>' + richHTML(b) + '</p>');
    });
    close(); return out.join('');
  }
  var PRINT_CSS = '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font:12pt/1.32 Helvetica,Arial,sans-serif;color:#000;margin:0;width:624px}h2{font-size:12pt;font-weight:bold;margin:14pt 0 7pt}p{margin:0 0 9pt}ul,ol{margin:0 0 9pt;padding-left:22pt}li{margin:0 0 3pt}ul{list-style-type:"-  "}' +
    '.r-title{text-align:center;font-size:14pt;margin:0 0 12pt}.r-center{text-align:center;margin:0 0 3pt}.r-left{margin:0 0 3pt}.r-small{font-size:9pt}.r-img{text-align:center;margin:0 0 6pt}.r-img img{display:inline-block}' +
    '.r-table{margin:0 0 9pt}.r-table table{width:100%;border-collapse:collapse}.pb{break-after:page;page-break-after:always;height:0}.r-sig{margin-bottom:2pt}.r-sigimg{margin:0 0 10pt}' +
    '.page{width:624px;display:flow-root;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.page>:first-child{margin-top:0}.page>:last-child{margin-bottom:0}';

  // Runs inside the page that is printed to a PDF. The print engine will not keep a heading with its text or a table row in one piece,
  // so the report is cut into pages here: every block is measured and placed, and long tables, lists and paragraphs are split between
  // rows, items and lines. This function is written into that page as text, so it must not use anything defined outside itself.
  function paginate() {
    var PAGE_H = 838;      // the printable height is 632 pt, about 842 px; a little is held back
    var body = document.body, pages = [], page = null, guard = 0;
    var queue = Array.prototype.slice.call(body.children).filter(function (el) { return el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'; });
    function has(el, c) { return !!(el.classList && el.classList.contains(c)); }
    function newPage() { page = document.createElement('div'); page.className = 'page'; body.appendChild(page); pages.push(page); }
    function limit() { return page.getBoundingClientRect().top + PAGE_H + 0.5; }
    function fits() { return page.getBoundingClientRect().height <= PAGE_H + 0.5; }      // the page box takes in every margin, so nothing can hang off the end
    function keepNext(el) { return el.tagName === 'H2' || has(el, 'r-keep') || has(el, 'r-img') || has(el, 'r-left'); }
    function kind(el) { return has(el, 'r-table') && el.querySelector('tbody') ? 'table' : el.tagName === 'UL' || el.tagName === 'OL' ? 'list' : el.tagName === 'P' && (!el.className || el.className === 'r-small') ? 'text' : ''; }
    function splitTable(el) {
      var table = el.querySelector('table'), tb = el.querySelector('tbody'), th = el.querySelector('thead'), rows = Array.prototype.slice.call(tb.children);
      // Fix the column widths first, so the part on the next page lines up with this one.
      if (!table.querySelector('colgroup')) {
        var first = (th || tb).querySelector('tr'), cg = document.createElement('colgroup');
        Array.prototype.forEach.call(first.children, function (c) { var col = document.createElement('col'); col.style.width = c.getBoundingClientRect().width + 'px'; cg.appendChild(col); });
        table.insertBefore(cg, table.firstChild); table.style.tableLayout = 'fixed';
      }
      var rest = el.cloneNode(false), t2 = table.cloneNode(false), tb2 = document.createElement('tbody'), k = rows.length;
      t2.appendChild(table.querySelector('colgroup').cloneNode(true)); if (th) t2.appendChild(th.cloneNode(true)); t2.appendChild(tb2); rest.appendChild(t2);
      while (k > 0 && !fits()) { k--; tb2.insertBefore(rows[k], tb2.firstChild); }
      if (k < 2) { rows.slice(k).forEach(function (r) { tb.appendChild(r); }); return null; }
      return rest;
    }
    function splitList(el) {
      var items = Array.prototype.slice.call(el.children), rest = el.cloneNode(false), k = items.length;
      while (k > 0 && !fits()) { k--; rest.insertBefore(items[k], rest.firstChild); }
      if (k < 1) { items.forEach(function (i) { el.appendChild(i); }); return null; }
      if (el.tagName === 'OL') rest.setAttribute('start', parseInt(el.getAttribute('start') || '1', 10) + k);
      return rest;
    }
    function splitText(p) {
      var lim = limit(), top = p.getBoundingClientRect().top, lh = parseFloat(getComputedStyle(p).lineHeight) || 21;
      var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [], n, total = 0;
      while ((n = walker.nextNode())) { nodes.push([n, total]); total += n.nodeValue.length; }
      if (!total) return null;
      function at(off) { for (var i = nodes.length - 1; i >= 0; i--) if (off >= nodes[i][1]) return [nodes[i][0], off - nodes[i][1]]; return [nodes[0][0], 0]; }
      function bottom(off) { var r = document.createRange(), a = at(off); r.setStart(p, 0); r.setEnd(a[0], a[1]); var rs = r.getClientRects(), b = top; for (var i = 0; i < rs.length; i++) if (rs[i].bottom > b) b = rs[i].bottom; return b; }
      var lo = 0, hi = total;
      while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (bottom(mid) <= lim) lo = mid; else hi = mid - 1; }
      var first = Math.round((bottom(lo) - top) / lh), all = Math.round(p.getBoundingClientRect().height / lh);
      if (lo <= 0 || first < 2 || all - first < 2) return null;      // never leave one line alone at the foot or the head of a page
      var a = at(lo), r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(p, p.childNodes.length);
      var rest = p.cloneNode(false); rest.appendChild(r.extractContents());
      var keep = p.style.marginBottom; p.style.marginBottom = '0';
      if (!fits()) { while (rest.firstChild) p.appendChild(rest.firstChild); p.normalize(); p.style.marginBottom = keep; return null; }
      return rest;
    }
    queue.forEach(function (el) { body.removeChild(el); });
    newPage();
    while (queue.length && guard++ < 50000) {
      var el = queue.shift();
      if (has(el, 'pb')) { if (page.firstChild) newPage(); continue; }
      var group = [el];
      while (keepNext(group[group.length - 1]) && queue.length && !has(queue[0], 'pb')) group.push(queue.shift());
      var wasEmpty = !page.firstChild;
      group.forEach(function (g) { page.appendChild(g); });
      if (fits()) continue;
      var last = group[group.length - 1], k = kind(last), rest = null;
      var height = last.getBoundingClientRect().bottom - group[0].getBoundingClientRect().top;
      // A table that takes less than half a page moves to the next page whole. Anything longer is split to fill this one.
      if (k && !(k === 'table' && !wasEmpty && height <= PAGE_H * 0.5)) rest = k === 'table' ? splitTable(last) : k === 'list' ? splitList(last) : splitText(last);
      if (rest) { queue.unshift(rest); newPage(); continue; }
      if (wasEmpty) { newPage(); continue; }      // taller than a page and not something that can be split: it stays where it is
      group.forEach(function (g) { page.removeChild(g); });
      for (var i = group.length - 1; i >= 0; i--) queue.unshift(group[i]);
      newPage();
    }
    if (!page.firstChild && pages.length > 1) { body.removeChild(page); pages.pop(); }
    return pages.length;
  }

  // ---------- checks ----------
  function checks(c, ctx, docHtml) {
    var out = [], st = ctx.settings || {}, who = people(c, st), on = (c.sections || []).filter(function (s) { return s.on; });
    var autoKeys = { qualifications: 1, materials: 1, appraisal: 1, risk: 1, zones: 1, recommendations: 1, certification: 1 }, has = {}, blocks = docHtml ? parse(docHtml) : null;
    var text = docHtml ? plainText(docHtml) : [c.letter || ''].concat(on.map(function (s) { return s.text || ''; })).join('\n');
    if (blocks) blocks.forEach(function (b) { if (b.t === 'auto') { var k = b.key.split(':')[0]; has[k === 'recs' ? 'recommendations' : k] = 1; } }); else on.forEach(function (s) { has[s.key] = 1; });
    if (!who.length) out.push({ level: 'missing', text: 'Nobody is ticked under “Submitted by” on the Overview tab.' });
    if (!(c.to && String(c.to.name || '').trim())) out.push({ level: 'missing', text: 'No name under “Report is submitted to” on the Overview tab.' });
    if (!c.reportDate) out.push({ level: 'missing', text: 'No report date.' });
    who.forEach(function (p) { if (p.review) out.push({ level: 'warn', text: 'The qualifications for ' + p.name + ' were copied from an earlier report. Check them in Settings.' }); });
    var br = text.match(/\[[^\]\n]{2,}\]/g);
    if (br) out.push({ level: 'warn', text: br.length + (br.length === 1 ? ' placeholder' : ' placeholders') + ' in square brackets still to replace, starting with ' + br[0] + '.' });
    if (/\?\?|TODO|XXX/.test(text)) out.push({ level: 'warn', text: 'The text still has a note to yourself (?? or TODO).' });
    if (blocks) { var emptyH = []; blocks.forEach(function (b, i) { if (b.t !== 'h') return; var nx = blocks[i + 1]; if (!nx || nx.t === 'h' || (nx.t === 'rich' && !nx.runs.map(function (r) { return r.text; }).join('').trim() && (!blocks[i + 2] || blocks[i + 2].t === 'h'))) emptyH.push(b.text); }); if (emptyH.length) out.push({ level: 'note', text: 'Nothing written yet under: ' + emptyH.join(', ') + '.' }); }
    else { var empty = on.filter(function (s) { return !autoKeys[s.key] && !String(s.text || '').trim(); }).map(function (s) { return s.title; }); if (empty.length) out.push({ level: 'note', text: 'Empty so far: ' + empty.join(', ') + '.' }); }
    var ph = ctx.photos || [], nocap = [];
    ph.forEach(function (f, i) { var m = (c.files || {})[f.rel]; if (!m || !String(m.caption || '').trim()) nocap.push(i + 1); });
    if (nocap.length) out.push({ level: 'warn', text: 'No caption on photo ' + nocap.join(', ') + '.' });
    var refs = photoRefs(text), over = refs.filter(function (n) { return n > ph.length || n < 1; });
    if (over.length) out.push({ level: 'warn', text: 'The text refers to photo ' + over.join(', ') + ', but ' + (ph.length ? 'only ' + ph.length + (ph.length === 1 ? ' photo is' : ' photos are') : 'no photos are') + ' in the report.' });
    if (ph.length && refs.length) { var unused = []; for (var i = 1; i <= ph.length; i++) if (refs.indexOf(i) < 0) unused.push(i); if (unused.length) out.push({ level: 'note', text: 'Not mentioned in the text: photo ' + unused.join(', ') + '.' }); }
    if (ph.length && blocks && !has.photos) out.push({ level: 'warn', text: 'Photos are chosen on the Photos tab, but the document has no photo pages. Use Insert to add them.' });
    var aps = ctx.appraisals || [];
    if (has.appraisal && !aps.length) out.push({ level: 'warn', text: 'The report has an appraisal table, but no appraisal is ticked on the Appraisal tab.' });
    aps.forEach(function (a) { var A = E.calcAppraisal(a); if (A.missing) out.push({ level: 'warn', text: 'The appraisal “' + R.title(a) + '” has ' + A.missing + (A.missing === 1 ? ' tree' : ' trees') + ' still missing data.' }); });
    var rt = (c.risk && c.risk.trees) || [], unfinished = 0;
    rt.forEach(function (t) { unfinished += root.Risk.calcTree(t).missing; });
    if (has.risk && !rt.length) out.push({ level: 'warn', text: 'The report has risk tables, but no trees are rated on the Risk tab.' });
    if (unfinished) out.push({ level: 'warn', text: unfinished + (unfinished === 1 ? ' risk row is' : ' risk rows are') + ' not finished.' });
    if ((has.zones || has.recommendations) && root.Zones && root.Zones.checks) root.Zones.checks(c.preserve, has).forEach(function (k) { out.push(k); });
    return out;
  }

  // Images an export needs: the photos in the report at full size, and any signature images.
  async function exportImages(c, ctx, docHtml, asDataURL) {
    var images = {}, keys = {}; parse(docHtml).forEach(function (b) { if (b.t === 'auto') keys[b.key] = 1; });
    if (keys.photos) { var photos = ctx.photos || []; for (var i = 0; i < photos.length; i++) { var im = await root.Host.call('caseImage', { path: ctx.path, rel: photos[i].rel, max: 1600 }); images['ph:' + i] = asDataURL ? 'data:image/jpeg;base64,' + im.data : im; } }
    if (keys.signatures) people(c, ctx.settings || {}).forEach(function (p) { if (p.sig && p.sig.data) images['sig:' + p.id] = asDataURL ? 'data:image/png;base64,' + p.sig.data : p.sig; });
    return images;
  }
  // The Word file for Pages. With no edited document yet, it is built from the case outline.
  async function build(c, ctx, docHtml) {
    var h = docHtml || outline(c, ctx), images = await exportImages(c, ctx, h, false);
    var blocks = docBlocks(c, ctx, h);
    return { bytes: root.Docx.build({ shortTitle: c.name || c.reportTitle || '', logo: (ctx.settings || {}).logo, images: images, blocks: blocks }), photos: (ctx.photos || []).length, blocks: blocks.length };
  }
  async function printable(c, ctx, docHtml) { var h = docHtml || outline(c, ctx); return '<!doctype html><html><head><meta charset="utf-8"><style>' + PRINT_CSS + '</style><script>window.__paginate = ' + paginate.toString() + ';</' + 'script></head><body>' + docHTML(c, ctx, h, await exportImages(c, ctx, h, true)) + '</body></html>'; }

  root.CaseReport = { build: build, printable: printable, checks: checks, materials: materials, photoRefs: photoRefs, paras: paras, people: people, pron: pron, auto: auto, autoLabel: autoLabel, AUTO: AUTO, html: html, outline: outline, parse: parse, plainText: plainText,
    docBlocks: docBlocks, docHTML: docHTML, PRINT_CSS: PRINT_CSS, paginate: paginate, names: names, lines: lines };
})(typeof window !== 'undefined' ? window : globalThis);
