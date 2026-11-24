/* Expert Report: appraisal engine. Pure functions with no DOM, so the same file runs in the app and in the tests.
 *
 * Methods implemented (formulas only; all wording here is original):
 *   9th edition   Trunk Formula Method      basic tree cost = (subject trunk area - replacement trunk area) x unit cost + installed replacement cost
 *                                           appraised value = basic tree cost x species x condition x location
 *                 Replacement Cost Method   appraised value = installed replacement cost x species x condition x location
 *   10th edition  Trunk Formula Technique   basic cost = subject trunk area x unit cost; value = basic cost x condition x functional x external
 *                 Direct replacement        value = replacement cost (optionally x condition x functional x external)
 */
(function (root) {
  'use strict';

  var K = 0.7854; // pi / 4

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function TA(d) { return d > 0 ? K * d * d : null; }
  // 9th edition adjusted trunk area, used in place of trunk area for trunks more than 30 inches in diameter.
  function ATA9(d) { return -0.335 * d * d + 69.3 * d - 1087; }

  function parseNumber(tok) {
    tok = String(tok).trim().replace(/["”″]/g, '').replace(/\s*(in|inches|inch)\.?$/i, '').trim();
    if (!tok) return null;
    tok = tok.replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').trim();
    var m = tok.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) return +m[1] + (+m[2] / +m[3]);
    m = tok.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) return +m[1] / +m[2];
    if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
    return null;
  }

  // A trunk size as typed. "17", "7 1/2", or several stems as "21+24". mode: 'dbh' | 'circ' | 'area'.
  function parseSize(text, mode) {
    var raw = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
    if (!raw) return { empty: true, stems: [], d: null, area: null, entered: [] };
    var parts = raw.split(/\s*[+&]\s*/).map(parseNumber);
    for (var i = 0; i < parts.length; i++) if (parts[i] === null || !(parts[i] > 0)) return { bad: true, stems: [], d: null, area: null, entered: [] };
    if (mode === 'area') {
      var area = parts.reduce(function (s, x) { return s + x; }, 0);
      return { stems: [], area: area, d: Math.sqrt(area / K), entered: parts };
    }
    var stems = parts.map(function (p) { return mode === 'circ' ? p / Math.PI : p; });
    var a2 = stems.reduce(function (s, d) { return s + K * d * d; }, 0);
    return { stems: stems, area: a2, d: Math.sqrt(a2 / K), entered: parts };
  }

  // A nursery size as typed: "4", "9-10", "2 1/2 - 3".
  function parseRange(text) {
    var raw = String(text === null || text === undefined ? '' : text).replace(/["”″]/g, '').trim();
    if (!raw) return null;
    var parts = raw.split(/\s*(?:-|–|to)\s*/).map(parseNumber);
    for (var i = 0; i < parts.length; i++) if (parts[i] === null || !(parts[i] > 0)) return null;
    var min = Math.min.apply(null, parts), max = Math.max.apply(null, parts);
    return { min: min, max: max, mid: (min + max) / 2 };
  }

  // Usable replacement-tree rows for a species, smallest first.
  function replRows(sp) {
    var out = [];
    ((sp && sp.repl) || []).forEach(function (r) {
      var g = parseRange(r.size), cost = num(r.cost);
      if (g && cost !== null && cost >= 0) out.push({ size: r.size, min: g.min, max: g.max, mid: g.mid, cost: cost, source: r.source || '', ltd: !!r.ltd, base: !!r.base, fixed: !!r.fixed, label: r.label || '' });
    });
    out.sort(function (a, b) { return a.max - b.max || a.cost - b.cost; });
    return out;
  }
  // The row that stands for "largest commonly available": the one marked, otherwise the largest.
  function baseRow(sp) {
    var rows = replRows(sp);
    for (var i = 0; i < rows.length; i++) if (rows[i].base) return rows[i];
    return rows.length ? rows[rows.length - 1] : null;
  }
  // The smallest listed tree at least as large as the subject; the largest if none is.
  function rowFor(sp, d) {
    var rows = replRows(sp);
    for (var i = 0; i < rows.length; i++) if (rows[i].max >= d - 1e-9) return rows[i];
    return rows.length ? rows[rows.length - 1] : null;
  }
  // The row every tree of the species is priced at when the species is set to replacement cost at one size; null when none is chosen.
  function fixedRow(sp) {
    if (!sp || sp.method !== 'replace') return null;
    var rows = replRows(sp);
    for (var i = 0; i < rows.length; i++) if (rows[i].fixed) return rows[i];
    return null;
  }
  // Where the base row sits in the species' own list of replacement rows (-1 when there is none). Same choice as baseRow.
  function baseAt(sp) {
    var rows = (sp && sp.repl) || [], best = -1, bm = -1, bc = -1, i, g, c;
    for (i = 0; i < rows.length; i++) { g = parseRange(rows[i].size); c = num(rows[i].cost); if (g && c !== null && c >= 0 && rows[i].base) return i; }
    for (i = 0; i < rows.length; i++) {
      g = parseRange(rows[i].size); c = num(rows[i].cost);
      if (g && c !== null && c >= 0 && (g.max > bm || (g.max === bm && c >= bc))) { bm = g.max; bc = c; best = i; }
    }
    return best;
  }
  function unitCost(sp) {
    var mode = (sp && sp.unitMode) || 'tree';
    if (mode === 'manual') { var u = num(sp.unitManual); return u !== null && u > 0 ? { unit: u, mode: mode } : null; }
    var b = baseRow(sp); if (!b) return null;
    var ta = TA(b.mid), inst = num(sp.install) || 0;
    var cost = mode === 'installed' ? b.cost + inst : b.cost;
    if (!(ta > 0) || !(cost > 0)) return null;
    return { unit: cost / ta, mode: mode, row: b, ta: ta, cost: cost };
  }

  function roundValue(v, rule) {
    if (v === null || v === undefined) return null;
    if (rule === 'guide9') { var r9 = v >= 5000 ? 100 : 10; return Math.round(v / r9) * r9; }
    var r = num(rule) || 0;
    return r > 0 ? Math.round(v / r) * r : Math.round(v * 100) / 100;
  }

  function money(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var d = dec === undefined ? (Math.abs(v - Math.round(v)) > 0.005 ? 2 : 0) : dec;
    var s = Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-$' : '$') + s;
  }
  function fmt(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var d = dec === undefined ? 2 : dec;
    return (+v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d });
  }
  function pct(v) { return v === null || v === undefined ? '—' : fmt(v, 1) + '%'; }

  // A rating on the tree, or the appraisal-wide default when the tree's own cell is blank.
  function rating(t, a, key) {
    var own = num(t[key]);
    if (own !== null) return { v: own, own: true };
    var d = num(a.defaults && a.defaults[key]);
    return { v: d, own: false };
  }

  function edition(a) { return a && a.edition === '10' ? '10' : '9'; }
  function roundRule(a) {
    if (a.rounding !== undefined && a.rounding !== null && a.rounding !== '') return a.rounding;
    return edition(a) === '9' ? 'guide9' : 100;
  }

  // Turn "site, contribution and placement" into one location rating. Each tree that had parts of its own gets their average
  // (blank parts filled from the row of defaults, as before), and the defaults get the average of the default parts. The three
  // parts stay in the file. exact = true reproduces the old result to the last digit, for an older appraisal being opened;
  // otherwise a location rating that is already typed in is kept.
  function oneLocation(a, exact) {
    var d = a.defaults || (a.defaults = {}), P = ['site', 'contrib', 'place'];
    function avg(o) {
      var own = false, s = 0;
      for (var i = 0; i < 3; i++) { var v = num(o[P[i]]); if (v !== null) own = true; else v = num(d[P[i]]); if (v === null) return { own: own, v: null }; s += v; }
      return { own: own, v: s / 3 };
    }
    (a.trees || []).forEach(function (t) { var r = avg(t); if (exact) t.loc = r.own ? r.v : null; else if (num(t.loc) === null && r.own && r.v !== null) t.loc = r.v; });
    var dv = avg({});
    if (exact) d.loc = dv.v; else if (num(d.loc) === null && dv.v !== null) d.loc = dv.v;
    a.locationMode = 'single';
    return a;
  }

  function calcTree(t, a) {
    var ed = edition(a);
    var c = { id: t.id, ed: ed, method: null, steps: [], missing: [], warn: [], raw: null, value: null, basic: null };
    function step(label, fx, res) { c.steps.push({ label: label, fx: fx, res: res }); }
    var sp = null;
    (a.species || []).forEach(function (s) { if (s.id === t.sp) sp = s; });
    c.sp = sp;
    var mode = a.sizeMode || 'dbh';
    var size = parseSize(t.size, mode);
    c.size = size; c.d = size.d; c.area = size.area;
    if (!sp) c.missing.push('species');
    if (size.empty) c.missing.push('trunk size');
    else if (size.bad) c.missing.push('trunk size (not a number)');

    // Ratings
    var C = rating(t, a, 'cond'); c.C = C.v;
    if (ed === '9') {
      c.S = sp ? num(sp.rating && sp.rating.pct) : null;
      if ((a.locationMode || 'parts') === 'single') {
        c.L = rating(t, a, 'loc').v;
      } else {
        var si = rating(t, a, 'site').v, co = rating(t, a, 'contrib').v, pl = rating(t, a, 'place').v;
        c.site = si; c.contrib = co; c.place = pl;
        c.L = si !== null && co !== null && pl !== null ? (si + co + pl) / 3 : null;
      }
    } else {
      var F = rating(t, a, 'func').v, E = rating(t, a, 'ext').v;
      c.F = F === null ? 100 : F; c.E = E === null ? 100 : E;
    }

    var base = sp ? baseRow(sp) : null;
    var inst = sp ? (num(sp.install) || 0) : 0;
    c.install = inst;
    if (sp && !base && !(sp.unitMode === 'manual' && num(sp.unitManual) > 0)) c.missing.push('replacement tree cost for ' + (sp.common || 'this species'));

    // Which method applies
    // A tree set to Auto follows the method chosen for its species, if one was chosen.
    var want = t.method || 'auto', method = null;
    if (want === 'auto' && sp && (sp.method === 'formula' || sp.method === 'replace')) want = sp.method;
    if (size.d !== null) {
      if (want === 'formula' || want === 'replace') method = want;
      else if (base && size.d <= base.max + 1e-9) method = 'replace';
      else method = (a.oversize === 'largest') ? 'replace' : 'formula';
    }
    c.method = method;
    c.methodName = method === null ? '' : ed === '9'
      ? (method === 'formula' ? 'Trunk Formula Method' : 'Replacement Cost Method')
      : (method === 'formula' ? 'Trunk Formula Technique' : 'Direct replacement cost');

    // Size steps
    if (size.d !== null) {
      if (mode === 'area') step('Trunk area as entered', size.entered.length > 1 ? size.entered.map(function (x) { return fmt(x, 2); }).join(' + ') : '', fmt(size.area, 2) + ' sq in');
      else {
        if (mode === 'circ') step('Diameter from circumference', size.entered.map(function (x) { return fmt(x, 2) + ' ÷ 3.1416'; }).join(', '), size.stems.map(function (x) { return fmt(x, 2); }).join(', ') + ' in');
        if (size.stems.length > 1) step('Trunk area, all stems', size.stems.map(function (x) { return '0.7854 × ' + fmt(x, 2) + '²'; }).join(' + '), fmt(size.area, 2) + ' sq in');
        else step('Trunk area', '0.7854 × ' + fmt(size.d, 2) + '²', fmt(size.area, 2) + ' sq in');
      }
    }

    var areaUsed = size.area; c.adjusted = false;
    if (ed === '9' && method === 'formula' && size.d !== null && a.ata !== false) {
      // Adjust any single stem over 30 inches; for an area typed in directly, use the equivalent diameter.
      var stems = size.stems.length ? size.stems : [size.d], adj = 0, any = false;
      stems.forEach(function (d) { if (d > 30) { adj += ATA9(d); any = true; } else adj += TA(d); });
      if (any) {
        areaUsed = adj; c.adjusted = true;
        step('Adjusted trunk area (over 30 in)', stems.filter(function (d) { return d > 30; }).map(function (d) { return '−0.335 × ' + fmt(d, 2) + '² + 69.3 × ' + fmt(d, 2) + ' − 1087'; }).join(' ; '), fmt(areaUsed, 2) + ' sq in');
        if (stems.length > 1 || mode === 'area') c.warn.push('Adjusted trunk area was applied from ' + (mode === 'area' ? 'the equivalent diameter of the area entered' : 'each stem over 30 inches') + '. Check this against the Guide.');
      }
    }
    c.areaUsed = areaUsed;

    var haveRatings9 = c.S !== null && c.S !== undefined && c.C !== null && c.L !== null && c.L !== undefined;
    if (ed === '9') {
      if (sp && (c.S === null || c.S === undefined)) c.missing.push('species rating for ' + (sp.common || 'this species'));
      if (c.C === null) c.missing.push('condition rating');
      if (c.L === null || c.L === undefined) c.missing.push('location rating');
    } else if (c.C === null && !(method === 'replace' && a.depreciateReplacement === false)) c.missing.push('condition rating');

    if (method === 'formula' && sp && size.d !== null) {
      var uc = unitCost(sp);
      if (!uc) { if (c.missing.join().indexOf('replacement tree cost') < 0) c.missing.push('unit cost for ' + (sp.common || 'this species')); }
      else {
        c.unit = uc.unit;
        if (uc.mode === 'manual') step('Unit cost', 'entered by the appraiser', money(uc.unit, 2) + ' per sq in');
        else {
          step('Replacement tree', fmt(uc.row.mid, 2) + ' in' + (uc.row.min !== uc.row.max ? ' (middle of ' + fmt(uc.row.min, 2) + '–' + fmt(uc.row.max, 2) + ')' : '') + (uc.row.source ? ', ' + uc.row.source : ''), money(uc.row.cost));
          step('Replacement trunk area', '0.7854 × ' + fmt(uc.row.mid, 2) + '²', fmt(uc.ta, 3) + ' sq in');
          step('Unit cost', money(uc.cost) + (uc.mode === 'installed' ? ' (installed)' : '') + ' ÷ ' + fmt(uc.ta, 3) + ' sq in', money(uc.unit, 2) + ' per sq in');
        }
        if (ed === '9') {
          var taR = base ? TA(base.mid) : 0, itc = (base ? base.cost : 0) + inst;
          c.taR = taR; c.itc = itc;
          var incr = areaUsed - taR;
          if (incr < 0) { incr = 0; c.warn.push('The replacement tree is as large as this tree. The Replacement Cost Method is usually the better fit.'); }
          c.incr = incr;
          step('Trunk area increase', fmt(areaUsed, 2) + ' − ' + fmt(taR, 3), fmt(incr, 2) + ' sq in');
          step('Installed replacement cost', money(base ? base.cost : 0) + (inst ? ' + ' + money(inst) + ' installation' : ''), money(itc));
          c.basic = incr * uc.unit + itc;
          step('Basic tree cost', fmt(incr, 2) + ' × ' + money(uc.unit, 2) + ' + ' + money(itc), money(c.basic));
        } else {
          c.basic = size.area * uc.unit;
          step('Basic cost', fmt(size.area, 2) + ' sq in × ' + money(uc.unit, 2), money(c.basic));
          if (base && size.d <= base.max + 1e-9) c.warn.push('The replacement tree is as large as this tree. Direct replacement cost is usually the better fit.');
        }
      }
    } else if (method === 'replace' && sp && size.d !== null) {
      var fx = fixedRow(sp), row = fx || rowFor(sp, size.d);
      if (row) {
        if (fx && size.d < fx.min - 1e-9) c.warn.push('The replacement tree chosen for this species (' + fmt(fx.min, 2) + (fx.min !== fx.max ? '–' + fmt(fx.max, 2) : '') + ' in) is larger than this tree.');
        c.row = row; c.itc = row.cost + inst; c.fixed = !!fx;
        step('Replacement tree', fmt(row.min, 2) + (row.min !== row.max ? '–' + fmt(row.max, 2) : '') + ' in' + (row.source ? ', ' + row.source : ''), money(row.cost));
        if (inst) step('Installed replacement cost', money(row.cost) + ' + ' + money(inst) + ' installation', money(c.itc));
        c.basic = c.itc;
        if (size.d > row.max + 1e-9) { c.capped = true; c.warn.push('Valued at the largest listed replacement (' + fmt(row.max, 2) + ' in), which is smaller than this tree.'); }
        if (row.ltd) c.warn.push('The replacement size used is marked limited on the price sheet. Consider whether it is commonly available.');
      }
    }
    if (method === 'formula' && base && base.ltd) c.warn.push('The replacement size used for the unit cost is marked limited on the price sheet. Consider whether it is commonly available.');

    if (c.basic !== null) {
      if (ed === '9') {
        if (haveRatings9) {
          c.factor = (c.S / 100) * (c.C / 100) * (c.L / 100);
          if (c.site !== undefined && c.site !== null) step('Location rating', '(' + pct(c.site) + ' + ' + pct(c.contrib) + ' + ' + pct(c.place) + ') ÷ 3', pct(c.L));
          c.raw = c.basic * c.factor;
          step('Appraised value', money(c.basic) + ' × species ' + pct(c.S) + ' × condition ' + pct(c.C) + ' × location ' + pct(c.L), money(c.raw, 2));
        }
      } else if (method === 'replace' && a.depreciateReplacement === false) {
        c.factor = 1; c.raw = c.basic;
        step('Appraised value', 'replacement cost, not depreciated', money(c.raw, 2));
      } else if (c.C !== null) {
        c.factor = (c.C / 100) * (c.F / 100) * (c.E / 100);
        c.raw = c.basic * c.factor;
        step('Appraised value', money(c.basic) + ' × condition ' + pct(c.C) + ' × functional ' + pct(c.F) + ' × external ' + pct(c.E), money(c.raw, 2));
      }
    }
    if (c.raw !== null) {
      var rule = roundRule(a);
      c.value = roundValue(c.raw, rule);
      if (Math.abs(c.value - c.raw) > 0.004) step('Rounded', rule === 'guide9' ? (c.raw >= 5000 ? 'nearest $100 ($5,000 or more)' : 'nearest $10 (under $5,000)') : 'nearest ' + money(num(rule)), money(c.value));
    }
    var st = num(t.stated);
    if (st !== null) { c.stated = st; if (c.value !== null) c.diff = c.value - st; }
    return c;
  }

  function lineAmount(x) {
    var q = num(x.qty), e = num(x.each), a = num(x.amt);
    if (q !== null && e !== null) return q * e;
    return a;
  }

  function calcAppraisal(a) {
    var rows = (a.trees || []).map(function (t) { return calcTree(t, a); });
    var trees = 0, done = 0, missing = 0, byMethod = {}, adjusted = 0, capped = 0, mismatches = 0;
    rows.forEach(function (c) {
      if (c.value !== null) { trees += c.value; done++; byMethod[c.methodName] = (byMethod[c.methodName] || 0) + 1; }
      else missing++;
      if (c.adjusted) adjusted++;
      if (c.capped) capped++;
      if (c.diff !== undefined && Math.abs(c.diff) > 2) mismatches++; // within $2 is hand rounding, not an error
    });
    var lines = 0, lineRows = (a.lines || []).map(function (x) { var v = lineAmount(x); if (v !== null) lines += v; return { id: x.id, amount: v }; });
    return { rows: rows, trees: trees, lines: lines, lineRows: lineRows, total: trees + lines, done: done, n: rows.length, missing: missing, byMethod: byMethod, adjusted: adjusted, capped: capped, mismatches: mismatches };
  }

  // The same trees worked out under each edition and method, for a side-by-side comparison.
  var APPROACHES = [
    { key: '9f', ed: '9', method: 'formula', name: '9th edition, Trunk Formula Method', short: '9th ed. Trunk Formula' },
    { key: '9r', ed: '9', method: 'replace', name: '9th edition, Replacement Cost Method', short: '9th ed. Replacement Cost' },
    { key: '10f', ed: '10', method: 'formula', name: '10th edition, Trunk Formula Technique', short: '10th ed. Trunk Formula' },
    { key: '10r', ed: '10', method: 'replace', name: '10th edition, direct replacement cost', short: '10th ed. Replacement' }
  ];
  function approach(key) { for (var i = 0; i < APPROACHES.length; i++) if (APPROACHES[i].key === key) return APPROACHES[i]; return null; }
  function compareKeys(a) { var c = (a && a.compare) || {}; return APPROACHES.filter(function (p) { return !!c[p.key]; }).map(function (p) { return p.key; }); }
  // A copy of the appraisal with the edition set and every tree held to one method. Nothing in the original changes.
  function variant(a, key) {
    var p = approach(key), v = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) v[k] = a[k];
    v.edition = p.ed;
    if (edition(a) !== p.ed) v.rounding = p.ed === '9' ? 'guide9' : 100;      // the other edition keeps its own usual rounding
    v.trees = (a.trees || []).map(function (t) { var c = {}, j; for (j in t) if (Object.prototype.hasOwnProperty.call(t, j)) c[j] = t[j]; c.method = p.method; return c; });
    return v;
  }
  function compare(a, keys) {
    var out = { keys: keys || compareKeys(a), by: {} };
    out.keys.forEach(function (k) { var v = variant(a, k); out.by[k] = { a: v, A: calcAppraisal(v) }; });
    return out;
  }

  // ---------- the ways one species can be valued ----------
  //   auto   replacement cost where a listed tree is as large as the subject tree, trunk formula otherwise
  //   near   replacement cost, each tree at the nearest listed size
  //   r<i>   replacement cost, every tree at replacement row i
  //   f<i>   trunk formula with replacement row i as the base price
  //   fm     trunk formula with the unit cost typed in by the appraiser
  // choose() applies one of these to a species; choiceOf() says which one a species is set to.
  function choose(sp, key) {
    var rows = sp.repl || (sp.repl = []), i = +String(key).slice(1);
    rows.forEach(function (r) { r.fixed = false; });
    if (key === 'auto') sp.method = 'auto';
    else if (key === 'near') sp.method = 'replace';
    else if (key === 'fm') { sp.method = 'formula'; sp.unitMode = 'manual'; }
    else if (key.charAt(0) === 'r' && rows[i]) { sp.method = 'replace'; rows[i].fixed = true; }
    else if (key.charAt(0) === 'f' && rows[i]) { sp.method = 'formula'; rows.forEach(function (r, k) { r.base = k === i; }); if (sp.unitMode === 'manual') sp.unitMode = 'tree'; }
    return sp;
  }
  function choiceOf(sp) {
    var m = (sp && sp.method) || 'auto', rows = (sp && sp.repl) || [];
    if (m === 'replace') { for (var i = 0; i < rows.length; i++) if (rows[i].fixed && parseRange(rows[i].size) && num(rows[i].cost) !== null) return 'r' + i; return 'near'; }
    if (m === 'formula') { if (sp.unitMode === 'manual') return 'fm'; var b = baseAt(sp); return b < 0 ? 'auto' : 'f' + b; }
    return 'auto';
  }
  // Every option for one species, each worked out on a copy of the appraisal holding only that species' trees. Nothing changes.
  function options(a, spId) {
    var sp = null; (a.species || []).forEach(function (s) { if (s.id === spId) sp = s; });
    if (!sp) return null;
    var rows = sp.repl || [], keys = [{ key: 'auto', method: 'auto' }], inst = num(sp.install) || 0, any = false;
    rows.forEach(function (r, i) { var g = parseRange(r.size), c = num(r.cost); if (g && c !== null && c > 0) any = true; });
    if (any) keys.push({ key: 'near', method: 'replace' });
    rows.forEach(function (r, i) {
      var g = parseRange(r.size), c = num(r.cost); if (!g || c === null || !(c > 0)) return;
      keys.push({ key: 'r' + i, method: 'replace', row: i }); keys.push({ key: 'f' + i, method: 'formula', row: i });
    });
    if (num(sp.unitManual) > 0) keys.push({ key: 'fm', method: 'formula', manual: true });
    var mine = (a.trees || []).filter(function (t) { return t.sp === spId; });
    function copy(o) { var c = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
    var list = keys.map(function (o) {
      var s2 = copy(sp); s2.repl = rows.map(copy); choose(s2, o.key);
      var a2 = copy(a); a2.species = (a.species || []).map(function (s) { return s.id === spId ? s2 : s; }); a2.trees = mine; a2.lines = [];
      var A = calcAppraisal(a2), u = o.method === 'formula' ? unitCost(s2) : null;
      o.total = A.trees; o.done = A.done; o.n = A.n; o.values = A.rows.map(function (c) { return c.value; }); o.capped = A.capped;
      if (o.row !== undefined) { var r = rows[o.row], g = parseRange(r.size); o.size = r.size; o.cost = num(r.cost); o.installed = o.cost + inst; o.source = r.source || ''; o.ltd = !!r.ltd; o.perSqIn = o.cost / TA(g.mid); }
      if (u) o.unit = u.unit;
      return o;
    });
    return { sp: sp, current: choiceOf(sp), n: mine.length, own: mine.filter(function (t) { return t.method && t.method !== 'auto'; }).length, list: list };
  }

  root.Engine = {
    choose: choose, choiceOf: choiceOf, options: options, fixedRow: fixedRow, baseAt: baseAt,
    APPROACHES: APPROACHES, approach: approach, compareKeys: compareKeys, variant: variant, compare: compare,
    K: K, num: num, TA: TA, ATA9: ATA9, parseNumber: parseNumber, parseSize: parseSize, parseRange: parseRange,
    replRows: replRows, baseRow: baseRow, rowFor: rowFor, unitCost: unitCost, oneLocation: oneLocation, roundValue: roundValue, roundRule: roundRule,
    rating: rating, edition: edition, calcTree: calcTree, calcAppraisal: calcAppraisal, lineAmount: lineAmount,
    money: money, fmt: fmt, pct: pct
  };
})(typeof window !== 'undefined' ? window : globalThis);
