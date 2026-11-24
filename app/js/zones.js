/* Expert Report: tree protection during construction. Pure functions, no DOM.
 * Works out a protection zone for each tree by a published method the arborist chooses, a structural root zone,
 * how much of the protection zone a planned disturbance takes, and how far away to tunnel.
 * Wording here is original. Every figure names where it was read; several were read from a reproduction, not the original,
 * and say so, because the arborist has to be able to cite them. */
(function (root) {
  'use strict';
  var FT = 3.28084; // feet in a metre

  // Feet of radius per inch of trunk diameter, by species tolerance and relative age.
  var MC = { good: { young: 0.5, mature: 0.75, over: 1.0 }, moderate: { young: 0.75, mature: 1.0, over: 1.25 }, poor: { young: 1.0, mature: 1.25, over: 1.5 } };
  // Trunk diameters of radius, by species tolerance and relative age. Differs from the table above in two cells.
  var ISA = { good: { young: 6, mature: 8, over: 12 }, moderate: { young: 8, mature: 12, over: 15 }, poor: { young: 12, mature: 15, over: 18 } };
  var TOL = [['good', 'Good'], ['moderate', 'Moderate'], ['poor', 'Poor']];
  var AGE = [['young', 'Young'], ['mature', 'Mature'], ['over', 'Overmature']];
  var AS4970 = 'Standards Australia. 2025. AS 4970:2025 Protection of trees on development sites (replaces AS 4970-2009).';
  var METHODS = {
    isa: { name: 'ISA best management practices: trunk diameters by species tolerance and tree age',
      short: 'the trunk diameter method of the ISA best management practices, which sets the radius as a number of trunk diameters according to the tolerance of the species to construction and the relative age of the tree',
      hint: 'Radius in trunk diameters: good tolerance 6 (young), 8 (mature), 12 (overmature); moderate 8, 12, 15; poor 12, 15, 18.',
      source: 'Fite, K. and E. T. Smiley. Best Management Practices: Managing Trees During Construction. International Society of Arboriculture.',
      seen: 'Table read from the Illinois Urban Manual, Practice Standard 990A (2017), which credits the ISA publication. Check it against your copy; a third edition came out in 2023.' },
    bmp: { name: 'Matheny and Clark: feet per inch by species tolerance and tree age',
      short: 'the trunk diameter method of Matheny and Clark, which sets the radius in feet per inch of trunk diameter according to the tolerance of the species to construction and the relative age of the tree',
      hint: 'Feet of radius per inch of trunk diameter: good tolerance 0.5 (young), 0.75 (mature), 1.0 (overmature); moderate 0.75, 1.0, 1.25; poor 1.0, 1.25, 1.5.',
      source: 'Matheny, N. and J. Clark. 1998. Trees and Development: A Technical Guide to Preservation of Trees During Land Development. International Society of Arboriculture.',
      seen: 'Figures read from Colorado State University Extension, CMG GardenNotes #652, Table 3, which prints them without naming the book. Check the book before you cite it.' },
    ft1: { name: '1 foot of radius for each inch of trunk diameter', short: 'a radius of 1 foot for each inch of trunk diameter',
      source: 'City of Austin, Texas. Environmental Criteria Manual, section 3.5.2 (as amended 2022). Also: ISA Texas Chapter. 2012. Best Management Practices for Tree Protection.', seen: 'Both read directly.' },
    ft125: { name: '1.25 feet of radius for each inch of trunk diameter', short: 'a radius of 1.25 feet for each inch of trunk diameter',
      source: 'Mississippi State University Extension. Publication 2339 (revised 2025), after Coder 1996. Also: NC State Extension. AG-685 (2019, revised 2024).', seen: 'Mississippi State read directly; NC State from a summary of the page.' },
    ft15: { name: '1.5 feet of radius for each inch of trunk diameter', short: 'a radius of 1.5 feet for each inch of trunk diameter',
      source: 'Mississippi State University Extension. Publication 2339 (revised 2025), for sensitive, old or unhealthy trees. Also: Colorado State University Extension, CMG GardenNotes #652.', seen: 'Mississippi State read directly; Colorado State from a summary of the page.' },
    bs5837: { name: 'BS 5837 (United Kingdom): 12 times the stem diameter, 15 m at most', short: 'the root protection area of British Standard 5837, a radius of 12 times the stem diameter up to a maximum of 15 metres',
      source: 'British Standards Institution. 2012. BS 5837:2012 Trees in relation to design, demolition and construction. Recommendations.', seen: 'Read from a full copy lodged in a planning appeal file.' },
    as4970: { name: 'AS 4970 (Australia): 12 times the trunk diameter, between 2 m and 15 m', short: 'the notional root zone of Australian Standard 4970, a radius of 12 times the trunk diameter, no less than 2 metres and no more than 15 metres',
      source: AS4970, seen: 'Definitions read from the publisher’s preview; the limits from an arborist’s report that quotes the standard.' },
    custom: { name: 'Your own figure, in feet per inch of trunk diameter', short: 'a radius set by the arborist for this site', source: '',
      seen: 'ANSI A300 (Part 5) 2012, clause 54.7.1.1, says to specify 6 to 18 times the trunk diameter, which is 0.5 to 1.5 feet per inch.' }
  };
  function methodOf(p) { var m = p && p.method; return METHODS[m] ? m : 'bmp'; } // cases saved before the ISA table was added keep the figures they were made with
  function byTable(p) { var m = methodOf(p); return m === 'isa' || m === 'bmp'; }

  function num(v) { if (v === null || v === undefined || v === '') return null; var n = parseFloat(String(v).replace(/[,%\s]/g, '')); return isFinite(n) ? n : null; }
  function fmt(v, d) { return v === null || v === undefined || !isFinite(v) ? '—' : (+v.toFixed(d === undefined ? 1 : d)).toLocaleString('en-US', { maximumFractionDigits: d === undefined ? 1 : d }); }
  // A trunk diameter as typed. Several stems, typed as 21+24, combine as the square root of the sum of the squares (the BS 5837 rule for two to five stems).
  function diameter(v) {
    var parts = String(v === null || v === undefined ? '' : v).replace(/["”]/g, '').split(/\s*[+&]\s*/).map(num);
    if (!parts.length || parts.some(function (x) { return x === null || !(x > 0); })) return { d: null, stems: [] };
    return { d: parts.length === 1 ? parts[0] : Math.sqrt(parts.reduce(function (s, x) { return s + x * x; }, 0)), stems: parts };
  }

  // Protection zone radius in feet for one tree under the case's method.
  function radius(t, p) {
    var d = diameter(t.dbh).d, m = methodOf(p);
    if (d === null) return { r: null, missing: 'trunk diameter' };
    if (m === 'isa' || m === 'bmp') {
      var T = m === 'isa' ? ISA : MC;
      if (!t.tol || !t.age || !T[t.tol] || !T[t.tol][t.age]) return { r: null, missing: !t.tol || !T[t.tol] ? 'species tolerance' : 'tree age' };
      return m === 'isa' ? { r: d * T[t.tol][t.age] / 12, mult: T[t.tol][t.age], unit: 'trunk diameters' } : { r: d * T[t.tol][t.age], mult: T[t.tol][t.age], unit: 'feet per inch' };
    }
    if (m === 'ft1') return { r: d };
    if (m === 'ft125') return { r: d * 1.25 };
    if (m === 'ft15') return { r: d * 1.5 };
    if (m === 'custom') { var k = num(p.mult); return k !== null && k > 0 ? { r: d * k } : { r: null, missing: 'your feet-per-inch figure' }; }
    var r = d; // 12 x diameter is one foot of radius per inch of diameter
    if (m === 'bs5837') return r > 15 * FT ? { r: 15 * FT, capped: 'the 15 m maximum' } : { r: r };
    return r > 15 * FT ? { r: 15 * FT, capped: 'the 15 m maximum' } : r < 2 * FT ? { r: 2 * FT, capped: 'the 2 m minimum' } : { r: r };
  }
  // Structural root zone radius (feet), AS 4970: (D x 50)^0.42 x 0.64 metres with D in metres, and 1.5 m for small trunks.
  function srz(dbh) { var d = diameter(dbh).d; if (d === null) return null; return Math.max(Math.pow(d * 0.0254 * 50, 0.42) * 0.64, 1.5) * FT; }
  // Share of a circle of radius r cut off by a straight edge x from the centre.
  function segment(r, x) { if (!(r > 0)) return 0; if (x >= r) return 0; if (x <= -r) return 1; return (r * r * Math.acos(x / r) - x * Math.sqrt(r * r - x * x)) / (Math.PI * r * r); }
  // How far from the trunk to tunnel and how deep, from the Arbor Day Foundation chart. Sources disagree for trees under 6 inches.
  function tunnel(dbh) {
    var d = diameter(dbh).d; if (d === null) return null;
    return { dist: d > 19 ? 15 : d > 14 ? 12 : d > 9 ? 10 : 5, depth: d >= 12 ? 36 : 24, small: d < 6 };
  }

  function calcTree(t, p) {
    var z = radius(t, p), dd = diameter(t.dbh), out = { r: z.r, mult: z.mult, unit: z.unit, capped: z.capped, missing: z.missing, d: dd.d, stems: dd.stems, area: null, srz: srz(t.dbh), tunnel: tunnel(t.dbh), encs: [], total: null, tier: null };
    if (z.r === null) return out;
    out.area = Math.PI * z.r * z.r;
    var total = 0, any = false, inSrz = false, closest = null;
    (t.encs || []).forEach(function (e) {
      var v = num(e.value), pct = null, note = '';
      if (v !== null) {
        if ((e.kind || 'line') === 'line') { pct = segment(z.r, v) * 100; if (closest === null || v < closest) closest = v; if (out.srz !== null && v < out.srz) inSrz = true; if (v >= z.r) note = 'outside the zone'; }
        else if (e.kind === 'area') pct = Math.min(100, v / out.area * 100);
        else pct = Math.min(100, Math.max(0, v));
      }
      if (pct !== null) { total += pct; any = true; }
      out.encs.push({ pct: pct, note: note });
    });
    out.total = any ? Math.min(100, total) : null; out.closest = closest; out.inSrz = inSrz;
    if (closest !== null && dd.d) out.closestX = closest * 12 / dd.d; // nearest edge, in trunk diameters
    // AS 4970:2025 tiers: 10% or less is minor, over 10% up to 20% moderate, over 20% or anything in the structural root zone major.
    if (out.total !== null && (out.total > 0 || inSrz)) out.tier = inSrz || out.total > 20 ? 'major' : out.total > 10 ? 'moderate' : 'minor';
    return out;
  }

  function label(t, i) { return String(t.label || '').trim() || String(i + 1); }
  function cap(s) { return s ? (s === 'over' ? 'Overmature' : s.charAt(0).toUpperCase() + s.slice(1)) : ''; }
  function table(p) {
    var tbl = byTable(p), rows = [];
    ((p && p.trees) || []).forEach(function (t, i) {
      var c = calcTree(t, p), r = [label(t, i), t.species || '', c.d !== null ? c.stems.map(function (x) { return fmt(x, 1); }).join(' + ') : ''];
      if (tbl) r.push(cap(t.tol), cap(t.age));
      r.push(c.r !== null ? fmt(c.r, 1) : 'incomplete', c.area !== null ? fmt(c.area, 0) : '—', c.srz !== null ? fmt(c.srz, 1) : '—', c.total !== null ? fmt(c.total, 0) + '%' : '—');
      rows.push(r);
    });
    var head = ['Tree', 'Species', 'Trunk diameter (in)'];
    if (tbl) head.push('Tolerance', 'Age');
    head.push('Protection zone radius (ft)', 'Zone area (sq ft)', 'Structural root zone radius (ft)', 'Zone disturbed');
    return tbl ? { head: head, rows: rows, widths: [600, 1400, 860, 1020, 1000, 1080, 1000, 1260, 1140], align: ['l', 'l', 'r', 'l', 'l', 'r', 'r', 'r', 'r'], size: 8 }
      : { head: head, rows: rows, widths: [760, 2300, 1100, 1400, 1300, 1400, 1100], align: ['l', 'l', 'r', 'r', 'r', 'r', 'r'], size: 8 };
  }
  function methodText(p) {
    var m = methodOf(p), M = METHODS[m], k = num(p && p.mult);
    var out = ['Each tree protection zone is a circle centered on the trunk. Its radius was set by ' + M.short + (m === 'custom' && k ? ' (' + k + ' feet per inch of trunk diameter)' : '') + '.'];
    if (((p && p.trees) || []).some(function (t) { return diameter(t.dbh).stems.length > 1; })) out.push('For a tree with more than one stem, the stem diameters were combined as the square root of the sum of their squares.');
    out.push('The structural root zone is the smaller area close to the trunk where the roots hold the tree upright. Its radius was calculated from the trunk diameter with the formula in Australian Standard 4970. Where a disturbance is described by its distance from the trunk, the share of the protection zone it takes was calculated as the part of the circle beyond a straight edge at that distance.');
    return out;
  }
  function sources(p) { var m = methodOf(p), out = []; if (METHODS[m].source) out.push(METHODS[m].source); if (m !== 'as4970') out.push(AS4970 + ' Structural root zone formula and encroachment classes.'); return out; }

  root.Zones = { FT: FT, MC: MC, ISA: ISA, TOL: TOL, AGE: AGE, METHODS: METHODS, AS4970: AS4970, methodOf: methodOf, byTable: byTable, num: num, fmt: fmt, diameter: diameter, radius: radius, srz: srz, segment: segment,
    tunnel: tunnel, calcTree: calcTree, label: label, table: table, methodText: methodText, sources: sources };
})(typeof window !== 'undefined' ? window : globalThis);
