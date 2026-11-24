/* Expert Report: the Preservation tab of a case, and what it adds to the report.
 * Zones.js does the arithmetic. This file holds the screen, the recommendation wording, and the published guidance shown beside it.
 * The guidance was checked against sources on 2026-11-13; each line names its source, and says when it was read from a copy. */
(function () {
  'use strict';
  const A = App, S = A.S, $ = A.$, esc = A.esc, uid = A.uid, field = A.field, Z = Zones;

  // Recommendation wording is original and meant to be edited. Square brackets hold a figure the arborist sets for the site;
  // the report check flags any that are left.
  const RECS = [
    ['Before work starts', [
      ['meet', 'Hold a meeting on site with the contractor and the project arborist before any clearing or grading, to walk the tree protection zones and agree on access routes, storage areas and wash-out areas.'],
      ['fence', 'Install tree protection fencing at the edge of each tree protection zone before any equipment or materials arrive. Use chain-link or comparably rigid fencing at least [4 to 6] feet tall on posts set in the ground, and keep it in place until final grading and landscaping are finished.'],
      ['signs', 'Post signs on the fencing that identify the tree protection zone and state that entry, storage and dumping are not allowed.'],
      ['prune', 'Have any pruning needed for equipment or building clearance done by a licensed arborist before work begins, not by equipment operators.'],
      ['mulch', 'Spread wood chip mulch [3 to 6] inches deep over the tree protection zone, kept off the trunk, to hold moisture and cushion the soil.'],
      ['water', 'Water the trees thoroughly before construction begins if conditions are dry.']]],
    ['During the work', [
      ['nostore', 'Do not store materials, park vehicles or equipment, stockpile soil, or dispose of concrete washout, fuel or chemicals inside the tree protection zone.'],
      ['nograde', 'Do not raise or lower the soil grade inside the tree protection zone.'],
      ['access', 'Where equipment must cross a tree protection zone, first lay wood chips [6 to 12] inches deep over the route, covered with plywood or ground mats to spread the load, and remove them by hand afterward.'],
      ['bore', 'Route underground utilities outside the tree protection zone. Where a line must pass through it, bore or tunnel beneath the roots rather than digging an open trench.'],
      ['expose', 'Where excavation inside the tree protection zone cannot be avoided, expose the roots first by hand digging or with an air or water excavation tool, so they can be assessed before any are cut.'],
      ['clean', 'Cut roots cleanly with a sharp saw back to sound tissue. Do not tear them with equipment or leave ragged or crushed ends.'],
      ['cover', 'Cover exposed roots promptly with damp burlap or soil and keep them moist until the excavation is backfilled.'],
      ['present', 'Have the project arborist on site whenever work takes place inside a tree protection zone, and before any root [2] inches or more in diameter is cut.'],
      ['monitor', 'Have the project arborist inspect the trees and the fencing regularly during construction and report what is found.']]],
    ['After the work', [
      ['fenceoff', 'Remove the fencing only after all construction, grading and landscape installation is finished.'],
      ['irrigate', 'Water the trees during dry periods for at least two growing seasons after construction.'],
      ['soil', 'Loosen compacted soil within the root zone using methods that do not cut roots, and maintain a layer of mulch.'],
      ['inspect', 'Inspect the trees each year for several years after construction. Decline from root loss can take years to appear.']]]
  ];
  const REC_TEXT = {}; RECS.forEach(g => g[1].forEach(r => { REC_TEXT[r[0]] = r[1]; }));
  const USUAL = ['meet', 'fence', 'signs', 'nostore', 'nograde', 'bore', 'clean', 'cover', 'present', 'fenceoff', 'irrigate', 'inspect'];

  // What the published guidance says. "Copy" means the figure was read from a reproduction of the source, not the source itself.
  const GUIDE = [
    ['Size of the zone', 'Specify a protection zone radius of 6 to 18 times the trunk diameter, depending on the species’ tolerance of root loss, its age and its health.', 'ANSI A300 (Part 5) 2012, clause 54.7.1.1. Read from a copy.'],
    ['Size of the zone', 'City of Austin: the critical root zone radius in feet equals the trunk diameter in inches. At least half of its area stays at natural grade. Within half that radius, only cut or fill of 4 inches or less. Within a quarter of it, no cut or fill.', 'City of Austin Environmental Criteria Manual 3.5.2, as amended December 2022. Read directly.'],
    ['How close roots can be cut', 'Cut roots as far from the trunk as practical. When roots are damaged within six trunk diameters, mitigation is to be recommended.', 'ANSI A300 (Part 8) 2013, clauses 84.5.1 and 84.5.5. Read from a copy. The six-diameter clause does not appear in the 2022 draft of the combined standard.'],
    ['How close roots can be cut', 'Keep the nearest cut five to six trunk diameters away where possible. Three diameters for a cut on one side only, and not where there is pavement on the other side, root decay or a lean. Avoid cutting roots over 3 inches.', 'Fite and Smiley 2018, Root Pruning, Bartlett Tree Research Laboratories technical report. Read directly.'],
    ['How close roots can be cut', 'In young willow oaks, the force needed to pull a tree over did not drop significantly until roots were cut closer than three trunk diameters. Recommendation: trench no closer than that, and be careful applying it to large trees.', 'Smiley 2008, Arboriculture & Urban Forestry 34(2):123–128. From a summary of the journal page.'],
    ['How close roots can be cut', 'In red maples, cutting within five trunk diameters on one side was more likely to cause instability.', 'Miesbauer, Koeser and Kane 2025, Arboriculture & Urban Forestry 51(1):94–102.'],
    ['How close roots can be cut', 'In live oaks, a trench on one side at six trunk diameters took about a quarter of the roots; cutting closer was not recommended, and symptoms after a cut at three diameters lasted more than a year.', 'Benson, Koeser and Morgenroth 2019. Read from a copy.'],
    ['How much root loss', 'Save a tree when 70% or more of its critical root area is protected. With 50 to 60% protected it has about an even chance. At 40% or less, remove it. Critical root area there means 1.25 feet of radius per inch of trunk diameter.', 'Coder 1996, as given in Mississippi State University Extension Publication 2339 (revised 2025). Read directly.'],
    ['How much root loss', 'Tolerant species may have up to 25% of the root zone area disturbed.', 'Colorado State University Extension, CMG GardenNotes #652. From a summary of the page.'],
    ['How much root loss', 'Australia: 10% or less of the zone, outside the structural root zone, is a minor encroachment. Over 10% and up to 20% is moderate, and the project arborist is to show how the tree stays viable. Over 20%, or anything inside the structural root zone, is major.', 'AS 4970:2025, as quoted in a July 2025 arborist’s report. The 2009 edition drew a single line at 10%.'],
    ['How much root loss', 'United Kingdom: new permanent hard surfacing over no more than 20% of the unsurfaced ground in the root protection area. Roots under 25 mm may be pruned; larger ones only after consulting an arboriculturist.', 'BS 5837:2012, clauses 7.4.2.3 and 7.2.3. Read from a copy.'],
    ['Tunneling', 'Tunnel at least 5 ft from the trunk for trees 6 to 9 inches in diameter, 10 ft for 10 to 14 inches, 12 ft for 15 to 19 inches and 15 ft for larger trees; at least 24 inches deep for trees under 12 inches and 36 inches for larger. Stop trenching when roots of 2 inches or more are met.', 'Arbor Day Foundation, Tree City USA Bulletin 35 (2010), chart credited to the Municipal Foresters of Northeast Illinois. Read directly. Sources differ for trees under 6 inches.'],
    ['Fencing and mulch', 'Fence height in published standards runs from at least 4 ft (ISA Texas Chapter 2012; Illinois Urban Manual 990A) to chain link at least 5 ft on steel posts (City of Austin) and 6 ft chain link (City of Tacoma). ANSI A300 Part 5 requires barriers before clearing, and warning signs, but gives no height.', 'Each read directly or from a copy.'],
    ['Fencing and mulch', 'Mulch inside the zone: 3 to 5 inches (Illinois Urban Manual), 4 to 6 inches (Mississippi State Extension), at least 6 inches (ISA Texas Chapter). Where equipment must cross: 6 to 12 inches of wood chips, or plywood or mats over at least 4 inches of chips (City of Tacoma); 8 to 12 inches on an unfenced zone (City of Austin).', 'Each read directly or from a copy.']
  ];

  // Tolerance of construction for trees common in south Louisiana, as rated in two published lists. c = Coder 2020 (g good, m medium, gm between); m = Mississippi State P2339.
  const TOLERANCE = [
    [['live oak', 'quercus virginiana'], 'gm', null], [['water oak', 'quercus nigra'], 'g', 'Resistant'], [['willow oak', 'quercus phellos'], 'gm', 'Resistant'],
    [['southern red oak', 'quercus falcata'], 'g', null], [['shumard oak', 'quercus shumardii'], 'g', 'Resistant'], [['southern magnolia', 'magnolia grandiflora'], 'm', 'Moderate'],
    [['bald cypress', 'baldcypress', 'taxodium distichum'], 'g', 'Resistant'], [['pecan', 'carya illinoinensis'], null, 'Resistant'], [['sweetgum', 'sweet gum', 'liquidambar styraciflua'], 'g', 'Moderate'],
    [['loblolly pine', 'pinus taeda'], 'g', 'Resistant'], [['american elm', 'ulmus americana'], 'm', 'Resistant'], [['sugarberry', 'hackberry', 'celtis laevigata'], 'g', 'Susceptible'],
    [['red maple', 'acer rubrum'], 'g', 'Resistant'], [['american sycamore', 'sycamore', 'platanus occidentalis'], 'g', 'Moderate'], [['river birch', 'betula nigra'], 'g', 'Resistant']
  ];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  // Returns what the two lists say about a species, and a suggested class: the more cautious of the two, or none when they are far apart.
  function tolerance(name) {
    const n = norm(name); if (!n) return null;
    const hit = TOLERANCE.find(t => t[0].some(x => norm(x) === n)); if (!hit) return null;
    const rank = { g: 0, gm: 1, m: 1, p: 2, Resistant: 0, Moderate: 1, Susceptible: 2 }, cls = ['good', 'moderate', 'poor'];
    const said = []; if (hit[1]) said.push('Coder (2020) rates it ' + ({ g: 'good', gm: 'good to medium', m: 'medium', p: 'poor' })[hit[1]]); if (hit[2]) said.push('Mississippi State Extension lists it as ' + hit[2].toLowerCase());
    const ranks = [hit[1], hit[2]].filter(Boolean).map(k => rank[k]), far = ranks.length === 2 && Math.abs(ranks[0] - ranks[1]) > 1;
    return { text: said.join('; ') + '.' + (far ? ' The two disagree, so choose from what you know of the species here.' : ''), suggest: far ? null : cls[Math.max.apply(null, ranks)] };
  }

  const pres = () => CaseUI.doc().preserve;
  const recText = (p, k) => (p.recText && p.recText[k] !== undefined && String(p.recText[k]).trim() ? p.recText[k] : REC_TEXT[k]);

  function flags(t, p, c) {
    const out = []; if (c.r === null) return out;
    const pc = 'About ' + Z.fmt(c.total, 0) + '% of the protection zone is disturbed. ';
    if (c.inSrz) out.push(['bad', 'An edge ' + Z.fmt(c.closest, 1) + ' ft from the trunk is inside the structural root zone (' + Z.fmt(c.srz, 1) + ' ft), where the roots hold the tree upright. Australian Standard 4970 treats any encroachment there as major.']);
    if (c.tier === 'major' && c.total > 20) out.push(['bad', pc + 'Australian Standard 4970 treats more than 20% as a major encroachment: the project arborist is to look at other designs or demonstrate that the tree will stay viable.']);
    else if (c.tier === 'moderate') out.push(['warn', pc + 'Australian Standard 4970 treats more than 10% and up to 20% as a moderate encroachment: the project arborist is to show how the tree will stay viable.']);
    else if (c.tier === 'minor') out.push(['ok', pc + 'Australian Standard 4970 treats 10% or less, outside the structural root zone, as a minor encroachment.']);
    if (c.closestX !== undefined && c.closestX < 3) out.push(['bad', 'The nearest edge is ' + Z.fmt(c.closestX, 1) + ' trunk diameters from the tree. Cuts closer than three trunk diameters reduced stability in pull tests (Smiley 2008), and three is the least Bartlett’s guideline allows, for a cut on one side only.']);
    else if (c.closestX !== undefined && c.closestX < 6) out.push(['warn', 'The nearest edge is ' + Z.fmt(c.closestX, 1) + ' trunk diameters from the tree. ANSI A300 Part 8 (2013) calls for mitigation when roots are damaged within six trunk diameters; Bartlett’s guideline prefers five to six.']);
    return out;
  }

  function tab(c) {
    const p = c.preserve, m = Z.methodOf(p), M = Z.METHODS[m], tbl = Z.byTable(p);
    const opt = (list, v) => '<option value=""></option>' + list.map(o => '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
    const groups = []; GUIDE.forEach(g => { if (groups.indexOf(g[0]) < 0) groups.push(g[0]); });
    return '<p class="sub" style="margin-bottom:12px">Set a protection zone for each tree, describe what the project will disturb, and tick the recommendations that go in the report.</p>' +
      '<div class="card" data-scope="cpres"><h2>The project</h2>' + field('What is planned near the trees', 'project', p.project, { area: true, rows: 2, ph: 'e.g. new driveway and a utility trench along the east side of the lot' }) +
      '<div class="grid2" style="margin-top:12px"><label class="f"><span>How the protection zone is set</span><select data-bind="method" data-rerender>' + Object.keys(Z.METHODS).map(k => '<option value="' + k + '"' + (m === k ? ' selected' : '') + '>' + Z.METHODS[k].name + '</option>').join('') + '</select></label>' +
      (m === 'custom' ? field('Feet of radius per inch of trunk diameter', 'mult', p.mult, { kind: 'num' }) : '') + '</div>' +
      (M.hint ? '<p class="hint" style="margin-top:8px">' + esc(M.hint) + '</p>' : '') + (M.source ? '<p class="hint" style="margin-top:6px">Source: ' + esc(M.source) + '</p>' : '') + '<p class="hint" style="margin-top:6px">' + esc(M.seen) + '</p></div>' +
      (p.trees || []).map((t, i) => { const tl = tbl ? tolerance(t.species) : null; return '<div class="card" data-scope="ptree" data-id="' + t.id + '"><div class="row"><h2 style="margin:0">Tree ' + esc(Z.label(t, i)) + '</h2><span class="sp"></span><button class="icon" data-act="pres-del-tree" data-id="' + t.id + '" title="Remove this tree" aria-label="Remove tree">✕</button></div>' +
        '<div class="grid2" style="margin-top:10px">' + field('Tree number or name', 'label', t.label, { ph: String(i + 1) }) + field('Species', 'species', t.species, { list: 'splist', rerender: true }) + field('Trunk diameter (in)', 'dbh', t.dbh, { help: 'Several stems as 21+24.' }) +
        (tbl ? '<label class="f"><span>Tolerance of the species to construction</span><select data-bind="tol">' + opt(Z.TOL, t.tol) + '</select>' + (tl ? '<small>' + esc(tl.text) + '</small>' : '<small>Not in the two lists on file. Rate it from what you know of the species.</small>') + '</label>' +
          '<label class="f"><span>Age of the tree</span><select data-bind="age">' + opt(Z.AGE, t.age) + '</select><small>Young is under about a quarter of the species’ expected life; overmature is past about three quarters.</small></label>' : '') + '</div>' +
        '<p class="unitline" data-out="pz:' + t.id + '"></p>' +
        '<h3>What will be disturbed</h3><table class="tbl"><thead><tr><th>What</th><th style="width:260px">Measured as</th><th class="n" style="width:120px">Figure</th><th class="n" style="width:150px">Share of the zone</th><th style="width:34px"></th></tr></thead><tbody>' +
        (t.encs || []).map(e => '<tr data-scope="penc" data-tree="' + t.id + '" data-id="' + e.id + '"><td><input class="c" data-bind="desc" value="' + esc(e.desc || '') + '" placeholder="e.g. utility trench, east side" aria-label="What is disturbed"></td>' +
          '<td><select class="c" data-bind="kind" aria-label="Measured as"><option value="line"' + ((e.kind || 'line') === 'line' ? ' selected' : '') + '>Straight edge: feet from the trunk</option><option value="area"' + (e.kind === 'area' ? ' selected' : '') + '>Area inside the zone: square feet</option><option value="pct"' + (e.kind === 'pct' ? ' selected' : '') + '>Percent of the zone</option></select></td>' +
          '<td class="n"><input class="c" data-bind="value" inputmode="decimal" value="' + esc(e.value === null || e.value === undefined ? '' : e.value) + '" aria-label="Figure"></td><td class="o n" data-out="pe:' + e.id + '"></td>' +
          '<td><button class="icon" data-act="pres-del-enc" data-tree="' + t.id + '" data-id="' + e.id + '" title="Remove this row" aria-label="Remove row">✕</button></td></tr>').join('') +
        '</tbody></table><div class="row" style="margin-top:8px"><button class="btn small" data-act="pres-add-enc" data-id="' + t.id + '">Add a disturbance</button></div>' +
        '<div data-out="pf:' + t.id + '" style="margin-top:8px"></div><div style="margin-top:10px">' + field('Notes on this tree', 'notes', t.notes, { area: true, rows: 2, ph: 'Condition, what was seen in the root zone, what you recommend for this tree' }) + '</div></div>'; }).join('') +
      '<div class="row" style="margin:14px 0"><button class="btn primary" data-act="pres-add-tree">Add a tree</button></div>' +
      '<div class="card"><div class="row"><h2 style="margin:0">Recommendations for the report</h2><span class="sp"></span><button class="btn small" data-act="pres-usual">Tick the usual ones</button></div><p class="hint" style="margin-top:6px">A figure in [square brackets] is yours to set for the site. The guidance below gives the published ranges.</p>' +
      RECS.map(g => '<h3>' + g[0] + '</h3>' + g[1].map(r => { const on = !!(p.recs && p.recs[r[0]]); return '<div class="sec" style="padding:8px 0"><label class="check"><input type="checkbox" data-rec="' + r[0] + '" ' + (on ? 'checked' : '') + '><span>' + (on ? '' : esc(recText(p, r[0]))) + '</span></label>' +
        (on ? '<textarea class="method" style="min-height:64px;margin:6px 0 0 26px;width:calc(100% - 26px)" data-rectext="' + r[0] + '" aria-label="Recommendation wording">' + esc(recText(p, r[0])) + '</textarea>' : '') + '</div>'; }).join('')).join('') +
      '<div style="margin-top:12px" data-scope="cpres">' + field('Other recommendations, one per line', 'recOther', p.recOther || '', { area: true, rows: 3 }) + '</div></div>' +
      '<div class="card"><h2>What the published guidance says</h2><p class="hint" style="margin-bottom:6px">For reference while you work. Each line names where it was read; check the source yourself before you cite it in a report.</p>' +
      groups.map(g => '<h3>' + g + '</h3><ul class="ref">' + GUIDE.filter(x => x[0] === g).map(x => '<li>' + esc(x[1]) + ' <span class="hint">' + esc(x[2]) + '</span></li>').join('') + '</ul>').join('') + '</div>';
  }

  function outputs(c, out) {
    const p = c.preserve;
    (p.trees || []).forEach(t => {
      const k = Z.calcTree(t, p);
      out['pz:' + t.id] = k.r === null ? 'Still needed: ' + esc(k.missing || 'trunk diameter') + '.'
        : 'Protection zone <b>' + Z.fmt(k.r, 1) + ' ft</b> radius' + (k.capped ? ' (' + k.capped + ')' : k.mult ? ' (' + k.mult + ' ' + k.unit + ')' : '') + ', ' + Z.fmt(k.area, 0) + ' sq ft. Structural root zone <b>' + Z.fmt(k.srz, 1) + ' ft</b> radius.' +
          (k.tunnel ? ' If a line must pass, tunnel at least <b>' + k.tunnel.dist + ' ft</b> from the trunk and ' + k.tunnel.depth + ' inches deep or more' + (k.tunnel.small ? ' (sources differ for trees this small)' : '') + '.' : '');
      (t.encs || []).forEach((e, i) => { const x = k.encs[i]; out['pe:' + e.id] = x && x.pct !== null ? (x.note ? x.note : Z.fmt(x.pct, x.pct < 10 ? 1 : 0) + '%') : ''; });
      out['pf:' + t.id] = flags(t, p, k).map(f => '<p class="note' + (f[0] === 'bad' ? ' miss' : '') + '"' + (f[0] === 'ok' ? ' style="background:var(--good-soft);color:var(--good)"' : '') + '>' + esc(f[1]) + '</p>').join('');
    });
  }

  // What the Preservation tab adds to the report.
  Z.reportBlocks = function (p, key, b, tbl, paras) {
    if (key === 'zones') {
      if (!(p.trees || []).length) return;
      paras(p.project).forEach(x => b.push(x));
      tbl(Z.table(p), '', b);
      Z.methodText(p).forEach(x => b.push({ t: 'p', text: x }));
      (p.trees || []).forEach((t, i) => {
        const k = Z.calcTree(t, p), parts = [];
        (t.encs || []).forEach((e, n) => { const x = k.encs[n]; if (!x || x.pct === null) return; const what = String(e.desc || 'a disturbance').trim();
          parts.push((e.kind || 'line') === 'line' ? what + ', ' + Z.fmt(Z.num(e.value), 1) + ' ft from the trunk' + (x.note ? ' (' + x.note + ')' : ', about ' + Z.fmt(x.pct, 0) + '% of the zone') : what + ', about ' + Z.fmt(x.pct, 0) + '% of the zone'); });
        const fl = flags(t, p, k).filter(f => f[0] !== 'ok').map(f => f[1]);
        if (parts.length || String(t.notes || '').trim()) {
          b.push({ t: 'p', text: 'Tree ' + Z.label(t, i) + (t.species ? ' (' + t.species + ')' : '') + (parts.length ? ': ' + parts.join('; ') + '.' + (k.total !== null && parts.length > 1 ? ' In all, about ' + Z.fmt(k.total, 0) + '% of the protection zone.' : '') : '.') + (fl.length ? ' ' + fl.join(' ') : '') });
          paras(t.notes).forEach(x => b.push(x));
        }
      });
      b.push({ t: 'p', text: 'Standards referred to:', keep: true, after: 60 }, { t: 'bullets', items: Z.sources(p) });
    } else if (key === 'recommendations') {
      RECS.forEach(g => { const items = g[1].filter(r => p.recs && p.recs[r[0]]).map(r => recText(p, r[0])); if (items.length) b.push({ t: 'p', text: g[0], bold: true, keep: true, after: 80 }, { t: 'bullets', items: items }); });
      const other = String(p.recOther || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (other.length) b.push({ t: 'bullets', items: other });
    }
  };
  Z.checks = function (p, has) {
    const out = [], trees = p.trees || [];
    if (has.zones && !trees.length) out.push({ level: 'warn', text: 'The protection zone section is on, but no trees are entered on the Preservation tab.' });
    const inc = trees.filter(t => Z.calcTree(t, p).r === null).length;
    if (inc) out.push({ level: 'warn', text: inc + (inc === 1 ? ' tree on the Preservation tab is' : ' trees on the Preservation tab are') + ' missing what is needed to set a protection zone.' });
    const ticked = Object.keys(p.recs || {}).filter(k => p.recs[k]);
    if (has.recommendations && !ticked.length && !String(p.recOther || '').trim()) out.push({ level: 'warn', text: 'The recommendations section is on, but nothing is ticked on the Preservation tab.' });
    const open = ticked.filter(k => /\[[^\]\n]{1,}\]/.test(recText(p, k))).length;
    if (open) out.push({ level: 'warn', text: open + (open === 1 ? ' recommendation still has' : ' recommendations still have') + ' a figure in square brackets to set on the Preservation tab.' });
    return out;
  };

  A.scopes.cpres = () => ({ obj: pres(), col: 'cases', id: CaseUI.doc().id });
  A.scopes.ptree = sc => ({ obj: pres().trees.find(t => t.id === sc.dataset.id), col: 'cases', id: CaseUI.doc().id });
  A.scopes.penc = sc => { const t = pres().trees.find(x => x.id === sc.dataset.tree); return { obj: t && t.encs.find(e => e.id === sc.dataset.id), col: 'cases', id: CaseUI.doc().id }; };
  Object.assign(A.ACT, {
    'pres-add-tree': () => { pres().trees.push({ id: uid(), label: '', species: '', dbh: '', tol: '', age: '', encs: [], notes: '' }); CaseUI.saveCase(); A.render(); },
    'pres-del-tree': b => { if (!A.armed(b)) return; const p = pres(); p.trees = p.trees.filter(t => t.id !== b.dataset.id); CaseUI.saveCase(); A.render(); },
    'pres-add-enc': b => { const t = pres().trees.find(x => x.id === b.dataset.id); t.encs = t.encs || []; t.encs.push({ id: uid(), desc: '', kind: 'line', value: null }); CaseUI.saveCase(); A.render(); },
    'pres-del-enc': b => { const t = pres().trees.find(x => x.id === b.dataset.tree); t.encs = t.encs.filter(e => e.id !== b.dataset.id); CaseUI.saveCase(); A.render(); },
    'pres-usual': () => { const p = pres(); p.recs = p.recs || {}; USUAL.forEach(k => { p.recs[k] = true; }); CaseUI.saveCase(); A.render(); }
  });
  document.addEventListener('change', e => {
    const el = e.target; if (!el.dataset || !el.dataset.rec || !CaseUI.doc()) return;
    const p = pres(); p.recs = p.recs || {}; p.recs[el.dataset.rec] = el.checked; CaseUI.saveCase(); A.render();
  });
  document.addEventListener('input', e => {
    const el = e.target; if (!el.dataset || !el.dataset.rectext || !CaseUI.doc()) return;
    const p = pres(); p.recText = p.recText || {}; p.recText[el.dataset.rectext] = el.value === REC_TEXT[el.dataset.rectext] ? '' : el.value; CaseUI.saveCase();
  });

  window.PreserveUI = { tab: tab, outputs: outputs, RECS: RECS, GUIDE: GUIDE, tolerance: tolerance, flags: flags,
    selfTest: function (d) { d.preserve.trees.push({ id: uid(), label: '1', species: 'Live oak', dbh: '30', tol: 'good', age: 'mature', encs: [{ id: uid(), desc: 'trench', kind: 'line', value: '12' }], notes: '' }); d.preserve.recs = { fence: true, bore: true };
      d.sections.push({ id: uid(), key: 'zones', title: 'Tree Protection Zones', on: true, text: '' }, { id: uid(), key: 'recommendations', title: 'Tree Preservation Recommendations', on: true, text: '' });
      const k = Z.calcTree(d.preserve.trees[0], d.preserve); return { method: Z.methodOf(d.preserve), radius: k.r, pct: Math.round(k.total * 10) / 10, srz: Math.round(k.srz * 10) / 10, tier: k.tier, tunnel: k.tunnel.dist }; } };
})();
