/* Expert Report: turns an appraisal and its calculated results into tables, method text, checks and export files.
 * No DOM here, so the same tables feed the screen, the Word file, the clipboard and the CSV.
 */
(function (root) {
  'use strict';
  var E = root.Engine;
  var money = E.money, fmt = E.fmt, pct = E.pct;

  var CITE = {
    '9': 'Council of Tree and Landscape Appraisers. 2000. Guide for Plant Appraisal, 9th Edition. International Society of Arboriculture.',
    '10': 'Council of Tree and Landscape Appraisers. 2018. Guide for Plant Appraisal, 10th Edition. International Society of Arboriculture.'
  };
  var SIZE_HEAD = { dbh: 'Trunk diameter (in)', circ: 'Trunk circumference (in)', area: 'Trunk area (sq in)' };

  function title(a) { return (a.title || a.client || 'Untitled appraisal').trim(); }
  function tag(t, i) { return (t.tag !== undefined && t.tag !== null && String(t.tag).trim() !== '') ? String(t.tag).trim() : String(i + 1); }
  function spName(c) { return c.sp ? (c.sp.common || c.sp.sci || 'Unnamed species') : ''; }
  function entered(c, a) {
    if (!c.size || c.size.d === null) return '';
    return c.size.entered.map(function (v) { return fmt(v, 2); }).join(' + ');
  }
  function shortMethod(c) {
    if (!c.method) return '';
    return c.ed === '9' ? (c.method === 'formula' ? 'TFM' : 'RCM') : (c.method === 'formula' ? 'TFT' : 'Direct');
  }
  function plainMethod(c) {
    if (!c.method) return '';
    return c.method === 'formula' ? 'Trunk formula' : (c.ed === '9' ? 'Replacement cost' : 'Direct replacement');
  }

  var LONG = 22; // rows beyond which a table will not fit under a heading on one page
  // One row per tree, or one row per species and method once the list is too long to read as a summary.
  function summary(a, A) {
    if (A.rows.length > LONG) {
      var groups = {}, order = [];
      A.rows.forEach(function (c) {
        var k = spName(c) + '|' + plainMethod(c);
        if (!groups[k]) { groups[k] = { name: spName(c) || 'No species', method: plainMethod(c), n: 0, done: 0, value: 0 }; order.push(k); }
        groups[k].n++; if (c.value !== null) { groups[k].done++; groups[k].value += c.value; }
      });
      return { head: ['Species', 'Trees', 'Method', 'Appraised value'], grouped: true,
        rows: order.map(function (k) { var g = groups[k]; return [g.name, String(g.n) + (g.done < g.n ? ' (' + (g.n - g.done) + ' incomplete)' : ''), g.method, money(g.value)]; }),
        total: ['Total', String(A.done), '', money(A.trees)], widths: [3600, 1500, 2360, 1900], align: ['l', 'r', 'l', 'r'], size: 9 };
    }
    var rows = A.rows.map(function (c, i) {
      return [tag(a.trees[i], i), spName(c), entered(c, a), plainMethod(c), c.value !== null ? money(c.value) : 'incomplete'];
    });
    return {
      head: ['Tree', 'Species', SIZE_HEAD[a.sizeMode || 'dbh'], 'Method', 'Appraised value'], rows: rows,
      total: ['Total', A.done + (A.done === 1 ? ' tree' : ' trees'), '', '', money(A.trees)],
      widths: [900, 2900, 1900, 1860, 1800], align: ['l', 'l', 'r', 'l', 'r'], size: 9
    };
  }

  function costLines(a, A) {
    var rows = [];
    (a.lines || []).forEach(function (x, i) {
      var v = A.lineRows[i] ? A.lineRows[i].amount : null;
      if (v === null && !String(x.desc || '').trim()) return;
      var q = E.num(x.qty), e = E.num(x.each);
      rows.push([String(x.desc || '').trim() || 'Cost item', q !== null && e !== null ? fmt(q, 2) + ' × ' + money(e) : '', v !== null ? money(v) : 'not entered']);
    });
    return { head: ['Other costs', 'Basis', 'Amount'], rows: rows, total: ['Total, other costs', '', money(A.lines)], widths: [5360, 2200, 1800], align: ['l', 'l', 'r'], size: 9 };
  }

  function usedSpecies(a) {
    var used = {};
    (a.trees || []).forEach(function (t) { if (t.sp) used[t.sp] = (used[t.sp] || 0) + 1; });
    return (a.species || []).filter(function (s) { return used[s.id]; });
  }

  // The unit cost is shown only for a species that actually has a tree worked by the trunk formula.
  function basis(a, A) {
    var ed = E.edition(a), rows = [], formula = null;
    if (A) { formula = {}; A.rows.forEach(function (c) { if (c.method === 'formula' && c.sp) formula[c.sp.id] = true; }); }
    usedSpecies(a).forEach(function (s) {
      var b = E.baseRow(s), u = !formula || formula[s.id] ? E.unitCost(s) : null, inst = E.num(s.install);
      var size = b ? (b.min !== b.max ? fmt(b.min, 2) + '–' + fmt(b.max, 2) : fmt(b.min, 2)) + ' in' : 'not entered';
      var r = [s.common || s.sci || 'Unnamed species'];
      if (ed === '9') r.push(s.rating && E.num(s.rating.pct) !== null ? pct(E.num(s.rating.pct)) : 'not entered');
      r.push(size, b ? money(b.cost) : '—', inst ? money(inst) : '—', u ? money(u.unit, 2) : '—', b ? (b.source || '') : '');
      rows.push(r);
    });
    var head = ['Species'];
    if (ed === '9') head.push('Species rating');
    head.push('Largest replacement tree', 'Cost', 'Installation', 'Unit cost per sq in', 'Price source');
    return ed === '9'
      ? { head: head, rows: rows, widths: [1400, 880, 1240, 860, 1040, 1040, 2900], align: ['l', 'r', 'r', 'r', 'r', 'r', 'l'], size: 8 }
      : { head: head, rows: rows, widths: [1700, 1500, 1000, 1100, 1160, 2900], align: ['l', 'r', 'r', 'r', 'r', 'l'], size: 8 };
  }

  // Every listed replacement size, shown only when a species has more than one.
  function ladder(a) {
    // Species that share the same price list are shown once, together.
    var rows = [], groups = [], bySig = {};
    usedSpecies(a).forEach(function (s) {
      var rr = E.replRows(s);
      if (rr.length < 2) return;
      var sig = rr.map(function (r) { return r.min + '-' + r.max + ':' + r.cost + ':' + r.source; }).join('|');
      if (!bySig[sig]) { bySig[sig] = { names: [], rows: rr }; groups.push(bySig[sig]); }
      bySig[sig].names.push(s.common || s.sci || '');
    });
    groups.forEach(function (g) { g.rows.forEach(function (r) { rows.push([listNames(g.names), (r.min !== r.max ? fmt(r.min, 2) + '–' + fmt(r.max, 2) : fmt(r.min, 2)) + ' in', money(r.cost), r.source || '']); }); });
    return rows.length ? { head: ['Species', 'Replacement size', 'Cost', 'Price source'], rows: rows, widths: [2200, 1700, 1300, 4160], align: ['l', 'r', 'r', 'l'], size: 8 } : null;
  }

  function detail(a, A) {
    var ed = E.edition(a);
    var rows = A.rows.map(function (c, i) {
      // Several stems are listed one by one; an equivalent single diameter would read as a measurement nobody took.
      var dia = c.d === null || (a.sizeMode || 'dbh') === 'area' ? '—' : c.size.stems.map(function (v) { return fmt(v, 1); }).join(' + ');
      var r = [tag(a.trees[i], i), spName(c), dia,
        c.areaUsed !== null && c.areaUsed !== undefined ? fmt(c.areaUsed, 1) + (c.adjusted ? '*' : '') : '—',
        shortMethod(c), c.unit ? money(c.unit, 2) : '—', c.basic !== null ? money(c.basic, 0) : '—'];
      if (ed === '9') r.push(pct(c.S), pct(c.C), pct(c.L));
      else if (c.method === 'replace' && a.depreciateReplacement === false) r.push('—', '—', '—');
      else r.push(pct(c.C), pct(c.F), pct(c.E));
      r.push(c.value !== null ? money(c.value) : 'incomplete');
      return r;
    });
    var head = ['Tree', 'Species', 'Dia. (in)', 'Trunk area (sq in)', 'Method', 'Unit cost', ed === '9' ? 'Basic tree cost' : 'Basic cost'];
    head = head.concat(ed === '9' ? ['Species', 'Condition', 'Location'] : ['Condition', 'Functional', 'External'], ['Appraised value']);
    var total = head.map(function () { return ''; }); total[1] = 'Total'; total[head.length - 1] = money(A.trees);
    // Widths are set so that no heading has to break inside a word at 8 point.
    var widths = ed === '9' ? [560, 1140, 660, 760, 780, 780, 1000, 780, 920, 840, 1140] : [560, 980, 660, 760, 780, 780, 1000, 920, 980, 800, 1140];
    return { head: head, rows: rows, total: total, widths: widths, align: ['l', 'l', 'r', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r'], size: 8 };
  }
  // One row per tree, one column per edition and method chosen for comparison.
  function compare(a, keys) {
    var cmp = E.compare(a, keys), ks = cmp.keys, capped = false, missing = false;
    var rows = (a.trees || []).map(function (t, i) {
      var first = ks.length ? cmp.by[ks[0]].A.rows[i] : E.calcTree(t, a);
      var dia = first.d === null || (a.sizeMode || 'dbh') === 'area' ? '—' : first.size.stems.map(function (v) { return fmt(v, 1); }).join(' + ');
      return [tag(t, i), spName(first), dia].concat(ks.map(function (k) { var c = cmp.by[k].A.rows[i]; if (c.value === null) { missing = true; return 'incomplete'; } if (c.capped) capped = true; return money(c.value) + (c.capped ? '†' : ''); }));
    });
    var head = ['Tree', 'Species', 'Dia. (in)'].concat(ks.map(function (k) { return E.approach(k).short; }));
    var total = ['Total', plural(rows.length, 'tree'), ''].concat(ks.map(function (k) { return money(cmp.by[k].A.trees); }));
    var each = ks.length ? Math.floor((9360 - 620 - 1500 - 900) / ks.length) : 0, widths = [620, 1500, 900].concat(ks.map(function () { return each; }));
    widths[1] += 9360 - widths.reduce(function (x, y) { return x + y; }, 0);
    return { head: head, rows: rows, total: total, widths: widths, align: ['l', 'l', 'r'].concat(ks.map(function () { return 'r'; })), size: 8, keys: ks, cmp: cmp, capped: capped, missing: missing };
  }
  function compareNote(t) {
    var s = 'Each column values the same trees with the same measurements. The 9th edition methods apply species, condition and location ratings; the 10th edition techniques apply condition, functional limitations and external limitations.';
    if (t.capped) s += ' † Valued at the largest replacement tree on the price sheet, which is smaller than the tree appraised.';
    return s;
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function legend(a, A) {
    var ed = E.edition(a), s = ed === '9' ? 'TFM = Trunk Formula Method. RCM = Replacement Cost Method.' : 'TFT = Trunk Formula Technique. Direct = direct replacement cost.';
    if (A.adjusted) s += ' * Adjusted trunk area for a trunk more than 30 inches in diameter.';
    return s;
  }

  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  function listNames(arr) { return arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }

  function sources(a, ctx) {
    var ed = E.edition(a), st = (ctx && ctx.settings) || {}, out = [];
    out.push(ed === '9' ? (st.cite9 || CITE['9']) : (st.cite10 || CITE['10']));
    var used = usedSpecies(a);
    if (ed === '9') {
      var lists = {};
      used.forEach(function (s) { if (s.rating && s.rating.source === 'list' && s.rating.listId) lists[s.rating.listId] = 1; });
      ((ctx && ctx.ratings && ctx.ratings.lists) || []).forEach(function (l) { if (lists[l.id]) out.push(l.citation + (l.doi ? ' ' + l.doi : '')); });
    }
    var seen = {};
    used.forEach(function (s) { E.replRows(s).forEach(function (r) { var k = String(r.source || '').split(':')[0].trim(); if (k && !seen[k]) { seen[k] = 1; out.push(k + '.'); } }); });
    return out;
  }

  function methodText(a, A, ctx) {
    var ed = E.edition(a), p = [], formula = 0, replace = 0, capped = 0, fixed = 0, chosen = false, otherBase = false;
    A.rows.forEach(function (c) { if (c.value === null) return; if (c.method === 'formula') formula++; else { replace++; if (c.fixed) fixed++; } if (c.capped) capped++; });
    // When the appraiser picked the method or the base price for a species, the wording must not claim the usual rule was followed.
    usedSpecies(a).forEach(function (s) {
      if (s.method === 'formula' || s.method === 'replace') chosen = true;
      var plain = { repl: (s.repl || []).map(function (r) { return { size: r.size, cost: r.cost }; }) };
      if (s.unitMode !== 'manual' && E.baseAt(s) !== E.baseAt(plain)) otherBase = true;
    });
    var fLead = !replace ? 'The trees were' : chosen ? 'Some trees were' : 'Trees larger than the largest commonly available nursery tree were';
    var rLead = !formula ? 'The trees were' : chosen ? 'The other trees were' : null;
    var guide = ed === '9' ? 'Guide for Plant Appraisal, 9th Edition' : 'Guide for Plant Appraisal, 10th Edition';
    if (ed === '9') {
      if (formula) p.push(fLead + ' appraised with the Trunk Formula Method described in the ' + guide + '. The method starts with the installed cost of ' + (otherBase ? 'the replacement tree selected as the basis for the species' : 'the largest commonly available replacement tree') + '. The trunk area of the subject tree beyond that of the replacement tree is priced at a unit cost per square inch and added to it, which gives the basic tree cost. The basic tree cost is then multiplied by the species, condition and location ratings.');
      if (replace) p.push((rLead || 'Trees no larger than available nursery stock were') + ' appraised with the Replacement Cost Method described in the ' + guide + ': the installed cost of ' + (fixed ? 'the replacement tree selected for the species' : 'a replacement tree of comparable size') + ', multiplied by the species, condition and location ratings.');
      var notes = [];
      if (formula) notes.push('Trunk area was calculated as 0.7854 times the square of the trunk diameter.' + (A.adjusted ? ' For trunks more than 30 inches in diameter, the adjusted trunk area given in the Guide was used.' : ''));
      if ((a.locationMode || 'parts') === 'parts') notes.push('The location rating is the average of the site, contribution and placement ratings.');
      if (notes.length) p.push(notes.join(' '));
      var listed = [], own = [];
      usedSpecies(a).forEach(function (s) { (s.rating && s.rating.source === 'list' ? listed : own).push(s.common || s.sci || 'unnamed species'); });
      var l = (ctx && ctx.ratings && ctx.ratings.lists && ctx.ratings.lists[0]) || null;
      if (listed.length) p.push('Species ratings' + (own.length ? ' for ' + listNames(listed) : '') + ' are from ' + (l ? l.short : 'the published list cited below') + '.' + (own.length ? ' The rating for ' + listNames(own) + ' was assigned by the appraiser.' : ''));
      else if (own.length) p.push('Species ratings were assigned by the appraiser.');
      if (E.roundRule(a) === 'guide9') p.push('Appraised values of $5,000 or more are rounded to the nearest $100, and smaller values to the nearest $10.');
    } else {
      if (formula) p.push(fLead + ' appraised with the Trunk Formula Technique described in the ' + guide + '. The cost of ' + (otherBase ? 'the nursery tree selected as the basis for the species' : 'the largest commonly available nursery tree') + ' is divided by its trunk area to give a unit cost per square inch. That unit cost multiplied by the trunk area of the subject tree gives the basic cost, which is then adjusted for condition, functional limitations and external limitations.');
      if (replace) p.push((rLead || 'Trees of replaceable size were') + ' appraised at the cost of ' + (fixed ? 'the replacement tree selected for the species' : 'a comparable replacement tree') + (a.depreciateReplacement === false ? '. No depreciation was applied to these replacement costs.' : ', adjusted for condition, functional limitations and external limitations.'));
      if (formula) p.push('Trunk area was calculated as 0.7854 times the square of the trunk diameter.');
    }
    if (capped) p.push(capped + (capped === 1 ? ' tree is' : ' trees are') + ' larger than the largest listed replacement tree and ' + (capped === 1 ? 'was' : 'were') + ' valued at the cost of that replacement. ' + (capped === 1 ? 'The amount for that tree does not reflect its full size.' : 'The amounts for those trees do not reflect their full size.'));
    if ((a.sizeMode || 'dbh') === 'circ') p.push('Trunk diameter was calculated from the measured circumference.');
    return p;
  }

  function trees(list) { return list.length > 12 ? list.slice(0, 12).join(', ') + ' and ' + (list.length - 12) + ' more' : list.join(', '); }

  function checks(a, A) {
    var out = [], ed = E.edition(a), miss = {}, capped = [], adj = [], off = [], ltd = {}, other = {};
    A.rows.forEach(function (c, i) {
      var tg = tag(a.trees[i], i);
      c.missing.forEach(function (m) { (miss[m] = miss[m] || []).push(tg); });
      if (c.capped) capped.push(tg);
      if (c.adjusted) adj.push(tg);
      if (c.diff !== undefined && Math.abs(c.diff) > 2) off.push(tg + ' (' + (c.diff > 0 ? '+' : '−') + money(Math.abs(c.diff)).replace('$', '$') + ')');
      c.warn.forEach(function (w) { if (/marked limited/.test(w)) ltd[spName(c)] = 1; else if (!/largest listed replacement|Adjusted trunk area/.test(w)) (other[w] = other[w] || []).push(tg); });
    });
    if (!(a.trees || []).length) out.push({ level: 'missing', text: 'No trees entered yet.' });
    Object.keys(miss).forEach(function (m) { out.push({ level: 'missing', text: 'Missing ' + m + ': tree ' + trees(miss[m]) + '.' }); });
    usedSpecies(a).forEach(function (s) {
      if (ed === '9' && s.rating && s.rating.source !== 'list' && E.num(s.rating.pct) !== null && !String(s.rating.note || '').trim())
        out.push({ level: 'warn', text: 'The species rating for ' + (s.common || 'a species') + ' is your own. Add a short reason so the report can explain it.' });
    });
    var gk = ed === '9' ? ((a.locationMode || 'parts') === 'single' ? ['cond', 'loc'] : ['cond']) : ['cond'], gname = { cond: 'condition', loc: 'location' };
    var gd = gk.filter(function (k) { return a.guess && a.guess[k] && E.num((a.defaults || {})[k]) !== null; }), gt = [];
    (a.trees || []).forEach(function (t, i) { if (t.guess && gk.some(function (k) { return t.guess[k] && E.num(t[k]) !== null; })) gt.push(tag(t, i)); });
    if (gd.length) out.push({ level: 'warn', text: 'The ' + gd.map(function (k) { return gname[k]; }).join(' and ') + ' rating' + (gd.length > 1 ? 's' : '') + ' used for blank cells ' + (gd.length > 1 ? 'are still starting guesses' : 'is still a starting guess') + ', not your own. Review ' + (gd.length > 1 ? 'them' : 'it') + ' on the Trees tab.' });
    if (gt.length) out.push({ level: 'warn', text: 'Ratings guessed from the notes and photos, not yet reviewed: tree ' + trees(gt) + '.' });
    if (off.length) out.push({ level: 'warn', text: off.length + (off.length === 1 ? ' stated value does' : ' stated values do') + ' not match the calculation: tree ' + trees(off) + '.' });
    if (capped.length) out.push({ level: 'note', text: 'Valued at the largest listed replacement, which is smaller than the tree: tree ' + trees(capped) + '.' });
    if (adj.length) out.push({ level: 'note', text: 'Adjusted trunk area used (trunk over 30 inches): tree ' + trees(adj) + '.' });
    Object.keys(ltd).forEach(function (n) { out.push({ level: 'note', text: 'The replacement size used for ' + n + ' is marked limited on its price sheet. Consider whether it is commonly available.' }); });
    Object.keys(other).forEach(function (w) { out.push({ level: 'note', text: w + ' Tree ' + trees(other[w]) + '.' }); });
    (a.lines || []).forEach(function (x, i) { if (String(x.desc || '').trim() && A.lineRows[i].amount === null) out.push({ level: 'missing', text: 'Other cost "' + x.desc + '" has no amount.' }); });
    if (!a.valuationDate) out.push({ level: 'note', text: 'No valuation date entered on the Setup tab.' });
    return out;
  }

  // ---------- output formats ----------
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function tableHTML(t, inline) {
    var td = inline ? 'border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica,Arial,sans-serif;' : '';
    function cell(tagName, v, i, extra) {
      var al = (t.align && t.align[i]) === 'r' ? 'right' : 'left';
      return '<' + tagName + (inline ? ' style="' + td + 'text-align:' + al + ';' + (extra || '') + '"' : ' class="' + (al === 'right' ? 'r' : '') + '"') + '>' + esc(v) + '</' + tagName + '>';
    }
    var h = '<table' + (inline ? ' style="border-collapse:collapse"' : ' class="rt"') + '><thead><tr>' + t.head.map(function (v, i) { return cell('th', v, i, 'background:#bfbfbf;font-weight:bold;'); }).join('') + '</tr></thead><tbody>';
    t.rows.forEach(function (r) { h += '<tr>' + t.head.map(function (_, i) { return cell('td', r[i], i); }).join('') + '</tr>'; });
    if (t.total) h += '<tr class="tot">' + t.head.map(function (_, i) { return cell('td', t.total[i], i, 'font-weight:bold;'); }).join('') + '</tr>';
    return h + '</tbody></table>';
  }
  function tableTSV(t) {
    var lines = [t.head.join('\t')];
    t.rows.forEach(function (r) { lines.push(t.head.map(function (_, i) { return r[i] === undefined ? '' : r[i]; }).join('\t')); });
    if (t.total) lines.push(t.total.join('\t'));
    return lines.join('\n');
  }
  function csv(a, A) {
    var ed = E.edition(a);
    function q(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function n(v, d) { return v === null || v === undefined || !isFinite(v) ? '' : (+v.toFixed(d === undefined ? 4 : d)); }
    var head = ['Tree', 'Species', 'Scientific name', 'Size as entered', 'Diameter (in)', 'Trunk area (sq in)', 'Trunk area used (sq in)', 'Method', 'Unit cost per sq in', 'Basic cost'];
    head = head.concat(ed === '9' ? ['Species %', 'Condition %', 'Site %', 'Contribution %', 'Placement %', 'Location %'] : ['Condition %', 'Functional %', 'External %'], ['Value before rounding', 'Appraised value', 'Stated value', 'Note']);
    var lines = [head.map(q).join(',')];
    A.rows.forEach(function (c, i) {
      var t = a.trees[i], r = [tag(t, i), spName(c), c.sp ? c.sp.sci || '' : '', t.size || '', n(c.d), n(c.area), n(c.areaUsed), c.methodName || '', n(c.unit), n(c.basic, 2)];
      r = r.concat(ed === '9' ? [n(c.S), n(c.C), n(c.site), n(c.contrib), n(c.place), n(c.L)] : [n(c.C), n(c.F), n(c.E)], [n(c.raw, 2), n(c.value, 2), n(c.stated, 2), t.note || '']);
      lines.push(r.map(q).join(','));
    });
    (a.lines || []).forEach(function (x, i) { if (A.lineRows[i].amount !== null) lines.push(['Other cost', x.desc || ''].map(q).join(',') + new Array(head.length - 4).join(',') + ',' + n(A.lineRows[i].amount, 2) + ',,'); });
    return lines.join('\r\n') + '\r\n';
  }

  function docxBlocks(a, A, ctx) {
    var ed = E.edition(a), b = [], st = (ctx && ctx.settings) || {};
    b.push({ t: 'title', text: title(a) + ': Tree Appraisal' });
    var meta = [];
    if (a.client) meta.push('Client: ' + a.client);
    if (a.property) meta.push('Property: ' + a.property);
    if (a.inspected) meta.push('Inspected: ' + a.inspected);
    if (a.valuationDate) meta.push('Valuation date: ' + longDate(a.valuationDate));
    if (a.lossDate) meta.push('Date of loss: ' + a.lossDate);
    if (a.preparedBy || st.preparedBy) meta.push('Prepared by: ' + (a.preparedBy || st.preparedBy));
    meta.push('Method: Guide for Plant Appraisal, ' + (ed === '9' ? '9th' : '10th') + ' Edition');
    meta.forEach(function (m, i) { b.push({ t: 'p', text: m, after: i === meta.length - 1 ? 240 : 40 }); });
    function section(heading, tbl) { tbl.t = 'table'; if (tbl.rows.length > LONG) tbl.caption = heading; else b.push({ t: 'h', text: heading }); b.push(tbl); }
    section('Summary of Appraised Values', summary(a, A));
    var cl = costLines(a, A);
    if (cl.rows.length) { cl.t = 'table'; b.push(cl); b.push({ t: 'p', text: 'Total of trees and other costs: ' + money(A.total), bold: true }); }
    section('Basis of Costs' + (ed === '9' ? ' and Species Ratings' : ''), basis(a, A));
    var ld = ladder(a); if (ld) { ld.t = 'table'; b.push(ld); }
    var d = detail(a, A); d.after = 60; section('Appraisal Worksheet', d);
    b.push({ t: 'small', text: legend(a, A) });
    b.push({ t: 'h', text: 'Method' });
    var mt = a.methodText && String(a.methodText).trim() ? String(a.methodText).split(/\n\s*\n/) : methodText(a, A, ctx);
    mt.forEach(function (p) { b.push({ t: 'p', text: p.trim() }); });
    b.push({ t: 'h', text: 'Sources' });
    b.push({ t: 'bullets', items: sources(a, ctx) });
    return b;
  }

  root.Report = { CITE: CITE, title: title, tag: tag, summary: summary, costLines: costLines, basis: basis, ladder: ladder, detail: detail, legend: legend,
    compare: compare, compareNote: compareNote, sources: sources, methodText: methodText, checks: checks, tableHTML: tableHTML, tableTSV: tableTSV, csv: csv, docxBlocks: docxBlocks, longDate: longDate, usedSpecies: usedSpecies, shortMethod: shortMethod };
})(typeof window !== 'undefined' ? window : globalThis);
