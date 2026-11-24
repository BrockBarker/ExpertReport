/* Expert Report: screens and interaction for the appraisal part.
 * State lives in S, every edit is written through Host, and all numbers come from Engine. */
(function () {
  'use strict';
  const E = Engine, R = Report, money = E.money, fmt = E.fmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  const S = { ready: false, appraisals: {}, sheets: {}, ratings: null, settings: null, cases: {}, apHome: {}, route: { view: 'cases' }, tape: null, saving: 0, err: null, info: null, modal: null };
  // Other files (cases, risk, preservation, the report) plug their screens in through App.
  const App = window.App = { S: S, views: {}, scopes: {}, changed: {}, after: {}, onRoute: null, boot: null, settingsExtra: null };

  // ---------- storage ----------
  const timers = {};
  function docOf(col, id) { return col === 'cases' ? (S.cases[id] && S.cases[id].doc) : col === 'appraisals' ? S.appraisals[id] : col === 'sheets' ? S.sheets[id] : id === 'ratings' ? S.ratings : S.settings; }
  function save(col, id, ms) { const k = col + '/' + id; clearTimeout(timers[k]); timers[k] = setTimeout(() => { delete timers[k]; push(col, id); }, ms === undefined ? 500 : ms); setStatus(); }
  function push(col, id) {
    const doc = docOf(col, id); if (!doc) return Promise.resolve();
    doc.updatedAt = Date.now(); S.saving++; setStatus();
    // A case and the appraisals filed in it are saved inside the case folder; everything else in the app's own library.
    const home = col === 'appraisals' && S.apHome[id] ? S.cases[S.apHome[id]] : null;
    const call = col === 'cases' ? Host.call('casePut', { path: S.cases[id].path, name: 'case', doc: doc })
      : home ? Host.call('casePut', { path: home.path, name: 'appraisal-' + id, doc: doc })
      : Host.call('put', { collection: col, id: id, doc: doc });
    return call.then(() => { S.err = null; }, e => { S.err = e.message || String(e); }).then(() => { S.saving--; setStatus(); });
  }
  function flush() { return Promise.all(Object.keys(timers).map(k => { clearTimeout(timers[k]); delete timers[k]; const i = k.indexOf('/'); return push(k.slice(0, i), k.slice(i + 1)); })); }
  function setStatus() {
    const el = $('#status'); if (!el) return;
    const pending = S.saving > 0 || Object.keys(timers).length > 0;
    el.dataset.s = S.err ? 'err' : pending ? 'busy' : 'ok';
    el.textContent = S.err ? 'Not saved: ' + S.err : pending ? 'Saving…' : 'Saved';
  }
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // ---------- model ----------
  // Ratings a new appraisal starts with so that values appear at once. They are marked as guesses until the arborist edits or keeps them.
  const START = { cond: 70, loc: 70 };
  const SPLIT = [['baldcypress', 'bald cypress'], ['pondcypress', 'pond cypress'], ['sweetgum', 'sweet gum'], ['sweetbay', 'sweet bay'], ['blackgum', 'black gum'], ['crapemyrtle', 'crepe myrtle'], ['crepemyrtle', 'crepe myrtle'], ['crape', 'crepe']];
  const NOISE = { southern: 1, northern: 1, eastern: 1, western: 1, american: 1, common: 1, tree: 1 };
  // Appraisals made before the location rating became one editable figure: carry the average of site, contribution and
  // placement into it once, so no value changes. Returns true when the appraisal was changed and needs saving.
  function migrate(a) { if (!a || a.locOne) return false; if ((a.locationMode || 'parts') === 'parts') E.oneLocation(a, true); a.locOne = true; return true; }
  function blankAppraisal(title, ed) {
    return { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), title: title || '', client: '', property: '', preparedBy: (S.settings && S.settings.preparedBy) || '', inspected: '', valuationDate: '', lossDate: '', notes: '',
      edition: ed, sizeMode: 'dbh', locationMode: 'single', locOne: true, oversize: 'formula', depreciateReplacement: true, ata: true, rounding: ed === '9' ? 'guide9' : 100,
      defaults: { cond: START.cond, site: null, contrib: null, place: null, loc: START.loc, func: 100, ext: 100 }, guess: { cond: true, loc: true }, species: [], trees: [], lines: [], methodText: '', showStated: false };
  }
  function newTree(a) {
    const last = a.trees[a.trees.length - 1];
    return { id: uid(), tag: '', sp: (last && last.sp) || (a.species[0] && a.species[0].id) || '', size: '', cond: null, site: null, contrib: null, place: null, loc: null, func: null, ext: null, method: 'auto', stated: null, note: '' };
  }
  function ratingIndex() {
    const out = [];
    ((S.ratings && S.ratings.custom) || []).forEach(c => { if (E.num(c.pct) !== null) out.push({ sci: c.sci || '', common: c.common || '', pct: E.num(c.pct), custom: true, reason: c.reason || '' }); });
    ((S.ratings && S.ratings.lists) || []).forEach(l => l.items.forEach(i => out.push({ sci: i.sci, common: i.common, pct: i.pct, listId: l.id })));
    return out;
  }
  function findRating(name) { const n = norm(name); if (!n) return null; return ratingIndex().find(r => norm(r.common) === n || norm(r.sci) === n) || null; }
  function listRating(name, sci) { const a = norm(name), b = norm(sci); let hit = null; ((S.ratings && S.ratings.lists) || []).forEach(l => l.items.forEach(i => { if (!hit && ((a && norm(i.common) === a) || (b && norm(i.sci) === b))) hit = { pct: i.pct, listId: l.id, sci: i.sci, common: i.common }; })); return hit; }
  function applyRating(sp, hit) {
    if (hit) { sp.sci = hit.sci || sp.sci; sp.rating = { pct: hit.pct, source: hit.custom ? 'custom' : 'list', listId: hit.listId || null, listPct: hit.custom ? null : hit.pct, note: hit.custom ? hit.reason : '' }; }
    else sp.rating = { pct: sp.rating ? sp.rating.pct : null, source: 'custom', listId: null, listPct: null, note: (sp.rating && sp.rating.note) || '' };
  }
  function addSpecies(a, name) {
    const hit = findRating(name);
    const sp = { id: uid(), common: hit ? cap(hit.common) : cap(String(name || '').trim()), sci: hit ? hit.sci : '', rating: null, repl: [], install: null, unitMode: 'tree', unitManual: null, notes: '' };
    applyRating(sp, hit); fillFromSheets(sp); a.species.push(sp); return sp;
  }
  function speciesByName(a, name) { const n = norm(name); return a.species.find(s => norm(s.common) === n || (s.sci && norm(s.sci) === n)) || null; }
  function exampleAppraisal() {
    const foret = S.sheets['gerald-foret-2025-03'];
    const src = (v, d) => foret ? foret.supplier + ', ' + foret.title + ': ' + v + ', ' + d : 'Sample price';
    const a = blankAppraisal('Example: trees removed along a fence line (sample data)', '9');
    a.client = 'Sample client'; a.property = '100 Example Street, Lafayette, Louisiana'; a.valuationDate = today(); a.example = true;
    a.notes = 'Sample data that shows how the worksheet works. The installation costs are made up. Delete this appraisal when you no longer need it.';
    const live = addSpecies(a, 'live oak'), cyp = addSpecies(a, 'bald cypress'), wat = addSpecies(a, 'water oak');
    live.repl = [{ size: '2 - 2 1/2', cost: 200, source: src("Live 'Cajun'", "45 gal 10-12' x 3-4'") }, { size: '4 - 4 1/2', cost: 1500, source: src("Live 'Cajun'", "200 gal 14-16' x 8-10'") }]; live.install = 450;
    cyp.repl = [{ size: '3 - 3 1/2', cost: 260, source: src('Cypress, Bald', "65 gal 10-12' x 5-6'") }]; cyp.install = 150;
    wat.repl = [{ size: '2 1/2 - 2 3/4', cost: 275, source: src('Nuttall', "65 gal 10-12' x 4-6'") }]; wat.install = 150;
    wat.notes = 'Water oak is not on the price sheet. The largest listed Nuttall oak is used as a comparable replacement.';
    a.defaults = { cond: 70, site: null, contrib: null, place: null, loc: 75, func: 100, ext: 100 }; a.guess = null;
    [[live, '24'], [live, '3'], [cyp, '14', { cond: 85 }], [wat, '18', { cond: 55 }], [wat, '21+24', { cond: 60 }]].forEach(x => a.trees.push(Object.assign(newTree(a), { sp: x[0].id, size: x[1] }, x[2] || {})));
    a.lines = [{ id: uid(), desc: 'Stump grinding', qty: 5, each: 350, amt: null }, { id: uid(), desc: 'Debris removal and site cleanup', qty: null, each: null, amt: 1200 }];
    return a;
  }

  async function boot() {
    try {
      S.info = await Host.call('info');
      const got = await Promise.all(['appraisals', 'sheets', 'library'].map(c => Host.call('list', { collection: c })));
      got[0].forEach(a => { if (a && a.id) S.appraisals[a.id] = a; });
      for (const id of Object.keys(S.appraisals)) if (migrate(S.appraisals[id])) await push('appraisals', id);
      got[1].forEach(s => { if (s && s.id) S.sheets[s.id] = s; });
      got[2].forEach(d => { if (d && d.id === 'ratings') S.ratings = d; if (d && d.id === 'settings') S.settings = d; });
      const first = !S.settings;
      if (!S.settings) S.settings = { id: 'settings', seed: 0, preparedBy: '', company: '', logo: SEED.logo, cite9: R.CITE['9'], cite10: R.CITE['10'] };
      if (!S.ratings) { S.ratings = JSON.parse(JSON.stringify(SEED.ratings)); await push('library', 'ratings'); }
      if ((S.settings.seed || 0) < SEED.version) {
        for (const sh of SEED.sheets) if (!S.sheets[sh.id]) { S.sheets[sh.id] = JSON.parse(JSON.stringify(sh)); await push('sheets', sh.id); }
        if (first) { const ex = exampleAppraisal(); S.appraisals[ex.id] = ex; await push('appraisals', ex.id); }
        S.settings.seed = SEED.version; await push('library', 'settings');
      }
      if (App.boot) await App.boot();
      S.ready = true;
    } catch (e) { S.err = e.message || String(e); S.ready = true; }
    render(); setStatus();
  }

  // ---------- small builders ----------
  const cur = () => S.appraisals[S.route.id];
  const ctx = () => ({ settings: S.settings, ratings: S.ratings, sheets: S.sheets });
  function field(label, bind, val, o) {
    o = o || {};
    const attrs = 'data-bind="' + bind + '"' + (o.kind ? ' data-kind="' + o.kind + '"' : '') + (o.rerender ? ' data-rerender' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.list ? ' list="' + o.list + '"' : '') + (o.extra || '');
    const ctl = o.area ? '<textarea ' + attrs + ' rows="' + (o.rows || 3) + '">' + esc(val) + '</textarea>'
      : '<input ' + attrs + (o.type ? ' type="' + o.type + '"' : '') + (o.kind === 'num' ? ' inputmode="decimal"' : '') + ' value="' + esc(val === null || val === undefined ? '' : val) + '">';
    return '<label class="f"><span>' + esc(label) + '</span>' + ctl + (o.help ? '<small>' + esc(o.help) + '</small>' : '') + '</label>';
  }
  function seg(path, val, opts) { return '<div class="seg" role="group">' + opts.map(o => '<button type="button" data-act="set" data-path="' + path + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (String(val) === String(o[0])) + '">' + esc(o[1]) + '</button>').join('') + '</div>'; }
  const SIZE_LABEL = { dbh: 'Diameter (in)', circ: 'Circumference (in)', area: 'Trunk area (sq in)' };
  const COL_LABEL = { cond: 'Condition %', site: 'Site %', contrib: 'Contribution %', place: 'Placement %', loc: 'Location %', func: 'Functional %', ext: 'External %' };
  function ratingCols(a) { return E.edition(a) === '9' ? ((a.locationMode || 'parts') === 'parts' ? ['cond', 'site', 'contrib', 'place'] : ['cond', 'loc']) : ['cond', 'func', 'ext']; }
  // When the comparison includes the other edition, its rating columns are shown too, so both sets can be filled in on one screen.
  function extraCols(a) { const ed = E.edition(a), other = E.compareKeys(a).some(k => E.approach(k).ed !== ed); return !other ? [] : ed === '9' ? ['func', 'ext'] : (a.locationMode || 'parts') === 'parts' ? ['site', 'contrib', 'place'] : ['loc']; }
  function compareCard(a) {
    const keys = E.compareKeys(a), t = keys.length ? R.compare(a) : null;
    return '<div class="card" data-scope="appraisal"><h2>Compare editions and methods</h2><p class="sub">Tick the approaches to work out side by side. Every tree is valued under each one from the same measurements, and the comparison can go in the report.</p>' +
      '<div class="row" style="margin-top:10px;gap:16px;flex-wrap:wrap">' + E.APPROACHES.map(p => '<label class="check"><input type="checkbox" data-bind="compare.' + p.key + '" data-rerender ' + ((a.compare || {})[p.key] ? 'checked' : '') + '><span>' + esc(p.name) + '</span></label>').join('') + '</div>' +
      (t ? '<div class="rtwrap" style="margin-top:12px">' + R.tableHTML(t) + '</div><p class="hint" style="margin-top:6px">' + esc(R.compareNote(t)) + '</p>' +
        '<p class="hint" style="margin-top:6px">The ' + (E.edition(a) === '9' ? '10th' : '9th') + ' edition ratings have their own columns on the Trees tab while a comparison is ticked. This appraisal’s own total still follows the edition and the method chosen for each tree.</p>' +
        '<div class="row" style="margin-top:8px"><button class="btn small" data-act="copy-compare">Copy the comparison table</button></div>' : '') + '</div>';
  }
  function edName(a) { return E.edition(a) === '9' ? '9th edition' : '10th edition'; }

  // ---------- home ----------
  function homeView() {
    const list = Object.values(S.appraisals).filter(a => !S.apHome[a.id]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return (S.err ? '<p class="banner">Something went wrong reading or saving your data: ' + esc(S.err) + '</p>' : '') +
      '<div class="intro"><div><p class="eyebrow">Tree appraisal</p><h1>Appraisals</h1><p class="sub">Appraisals that are not filed in a case. To value trees for a case, open the case and use its Appraisal tab.</p></div>' +
      '<button class="btn primary big" data-act="new">New appraisal</button></div>' +
      (list.length ? '<div class="alist">' + list.map(a => {
        const A = E.calcAppraisal(a);
        return '<button class="acard" data-act="open" data-id="' + a.id + '"><b>' + esc(R.title(a)) + '</b><span class="val">' + money(A.total, 0) + '<small>' + (A.missing ? plural(A.missing, 'tree') + ' incomplete' : 'total') + '</small></span>' +
          '<span class="meta"><span class="chip ed">' + edName(a) + '</span>' + esc([a.client, plural(A.n, 'tree')].filter(Boolean).join(' · ')) + '</span></button>';
      }).join('') + '</div>' : '<div class="empty"><h2>No appraisals yet</h2><p>Start one, choose the edition, and enter the trees.</p><button class="btn primary" data-act="new">New appraisal</button></div>') +
      '<div class="tools"><button class="tool" data-act="nav" data-view="sheets"><b>Price sheets</b><span>' + plural(Object.keys(S.sheets).length, 'nursery price sheet') + ' on file. Replacement costs are picked from these.</span></button>' +
      '<button class="tool" data-act="nav" data-view="ratings"><b>Species ratings</b><span>The Louisiana list used for 9th-edition appraisals, plus any ratings of your own.</span></button>' +
      '<button class="tool" data-act="nav" data-view="settings"><b>Settings</b><span>Your name line, letterhead logo and the citations printed in exports.</span></button></div>';
  }

  // ---------- appraisal ----------
  function appraisalView(a) {
    const A = E.calcAppraisal(a), tab = S.route.tab || 'trees';
    const tabs = [['setup', 'Setup'], ['species', 'Species and costs', a.species.length], ['trees', 'Trees', a.trees.length], ['options', 'Method options'], ['costs', 'Other costs', (a.lines || []).length], ['results', 'Results']];
    const hc = S.apHome[a.id] && S.cases[S.apHome[a.id]];
    return (hc ? '<button class="backlink" data-act="open-case" data-id="' + hc.doc.id + '" data-tab="appraisal">‹ Back to ' + esc(hc.doc.name || 'the case') + '</button>'
      : '<button class="backlink" data-act="nav" data-view="home">‹ All appraisals</button>') +
      '<div class="ap-head" data-scope="appraisal"><div><h1>' + esc(R.title(a)) + '</h1><p class="row" style="margin-top:6px"><span class="chip ed">' + edName(a) + '</span>' + (a.client ? '<span class="hint">' + esc(a.client) + '</span>' : '') + '</p></div>' +
      '<div class="ap-val"><span class="l">Total</span><b data-out="total">' + money(A.total, 0) + '</b><span class="hint" data-out="count"></span></div></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(t => '<button class="tab" role="tab" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + (t[2] !== undefined ? ' <span class="count">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>' +
      (tab === 'setup' ? setupTab(a) : tab === 'species' ? speciesTab(a) : tab === 'costs' ? costsTab(a) : tab === 'options' ? optionsTab(a, A) : tab === 'results' ? resultsTab(a, A) : treesTab(a, A));
  }

  function setupTab(a) {
    const ed = E.edition(a);
    return '<div data-scope="appraisal"><div class="card"><h2>The job</h2><div class="grid2">' +
      field('Job or report name', 'title', a.title, { rerender: true }) + field('Client', 'client', a.client) + field('Property or location', 'property', a.property) +
      field('Prepared by', 'preparedBy', a.preparedBy, { ph: 'Names as they should appear on the exhibit' }) + field('Inspection date or dates', 'inspected', a.inspected, { ph: 'e.g. October 29, 2025' }) +
      field('Valuation date', 'valuationDate', a.valuationDate, { type: 'date' }) + field('Date of loss', 'lossDate', a.lossDate, { ph: 'If known' }) + '</div>' +
      '<div style="margin-top:12px">' + field('Notes for yourself', 'notes', a.notes, { area: true, rows: 2 }) + '</div></div>' +
      '<div class="card"><h2>Edition of the Guide</h2><div class="edpick">' +
      '<button type="button" data-act="set" data-path="edition" data-val="9" aria-pressed="' + (ed === '9') + '"><b>9th edition</b><span>Trunk Formula Method and Replacement Cost Method. Ratings for species, condition and location.</span></button>' +
      '<button type="button" data-act="set" data-path="edition" data-val="10" aria-pressed="' + (ed === '10') + '"><b>10th edition</b><span>Trunk Formula Technique and direct replacement cost. Condition, functional limitations and external limitations.</span></button></div>' +
      '<p class="hint" style="margin-top:8px">Switching keeps everything you entered. Ratings for the other edition are kept but not used.</p></div>' +
      '<div class="card"><h2>How to work it</h2>' +
      '<div class="opt"><b>Trunk size is entered as</b>' + seg('sizeMode', a.sizeMode || 'dbh', [['dbh', 'Diameter'], ['circ', 'Circumference'], ['area', 'Trunk area']]) + '<span class="hint">Several stems can be typed as 21+24.</span></div>' +
      '<div class="opt"><b>Trees larger than the largest replacement tree</b>' + seg('oversize', a.oversize || 'formula', [['formula', 'Use the trunk formula'], ['largest', 'Value at the largest replacement']]) +
      '<span class="hint">The second choice prices a large tree at the biggest tree on the price list, as in a straight replacement cost claim. Any single tree can be set differently on the Trees tab.</span></div>' +
      (ed === '9'
        ? '<div class="opt"><b>Location rating</b>' + seg('locationMode', a.locationMode || 'parts', [['single', 'One percentage'], ['parts', 'Site, contribution and placement']]) + '<span class="hint">One percentage is typed straight into the Trees tab. The second choice brings back three columns and averages them.</span></div>' +
          '<div class="opt"><label class="check"><input type="checkbox" data-bind="ata" ' + (a.ata !== false ? 'checked' : '') + '><span><b>Use adjusted trunk area for trunks over 30 inches</b><br><span class="hint">This is part of the 9th-edition Trunk Formula Method. Turn it off only to check someone else’s arithmetic.</span></span></label></div>'
        : '<div class="opt"><b>Replacement cost for trees of replaceable size</b>' + seg('depreciateReplacement', a.depreciateReplacement !== false, [[true, 'Apply the ratings'], [false, 'Full replacement cost']]) + '</div>') +
      '<div class="opt"><b>Rounding of each tree’s value</b><div style="max-width:420px"><select class="in" data-bind="rounding" data-rerender>' +
      [['guide9', '9th-edition rule: $10 under $5,000, $100 otherwise'], [0, 'No rounding'], [10, 'Nearest $10'], [50, 'Nearest $50'], [100, 'Nearest $100'], [500, 'Nearest $500'], [1000, 'Nearest $1,000']].map(o => '<option value="' + o[0] + '"' + (String(E.roundRule(a)) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div></div>' +
      '</div><div class="row" style="margin-top:16px"><button class="btn" data-act="duplicate">Duplicate this appraisal</button><button class="btn danger" data-act="del-appraisal">Delete this appraisal</button><span class="hint">A duplicate is a quick way to run the same trees under the other edition.</span></div></div>';
  }

  function speciesTab(a) {
    const counts = {}; a.trees.forEach(t => { counts[t.sp] = (counts[t.sp] || 0) + 1; });
    return '<p class="sub" style="margin-bottom:12px">Each species needs a replacement tree and its cost' + (E.edition(a) === '9' ? ', and a species rating' : '') + '. The tree you mark as the base price sets the unit cost for the trunk formula (the largest size, until you choose); every listed size is available when a tree is small enough to replace.</p>' +
      (a.species.length ? a.species.map(sp => speciesCard(a, sp, counts[sp.id] || 0)).join('') : '<div class="empty"><p>No species yet. Add the first one, or paste a list of trees on the Trees tab.</p></div>') +
      '<div class="row" style="margin-top:14px"><button class="btn primary" data-act="add-species">Add a species</button></div>';
  }
  function speciesCard(a, sp, n) {
    const ed = E.edition(a), rows = sp.repl || [], baseAt = baseIndex(sp);
    return '<div class="spcard" data-scope="species" data-id="' + sp.id + '"><div class="sphead">' +
      field('Common name', 'common', sp.common, { list: 'splist', extra: ' data-relookup' }) + field('Scientific name', 'sci', sp.sci) +
      (ed === '9' ? field('Species rating %', 'rating.pct', sp.rating && sp.rating.pct !== null ? sp.rating.pct : '', { kind: 'num' }) : '<span></span>') +
      '<div class="row end"><span class="hint">' + plural(n, 'tree') + '</span><button class="icon" data-act="del-species" data-id="' + sp.id + '" title="Remove this species" aria-label="Remove ' + esc(sp.common || 'species') + '">✕</button></div></div>' +
      (ed === '9' ? '<p class="spsrc" data-out="rsrc:' + sp.id + '"></p><div data-show="rnote:' + sp.id + '" style="margin-top:8px">' + field('Reason for your rating', 'rating.note', (sp.rating && sp.rating.note) || '', { ph: 'Why this rating fits the species here' }) + '</div>' : '') +
      '<h3>Replacement trees</h3><table class="tbl"><thead><tr><th style="width:150px">Trunk size (in)</th><th class="n" style="width:110px">Cost</th><th class="n" style="width:110px">Price per sq in</th><th>Price source</th><th style="width:120px">Base price</th><th style="width:34px"></th></tr></thead><tbody>' +
      rows.map((r, i) => '<tr data-scope="repl" data-sp="' + sp.id + '" data-i="' + i + '"><td><input class="c" data-bind="size" value="' + esc(r.size === null || r.size === undefined ? '' : r.size) + '" placeholder="4 or 2 1/2 - 3" aria-label="Replacement trunk size"></td>' +
        '<td class="n"><input class="c" data-bind="cost" data-kind="num" inputmode="decimal" value="' + esc(r.cost === null || r.cost === undefined ? '' : r.cost) + '" aria-label="Replacement cost"></td><td class="o n" data-out="psi:' + sp.id + ':' + i + '"></td>' +
        '<td><div class="row" style="flex-wrap:nowrap"><input class="c" data-bind="source" value="' + esc(r.source || '') + '" placeholder="Supplier and date" aria-label="Price source">' + (r.ltd ? '<span class="tagx" title="Marked limited on the price sheet">Limited</span>' : '') + '</div></td>' +
        '<td><label class="check"><input type="radio" name="base-' + sp.id + '" data-radio="base" ' + (i === baseAt ? 'checked' : '') + ' aria-label="Use this tree as the base price"><span class="hint">use this</span></label></td>' +
        '<td><button class="icon" data-act="del-repl" data-sp="' + sp.id + '" data-i="' + i + '" title="Remove this row" aria-label="Remove replacement row">✕</button></td></tr>').join('') +
      '</tbody></table><div class="row" style="margin-top:8px"><button class="btn small primary" data-act="pick" data-id="' + sp.id + '">Choose from a price sheet</button><button class="btn small" data-act="add-repl" data-id="' + sp.id + '">Add a blank row</button></div>' +
      comparableList(sp) +
      '<p class="hint" style="margin-top:6px">The tree marked as the base price sets the unit cost per square inch' + (ed === '9' ? ' and the installed replacement cost in the basic tree cost' : '') + '. Pick it here, or straight from a price sheet.</p>' +
      '<div class="grid2" style="margin-top:12px">' + field('Installation cost per tree', 'install', sp.install, { kind: 'num', ph: '0 if the price is already installed' }) +
      '<label class="f"><span>Unit cost per square inch</span><select data-bind="unitMode" data-rerender><option value="tree"' + ((sp.unitMode || 'tree') === 'tree' ? ' selected' : '') + '>Replacement tree cost ÷ its trunk area</option><option value="installed"' + (sp.unitMode === 'installed' ? ' selected' : '') + '>Installed cost ÷ its trunk area</option><option value="manual"' + (sp.unitMode === 'manual' ? ' selected' : '') + '>I will enter it</option></select></label>' +
      (sp.unitMode === 'manual' ? field('Unit cost you are entering', 'unitManual', sp.unitManual, { kind: 'num' }) : '') + '</div>' +
      '<p class="unitline" data-out="unit:' + sp.id + '"></p><div style="margin-top:10px">' + field('Notes on this species or its replacement', 'notes', sp.notes || '', { ph: 'For example, why a comparable species was used' }) + '</div></div>';
  }

  function methodOptions(a, t) {
    const ed = E.edition(a);
    return [['auto', 'Auto'], ['formula', 'Trunk formula'], ['replace', ed === '9' ? 'Replacement cost' : 'Direct replacement']].map(o => '<option value="' + o[0] + '"' + ((t.method || 'auto') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
  }
  function speciesOptions(a, id) {
    return '<option value=""' + (id ? '' : ' selected') + '>Choose…</option>' + a.species.map(s => '<option value="' + s.id + '"' + (s.id === id ? ' selected' : '') + '>' + esc(s.common || s.sci || 'Unnamed') + '</option>').join('') + '<option value="__new">Add a species…</option>';
  }
  // A rating as shown in a cell: at most two decimals on screen, the stored figure is left alone until it is retyped.
  const shown = v => v === null || v === undefined ? '' : typeof v === 'number' ? String(+v.toFixed(2)) : v;
  // The species rating belongs to the species, so the cell edits it for every tree of that species.
  // 'main' in a 9th edition appraisal, 'extra' in a 10th edition one that is compared with the 9th, '' otherwise.
  function spCol(a) { return E.edition(a) === '9' ? 'main' : extraCols(a).length ? 'extra' : ''; }
  function spInner(a, t, i) {
    const sp = a.species.find(s => s.id === t.sp); if (!sp) return '';
    const name = sp.common || sp.sci || 'this species';
    return '<input class="c" data-bind="rating.pct" data-kind="num" data-col="sprate" inputmode="decimal" value="' + esc(shown(sp.rating ? sp.rating.pct : null)) + '" title="Species rating for ' + esc(name) + '. A change here applies to every tree of this species in the appraisal." aria-label="Species rating %, tree ' + (i + 1) + '">';
  }
  function spTd(a, t, i) { return '<td class="n" data-scope="species" data-id="' + esc(t.sp || '') + '" data-spcell="' + t.id + '">' + spInner(a, t, i) + '</td>'; }
  function treeRow(a, t, i) {
    const d = a.defaults || {}, cols = ratingCols(a), spc = spCol(a);
    const ph = k => d[k] !== null && d[k] !== undefined && d[k] !== '' ? esc(shown(d[k])) : '';
    const cell = k => '<td class="n"><input class="c' + (t.guess && t.guess[k] ? ' guess" title="A starting guess, not your rating yet. Type over it, or keep it.' : '') + '" data-bind="' + k + '" data-kind="num" data-col="' + k + '" inputmode="decimal" value="' + esc(shown(t[k])) + '" placeholder="' + ph(k) + '" aria-label="' + COL_LABEL[k] + ', tree ' + (i + 1) + '"></td>';
    return '<tr data-scope="tree" data-id="' + t.id + '"' + (S.tape === t.id ? ' class="sel"' : '') + '>' +
      '<td><input class="c tagi" data-bind="tag" data-col="tag" value="' + esc(t.tag || '') + '" placeholder="' + (i + 1) + '" aria-label="Tree number"></td>' +
      '<td><select class="c" data-bind="sp" data-col="sp" aria-label="Species, tree ' + (i + 1) + '">' + speciesOptions(a, t.sp) + '</select></td>' +
      '<td class="n"><input class="c" data-bind="size" data-col="size" value="' + esc(t.size || '') + '" aria-label="' + SIZE_LABEL[a.sizeMode || 'dbh'] + ', tree ' + (i + 1) + '"></td>' +
      '<td class="o n" data-out="area:' + t.id + '"></td>' + (spc === 'main' ? spTd(a, t, i) : '') + cols.map(cell).join('') +
      (E.edition(a) === '9' && cols.length === 4 ? '<td class="o n" data-out="L:' + t.id + '"></td>' : '') + (spc === 'extra' ? spTd(a, t, i) : '') + extraCols(a).map(cell).join('') +
      '<td><select class="c" data-bind="method" data-col="method" data-out="method:' + t.id + '" aria-label="Method, tree ' + (i + 1) + '">' + methodOptions(a, t) + '</select></td>' +
      '<td class="o n" data-out="basic:' + t.id + '"></td>' +
      '<td class="n"><button class="vbtn" data-act="tape" data-id="' + t.id + '" data-out="value:' + t.id + '" title="Show the worksheet for this tree"></button></td>' +
      (a.showStated ? '<td class="n"><input class="c" data-bind="stated" data-kind="num" data-col="stated" inputmode="decimal" value="' + esc(t.stated === null || t.stated === undefined ? '' : t.stated) + '" aria-label="Stated value, tree ' + (i + 1) + '"></td><td class="o n" data-out="diff:' + t.id + '"></td>' : '') +
      '<td><input class="c" data-bind="note" data-col="note" value="' + esc(t.note || '') + '" aria-label="Note, tree ' + (i + 1) + '"></td>' +
      '<td><button class="icon" data-act="del-tree" data-id="' + t.id + '" title="Remove this tree" aria-label="Remove tree ' + (i + 1) + '">✕</button></td></tr>';
  }
  function treesTab(a, A) {
    const ed = E.edition(a), cols = ratingCols(a), xcols = extraCols(a), d = a.defaults || {}, spc = spCol(a);
    const head = ['<th style="width:62px">Tree</th>', '<th style="min-width:150px">Species</th>', '<th class="n" style="width:110px">' + SIZE_LABEL[a.sizeMode || 'dbh'] + '</th>', '<th class="n" style="width:92px">Trunk area</th>']
      .concat(spc === 'main' ? ['<th class="n" style="width:84px" title="The rating of the species. Changing it in any row changes it for that species.">Species %</th>'] : [], cols.map(k => '<th class="n" style="width:84px">' + COL_LABEL[k] + '</th>'), ed === '9' && cols.length === 4 ? ['<th class="n" style="width:78px">Location</th>'] : [],
        spc === 'extra' ? ['<th class="n" style="width:84px" title="Used only in the comparison. Changing it in any row changes it for that species.">Species %<br><small>9th ed.</small></th>'] : [], xcols.map(k => '<th class="n" style="width:84px" title="Used only in the comparison">' + COL_LABEL[k] + '<br><small>' + (ed === '9' ? '10th ed.' : '9th ed.') + '</small></th>'),
        ['<th style="width:150px">Method</th>', '<th class="n" style="width:104px">' + (ed === '9' ? 'Basic tree cost' : 'Basic cost') + '</th>', '<th class="n" style="width:104px">Value</th>'],
        a.showStated ? ['<th class="n" style="width:100px">Stated value</th>', '<th class="n" style="width:90px">Difference</th>'] : [], ['<th>Note</th>', '<th style="width:34px"></th>']);
    const dcell = k => '<td class="n"><input class="c' + (a.guess && a.guess[k] ? ' guess" title="A starting guess, not your rating yet. Type over it, or keep it.' : '') + '" data-bind="' + k + '" data-kind="num" data-rerender-ph inputmode="decimal" value="' + esc(shown(d[k])) + '" aria-label="' + COL_LABEL[k] + ' for all trees"></td>';
    return '<div class="totals"><div><span class="l">Trees valued</span><b data-out="done"></b></div><div><span class="l">Trees</span><b data-out="trees"></b></div><div><span class="l">Other costs</span><b data-out="lines"></b></div><div class="grand"><span class="l">Total</span><b data-out="total2"></b></div></div>' +
      '<div class="toolbar"><button class="btn primary" data-act="add-tree">Add a tree</button><button class="btn" data-act="add-trees" data-n="10">Add 10</button><button class="btn" data-act="paste-list">Paste a list…</button>' +
      '<span class="sp"></span><label class="check" data-scope="appraisal"><input type="checkbox" data-bind="showStated" data-rerender ' + (a.showStated ? 'checked' : '') + '><span>Compare with stated values</span></label></div>' +
      guessBar(a) + (a.species.length ? '' : '<p class="hint" style="margin-bottom:10px">No species yet. Choose “Add a species” in a row, or set them up on the Species and costs tab.</p>') +
      '<div class="scroll"><table class="tbl trees"><thead><tr>' + head.join('') + '</tr></thead><tbody>' +
      '<tr class="dflt" data-scope="defaults"><td class="lab" colspan="' + (spc === 'main' ? 5 : 4) + '">Blank cells use these ratings</td>' + cols.map(dcell).join('') + (ed === '9' && cols.length === 4 ? '<td class="o n" data-out="Ld"></td>' : '') + (spc === 'extra' ? '<td></td>' : '') + xcols.map(dcell).join('') + '<td colspan="' + (5 + (a.showStated ? 2 : 0)) + '"></td></tr>' +
      a.trees.map((t, i) => treeRow(a, t, i)).join('') + '</tbody></table></div>' +
      '<p class="hint" style="margin-top:8px">Press Return to move down a column. Paste rows copied from a spreadsheet straight into the table. Click a value to see how it was worked out.</p>';
  }

  function costsTab(a) {
    const lines = a.lines || [];
    return '<p class="sub" style="margin-bottom:12px">Costs that are not the value of a tree: removal, stump grinding, site repair, corrective pruning, aftercare. Enter a quantity and a cost each, or a single amount.</p>' +
      '<div class="scroll"><table class="tbl"><thead><tr><th>Description</th><th class="n" style="width:110px">Quantity</th><th class="n" style="width:130px">Cost each</th><th class="n" style="width:140px">or one amount</th><th class="n" style="width:130px">Line total</th><th style="width:34px"></th></tr></thead><tbody>' +
      lines.map(x => '<tr data-scope="line" data-id="' + x.id + '"><td><input class="c" data-bind="desc" value="' + esc(x.desc || '') + '" aria-label="Description"></td>' +
        ['qty', 'each', 'amt'].map(k => '<td class="n"><input class="c" data-bind="' + k + '" data-kind="num" inputmode="decimal" value="' + esc(x[k] === null || x[k] === undefined ? '' : x[k]) + '" aria-label="' + ({ qty: 'Quantity', each: 'Cost each', amt: 'Amount' })[k] + '"></td>').join('') +
        '<td class="o n" data-out="amt:' + x.id + '"></td><td><button class="icon" data-act="del-line" data-id="' + x.id + '" title="Remove this cost" aria-label="Remove cost">✕</button></td></tr>').join('') +
      '<tr><td colspan="4" class="o" style="text-align:right;font-family:var(--f-body);font-weight:600">Total, other costs</td><td class="o n" style="font-weight:600;color:var(--ink)" data-out="lines"></td><td></td></tr></tbody></table></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" data-act="add-line">Add a cost</button>' + ['Removal of damaged trees', 'Stump grinding', 'Debris removal and site cleanup', 'Site preparation', 'Corrective pruning', 'Re-sodding', 'Watering and aftercare'].map(s => '<button class="btn small" data-act="add-line" data-desc="' + esc(s) + '">' + s + '</button>').join('') + '</div>';
  }

  function resultsTab(a, A) {
    const checks = R.checks(a, A), cl = R.costLines(a, A), ld = R.ladder(a);
    const auto = R.methodText(a, A, ctx()).join('\n\n'), custom = a.methodText && String(a.methodText).trim();
    return '<div class="totals"><div><span class="l">Trees valued</span><b>' + A.done + ' of ' + A.n + '</b></div><div><span class="l">Trees</span><b>' + money(A.trees, 0) + '</b></div><div><span class="l">Other costs</span><b>' + money(A.lines, 0) + '</b></div><div class="grand"><span class="l">Total</span><b>' + money(A.total, 0) + '</b></div></div>' +
      '<div class="card"><h2>Send it to Pages</h2><div class="row"><button class="btn primary big" data-act="export-pages">Open in Pages</button><button class="btn" data-act="export-docx">Save a Word file…</button><button class="btn" data-act="copy-table" data-which="summary">Copy the summary table</button><button class="btn" data-act="copy-table" data-which="detail">Copy the worksheet table</button><button class="btn" data-act="export-csv">Save a spreadsheet (CSV)…</button></div>' +
      '<p class="hint" style="margin-top:8px">“Open in Pages” builds an exhibit with every table below in your report layout. A copied table can be pasted into a report you already have open.</p></div>' +
      '<div class="card"><h2>Checks</h2><ul class="checks">' + (checks.length ? checks.map(c => '<li data-l="' + c.level + '">' + esc(c.text) + '</li>').join('') : '<li class="ok">Nothing missing and nothing flagged.</li>') + '</ul></div>' +
      compareCard(a) +
      '<div class="card"><h2>Summary of appraised values</h2><div class="rtwrap">' + R.tableHTML(R.summary(a, A)) + '</div>' + (cl.rows.length ? '<h3>Other costs</h3><div class="rtwrap">' + R.tableHTML(cl) + '</div>' : '') + '</div>' +
      '<div class="card"><h2>Basis of costs' + (E.edition(a) === '9' ? ' and species ratings' : '') + '</h2><div class="rtwrap">' + R.tableHTML(R.basis(a, A)) + '</div>' + (ld ? '<h3>Replacement tree prices</h3><div class="rtwrap">' + R.tableHTML(ld) + '</div>' : '') + '</div>' +
      '<div class="card"><h2>Appraisal worksheet</h2><div class="rtwrap">' + R.tableHTML(R.detail(a, A)) + '</div><p class="hint" style="margin-top:6px">' + esc(R.legend(a, A)) + '</p></div>' +
      '<div class="card" data-scope="appraisal"><h2>Method statement</h2><p class="hint" style="margin-bottom:8px">' + (custom ? 'This is your edited wording. It no longer updates when the appraisal changes.' : 'Written from the choices in this appraisal. Edit it here or in Pages.') + '</p>' +
      '<textarea class="method" data-bind="methodText" data-method aria-label="Method statement">' + esc(custom ? a.methodText : auto) + '</textarea>' + (custom ? '<div class="row" style="margin-top:8px"><button class="btn small" data-act="reset-method">Go back to the generated wording</button></div>' : '') +
      '<h3>Sources</h3><ul style="margin:6px 0 0;padding-left:20px">' + R.sources(a, ctx()).map(s => '<li>' + esc(s) + '</li>').join('') + '</ul></div>';
  }

  // ---------- library views ----------
  function sheetsView() {
    const list = Object.values(S.sheets).sort((a, b) => String(a.supplier).localeCompare(String(b.supplier)));
    return '<div class="intro"><div><p class="eyebrow">Library</p><h1>Price sheets</h1><p class="sub">Nursery price sheets that replacement costs are picked from. Each one keeps its supplier and date so an exhibit can cite it.</p></div><button class="btn primary big" data-act="new-sheet">New price sheet</button></div>' +
      '<div class="alist">' + list.map(s => '<button class="acard" data-act="open-sheet" data-id="' + s.id + '"><b>' + esc(s.supplier || 'Untitled price sheet') + '</b><span class="val">' + (s.items || []).length + '<small>rows</small></span><span class="meta">' + esc([s.title, s.date].filter(Boolean).join(' · ')) + '</span></button>').join('') + '</div>';
  }
  // The price of a nursery tree for each square inch of its trunk cross-section: price ÷ (0.7854 × trunk size²).
  // A size given as a range uses its middle, the same way an appraisal works out its unit cost.
  function perSqIn(it) { const g = E.parseRange(it.caliper), p = E.num(it.price); return g && p !== null && p > 0 ? p / E.TA(g.mid) : null; }
  // Which replacement row is the base price: the one marked, otherwise the largest with a size and a cost. -1 when there is none.
  function baseIndex(sp) { return E.baseAt(sp); }

  // ---------- price sheet rows for a species, starting ratings, and the method options ----------
  function words(s) {
    let x = String(s || '').toLowerCase(); SPLIT.forEach(p => { x = x.split(p[0]).join(p[1]); });
    return x.replace(/[^a-z]+/g, ' ').trim().split(' ').filter(w => w.length > 1).map(w => w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
  }
  // Price sheet rows for exactly this species: every word of its common name (or of its scientific name) appears in the row's
  // name and category, so "Live oak" finds "Live 'Cajun'" under Oaks and "Water oak" finds nothing. Rows need a trunk size and a price.
  function sheetMatches(sp) {
    const c = words(sp.common), s = words(sp.sci), c2 = c.filter(w => !NOISE[w]), out = [];
    const all = (need, have) => need.length > 0 && need.every(w => have.indexOf(w) >= 0);
    Object.values(S.sheets).forEach(sh => (sh.items || []).forEach((it, i) => {
      if (perSqIn(it) === null) return;
      const have = words(it.variety + ' ' + it.cat);
      if (all(c, have) || (s.length >= 2 && all(s, have)) || (c2.length >= 2 && c2.length < c.length && all(c2, have))) out.push({ sh: sh, it: it, i: i });
    }));
    return out;
  }
  // Add every matching price sheet size the species does not have yet. With no base price chosen, the largest size that is
  // not marked limited becomes the base. Returns how many rows were added.
  function fillFromSheets(sp) {
    let n = 0; sp.repl = sp.repl || [];
    sheetMatches(sp).forEach(m => { if (replAt(sp, m.sh, m.it) < 0) { sp.repl.push(replFrom(m.sh, m.it)); n++; } });
    if (n && !sp.repl.some(r => r.base)) { let bi = -1, bm = -1; sp.repl.forEach((r, i) => { const g = E.parseRange(r.size); if (g && !r.ltd && E.num(r.cost) > 0 && g.max >= bm) { bm = g.max; bi = i; } }); if (bi >= 0) sp.repl[bi].base = true; }
    return n;
  }
  // The ratings that count in this appraisal and are still starting guesses.
  function guessKeys(a) { return E.edition(a) === '9' ? ((a.locationMode || 'parts') === 'single' ? ['cond', 'loc'] : ['cond']) : ['cond']; }
  function guesses(a) {
    const keys = guessKeys(a), d = keys.filter(k => a.guess && a.guess[k] && E.num((a.defaults || {})[k]) !== null);
    return { defaults: d, trees: a.trees.filter(t => t.guess && keys.some(k => t.guess[k] && E.num(t[k]) !== null)).length };
  }
  function guessBar(a) {
    const g = guesses(a); if (!g.defaults.length && !g.trees) return '';
    const d = a.defaults || {}, parts = g.defaults.map(k => COL_LABEL[k].replace(' %', '').toLowerCase() + ' ' + shown(d[k]) + '%');
    return '<div class="guessbar"><span><b>Starting guesses, not your ratings yet.</b> ' + (parts.length ? 'Every blank cell uses ' + parts.join(' and ') + '. ' : '') + (g.trees ? plural(g.trees, 'tree') + ' ' + (g.trees === 1 ? 'has' : 'have') + ' a rating guessed from the notes and photos. ' : '') + 'They are shaded. Type over a figure to make it yours.</span><button class="btn small" data-act="keep-guesses">Keep these as my ratings</button></div>';
  }
  // The first automatic appraisal for trees already entered: price sheet sizes for each species, and starting ratings where none are set.
  function autoBuild(a) {
    const out = { added: 0, none: [], ratings: [] }, d = a.defaults || (a.defaults = {});
    a.species.forEach(sp => { out.added += fillFromSheets(sp); if (!E.replRows(sp).length && !(E.num(sp.unitManual) > 0)) out.none.push(sp.common || sp.sci || 'an unnamed species'); });
    guessKeys(a).forEach(k => { if (E.num(d[k]) === null) { d[k] = START[k]; (a.guess = a.guess || {})[k] = true; out.ratings.push(k); } });
    return out;
  }
  // For a species no price sheet lists: the priced trees it could borrow a cost from. Trees that share a word with its name
  // or category come first ("Water oak" gets the other oaks); with none in common, every priced tree is offered.
  function comparables(sp) {
    if (sheetMatches(sp).length) return { related: false, list: [] };
    const mine = words(sp.common).concat(words(sp.sci)).filter(w => !NOISE[w] && w.length > 2), all = [], near = [];
    Object.values(S.sheets).forEach(sh => (sh.items || []).forEach((it, i) => {
      if (perSqIn(it) === null) return;
      const m = { sh: sh, it: it, i: i }, have = words(it.variety + ' ' + it.cat); all.push(m);
      if (mine.some(w => have.indexOf(w) >= 0)) near.push(m);
    }));
    const list = (near.length ? near : all).filter(m => replAt(sp, m.sh, m.it) < 0);
    return { related: near.length > 0, list: list };
  }
  function optButton(sp, o, cur, m, kind) {
    if (!o) return '';
    const txt = o.done ? money(o.total, 0) : '—', part = o.done && o.done < o.n ? ' <small>' + o.done + ' of ' + o.n + ' trees</small>' : '', why = o.done ? '' : ' title="Needs a trunk size and ratings before it can be worked out"';
    if (m) return '<button class="optv cand" data-act="opt-adopt" data-sp="' + sp.id + '" data-sheet="' + m.sh.id + '" data-i="' + m.i + '" data-kind="' + kind + '"' + why + '>' + txt + part + '</button>';
    return '<button class="optv' + (cur === o.key ? ' on' : '') + '" data-act="opt-pick" data-sp="' + sp.id + '" data-key="' + o.key + '" aria-pressed="' + (cur === o.key) + '"' + why + '>' + txt + part + (cur === o.key ? ' <small class="inuse">in use</small>' : '') + '</button>';
  }
  function optCard(a, sp) {
    const O = E.options(a, sp.id), by = {}, cur = O.current, ed = E.edition(a); O.list.forEach(o => { by[o.key] = o; });
    const rows = O.list.filter(o => o.key.charAt(0) === 'r' && o.row !== undefined), inst = E.num(sp.install) || 0, name = sp.common || sp.sci || 'This species';
    const tail = s => { const i = String(s || '').lastIndexOf(': '); return i >= 0 ? s.slice(i + 2) : (s || ''); };
    const names = { auto: 'Mixed: replacement cost for trees no larger than the base size, trunk formula for larger trees', near: 'Replacement cost, each tree at the nearest listed size', fm: 'Trunk formula from your own unit cost of ' + money(E.num(sp.unitManual), 2) + ' per square inch' };
    const sizes = a.trees.filter(t => t.sp === sp.id).map(t => E.parseSize(t.size, a.sizeMode || 'dbh').d).filter(d => d !== null), lo = Math.min.apply(null, sizes), hi = Math.max.apply(null, sizes);
    const head = '<thead><tr><th>Replacement tree on the price sheet</th><th class="n" style="width:96px">Trunk (in)</th><th class="n" style="width:92px">Price</th><th class="n" style="width:104px">Price per sq in</th><th class="n" style="width:170px">' + (ed === '9' ? 'Replacement Cost Method' : 'Direct replacement') + '<br><small>every tree at this size</small></th><th class="n" style="width:170px">' + (ed === '9' ? 'Trunk Formula Method' : 'Trunk Formula Technique') + '<br><small>this size as the base price</small></th></tr></thead>';
    // Trees the species could borrow a cost from, each worked out as if it had been added. Nothing is added until a figure is clicked.
    const cmp = comparables(sp), cand = cmp.list, n0 = (sp.repl || []).length; let cby = {};
    if (cand.length) {
      const s2 = Object.assign({}, sp, { repl: (sp.repl || []).map(r => Object.assign({}, r)).concat(cand.map(m => replFrom(m.sh, m.it))) });
      E.options(Object.assign({}, a, { species: a.species.map(s => s.id === sp.id ? s2 : s) }), sp.id).list.forEach(o => { cby[o.key] = o; });
    }
    const candRows = cand.map((m, k) => { const r = cby['r' + (n0 + k)], f = cby['f' + (n0 + k)]; return '<tr><td>' + esc(m.it.variety + (m.it.dims ? ', ' + m.it.dims : '')) + (m.it.ltd ? ' <span class="tagx">Limited</span>' : '') + '</td><td class="o n">' + esc(m.it.caliper) + '</td><td class="o n">' + money(m.it.price) + '</td><td class="o n">' + money(perSqIn(m.it), 2) + '</td><td class="n">' + optButton(sp, r, cur, m, 'r') + '</td><td class="n">' + optButton(sp, f, cur, m, 'f') + '</td></tr>'; }).join('');
    const others = ['auto', 'near', 'fm'].filter(k => by[k] && (rows.length || k === 'fm'));
    return '<div class="card optcard" data-scope="species" data-id="' + sp.id + '"><div class="row" style="align-items:baseline"><h2 style="margin:0">' + esc(sp.common || sp.sci || 'Unnamed species') + '</h2><span class="hint">' + plural(O.n, 'tree') + (sizes.length ? ', ' + (lo === hi ? fmt(lo, 1) : fmt(lo, 1) + ' to ' + fmt(hi, 1)) + ' in' : '') + '</span><span class="sp"></span><button class="btn small" data-act="pick" data-id="' + sp.id + '">Choose from a price sheet</button></div>' +
      (O.own ? '<p class="hint" style="margin-top:6px">' + plural(O.own, 'tree') + ' of this species ' + (O.own === 1 ? 'has its' : 'have their') + ' own method set on the Trees tab. A choice here does not change ' + (O.own === 1 ? 'it' : 'them') + '.</p>' : '') +
      (rows.length
        ? '<div class="scroll" style="margin-top:10px"><table class="tbl opts">' + head + '<tbody>' +
          rows.map(o => '<tr><td title="' + esc(o.source) + '">' + esc(tail(o.source) || 'Entered by hand') + (o.ltd ? ' <span class="tagx">Limited</span>' : '') + '</td><td class="o n">' + esc(o.size) + '</td><td class="o n">' + money(o.cost) + '</td><td class="o n">' + money(o.perSqIn, 2) + '</td><td class="n">' + optButton(sp, o, cur) + '</td><td class="n">' + optButton(sp, by['f' + o.row], cur) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '') +
      (others.length ? '<table class="tbl opts" style="margin-top:10px"><tbody>' + others.map(k => '<tr><td>' + esc(names[k]) + '</td><td class="n" style="width:170px">' + optButton(sp, by[k], cur) + '</td></tr>').join('') + '</tbody></table>' : '') +
      (rows.length && inst ? '<p class="hint" style="margin-top:6px">Installation of ' + money(inst) + ' per tree is added to each replacement cost.</p>' : '') +
      (cand.length
        ? '<details class="more"' + (rows.length && !cmp.related ? '' : ' open') + '><summary>' + (cmp.related ? 'Comparable trees on your price sheets' : 'Every priced tree on your price sheets') + ' <span class="count">' + cand.length + '</span></summary>' +
          '<p class="hint" style="margin:4px 0 8px">' + esc(name) + ' is not listed on a price sheet under that name. ' + (cmp.related ? 'These are the nearest trees that are.' : 'Nothing listed shares its name, so every priced tree is shown.') + ' Each figure is what ' + (O.n === 1 ? 'this tree' : 'these trees') + ' would come to using that tree’s price. Click a figure to use it; the tree is then added to this species.</p>' +
          '<div class="scroll"><table class="tbl opts">' + head + '<tbody>' + candRows + '</tbody></table></div></details>'
        : (!rows.length ? '<p class="hint" style="margin-top:10px">No priced replacement tree is listed for this species yet. Use “Choose from a price sheet” to pick a comparable tree, or type your own unit cost below.</p>' : '')) +
      '<div class="grid2" style="margin-top:12px">' + field('Your own base price per square inch', 'unitManual', sp.unitManual, { kind: 'num', rerender: true, ph: 'Optional', help: 'Adds a trunk formula choice that uses this figure instead of a price sheet tree.' }) +
      field('Installation cost per tree', 'install', sp.install, { kind: 'num', rerender: true, ph: '0 if the price is already installed' }) + '</div></div>';
  }
  function comparableList(sp) {
    const cmp = comparables(sp), name = sp.common || sp.sci || 'This species'; if (!cmp.list.length) return '';
    return '<details class="more"' + (E.replRows(sp).length ? '' : ' open') + '><summary>' + (cmp.related ? 'Comparable trees on your price sheets' : 'Every priced tree on your price sheets') + ' <span class="count">' + cmp.list.length + '</span></summary>' +
      '<p class="hint" style="margin:4px 0 8px">' + esc(name) + ' is not listed on a price sheet under that name. ' + (cmp.related ? 'These are the nearest trees that are.' : 'Nothing listed shares its name, so every priced tree is shown.') + ' Choose one to set the unit cost per square inch from it instead of typing a figure.</p>' +
      '<table class="rt"><thead><tr><th>Tree</th><th>Container and size</th><th class="r">Trunk (in)</th><th class="r">Price</th><th class="r">Price per sq in</th><th></th></tr></thead><tbody>' +
      cmp.list.map(m => '<tr><td>' + esc(m.it.variety) + (m.it.ltd ? ' <span class="tagx">Limited</span>' : '') + '</td><td>' + esc(m.it.dims || '') + '</td><td class="r">' + esc(m.it.caliper) + '</td><td class="r">' + money(m.it.price) + '</td><td class="r">' + money(perSqIn(m.it), 2) + '</td>' +
        '<td class="r"><button class="btn small" data-act="pick-base" data-sp="' + sp.id + '" data-sheet="' + m.sh.id + '" data-i="' + m.i + '">Use as base price</button></td></tr>').join('') + '</tbody></table></details>';
  }
  function optionsTab(a, A) {
    const used = a.species.filter(sp => a.trees.some(t => t.sp === sp.id)), idle = a.species.filter(sp => used.indexOf(sp) < 0);
    return '<div class="totals"><div><span class="l">Trees valued</span><b>' + A.done + ' of ' + A.n + '</b></div><div><span class="l">Trees</span><b>' + money(A.trees, 0) + '</b></div><div><span class="l">Other costs</span><b>' + money(A.lines, 0) + '</b></div><div class="grand"><span class="l">Total with the methods in use</span><b>' + money(A.total, 0) + '</b></div></div>' +
      '<p class="sub" style="margin-bottom:10px">Every way each species can be valued from your price sheets, worked out from the trees and ratings entered so far: the replacement cost of each listed size, and the trunk formula from each base price per square inch. Each figure is the total for that species. Click one to use that method. A single tree can still be set differently on the Trees tab.</p>' +
      '<div class="toolbar"><button class="btn" data-act="auto-build">Fill in from price sheets and starting ratings</button><span class="hint">Adds every price sheet size for each species and puts a starting guess in any blank rating.</span></div>' +
      guessBar(a) +
      (used.length ? used.map(sp => optCard(a, sp)).join('') : '<p class="hint">No trees with a species yet. Add them on the Trees tab, or read them from field notes in the case.</p>') +
      (idle.length ? '<p class="hint" style="margin-top:12px">No trees use ' + esc(idle.map(s => s.common || s.sci || 'an unnamed species').join(', ')) + ', so there is nothing to compare for ' + (idle.length === 1 ? 'it' : 'them') + '.</p>' : '');
  }
  // A price sheet row as a replacement tree on an appraisal, and where that row already is on a species (-1 if it is not).
  function replFrom(sh, it) { return { size: it.caliper || '', cost: it.price, source: sh.supplier + ', ' + [sh.title, sh.date && sh.title.indexOf(sh.date) < 0 && !/\d{4}/.test(sh.title) ? sh.date : ''].filter(Boolean).join(', ') + ': ' + it.variety + (it.dims ? ', ' + it.dims : ''), ltd: !!it.ltd, sheetId: sh.id }; }
  function replAt(sp, sh, it) { const want = replFrom(sh, it); return ((sp && sp.repl) || []).findIndex(r => String(r.size || '') === want.size && E.num(r.cost) === E.num(want.cost) && r.source === want.source); }
  function setBase(sp, i) { sp.repl.forEach((r, k) => { r.base = k === i; }); if (sp.unitMode === 'manual') { sp.unitMode = 'tree'; return true; } return false; }
  function baseLine(sp) {
    const u = E.unitCost(sp);
    if (!u) return 'No base price chosen yet.';
    if (u.mode === 'manual') return 'The unit cost is typed in by hand: <b>' + money(u.unit, 2) + '</b> per square inch. Choosing a tree below replaces it.';
    return 'Base price now: <b>' + money(u.row.cost) + '</b> for the ' + esc(u.row.size) + ' in tree' + (u.mode === 'installed' ? ' (' + money(u.cost) + ' installed)' : '') + ', <b>' + money(u.unit, 2) + '</b> per square inch.' + (u.row.source ? ' <span class="hint">' + esc(u.row.source) + '</span>' : '');
  }
  function perSqInText(it) { const v = perSqIn(it); return v === null ? '' : money(v, 2); }
  App.changed.sheets = function (el) { const tr = el.closest && el.closest('tr[data-scope=item]'), s = S.sheets[S.route.id]; if (!tr || !s) return; const out = $('[data-out=psi]', tr), it = s.items[+tr.dataset.i]; if (out && it) out.textContent = perSqInText(it); };
  function sheetView(s) {
    return '<button class="backlink" data-act="nav" data-view="sheets">‹ All price sheets</button><div data-scope="sheet"><div class="card" style="margin-top:8px"><h2>' + esc(s.supplier || 'New price sheet') + '</h2><div class="grid2">' +
      field('Supplier', 'supplier', s.supplier, { rerender: true }) + field('Title of the sheet', 'title', s.title) + field('Date of the sheet', 'date', s.date, { ph: 'e.g. March - April 2025' }) + field('Supplier location', 'address', s.address) + '</div>' +
      '<div style="margin-top:12px">' + field('What the prices cover', 'basis', s.basis, { area: true, rows: 2, ph: 'Wholesale, plant only? Delivered and planted?' }) + '</div><div style="margin-top:12px">' + field('Where this sheet came from', 'source', s.source) + '</div></div>' +
      '<div class="card"><h2>Rows</h2><div class="scroll"><table class="tbl"><thead><tr><th style="width:150px">Group</th><th>Tree</th><th style="width:200px">Container and size</th><th style="width:130px">Trunk size (in)</th><th class="n" style="width:100px">Price</th><th class="n" style="width:120px" title="Price ÷ trunk cross-section area (0.7854 × trunk size²). A size range uses its middle.">Price per sq in</th><th style="width:80px">Limited</th><th>Comments</th><th style="width:34px"></th></tr></thead><tbody>' +
      (s.items || []).map((it, i) => '<tr data-scope="item" data-i="' + i + '">' + ['cat', 'variety', 'dims', 'caliper'].map(k => '<td><input class="c" data-bind="' + k + '" value="' + esc(it[k] || '') + '" aria-label="' + k + '"></td>').join('') +
        '<td class="n"><input class="c" data-bind="price" data-kind="num" inputmode="decimal" value="' + esc(it.price === null || it.price === undefined ? '' : it.price) + '" aria-label="Price"></td><td class="o n" data-out="psi">' + perSqInText(it) + '</td>' +
        '<td style="text-align:center"><input type="checkbox" data-bind="ltd" ' + (it.ltd ? 'checked' : '') + ' aria-label="Limited quantity"></td><td><input class="c" data-bind="comments" value="' + esc(it.comments || '') + '" aria-label="Comments"></td>' +
        '<td><button class="icon" data-act="del-item" data-i="' + i + '" title="Remove this row" aria-label="Remove row">✕</button></td></tr>').join('') +
      '</tbody></table></div><p class="hint" style="margin-top:8px">Price per sq in is the price divided by the trunk’s cross-section area, 0.7854 × trunk size². A size given as a range uses its middle (2 - 2 1/2 counts as 2.25 in). It is the plant price only, before installation, and is blank where the sheet gives no trunk size.</p>' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" data-act="add-item">Add a row</button><span class="sp"></span><button class="btn danger" data-act="del-sheet">Delete this price sheet</button></div></div></div>';
  }
  function ratingsView() {
    const q = norm(S.route.q || ''), lists = (S.ratings && S.ratings.lists) || [], custom = (S.ratings && S.ratings.custom) || [];
    return '<div class="intro"><div><p class="eyebrow">Library</p><h1>Species ratings</h1><p class="sub">Used as the species rating in 9th-edition appraisals. A rating of your own for a species takes the place of the listed one.</p></div></div>' +
      '<div class="card"><h2>Your own ratings</h2><div class="scroll"><table class="tbl"><thead><tr><th>Common name</th><th>Scientific name</th><th class="n" style="width:100px">Rating %</th><th>Reason</th><th style="width:34px"></th></tr></thead><tbody>' +
      custom.map(c => '<tr data-scope="custom" data-id="' + c.id + '">' + ['common', 'sci'].map(k => '<td><input class="c" data-bind="' + k + '" value="' + esc(c[k] || '') + '" aria-label="' + k + '"></td>').join('') +
        '<td class="n"><input class="c" data-bind="pct" data-kind="num" inputmode="decimal" value="' + esc(c.pct === null || c.pct === undefined ? '' : c.pct) + '" aria-label="Rating percent"></td><td><input class="c" data-bind="reason" value="' + esc(c.reason || '') + '" aria-label="Reason"></td>' +
        '<td><button class="icon" data-act="del-custom" data-id="' + c.id + '" title="Remove" aria-label="Remove rating">✕</button></td></tr>').join('') +
      '</tbody></table></div><div class="row" style="margin-top:10px"><button class="btn primary" data-act="add-custom">Add a rating</button></div></div>' +
      lists.map(l => '<div class="card"><h2>' + esc(l.name) + '</h2><p class="sub">' + esc(l.citation) + ' ' + esc(l.doi || '') + '</p><p class="hint" style="margin-top:6px">' + esc(l.about || '') + '</p>' +
        '<div style="max-width:340px;margin:12px 0 8px"><input class="in" data-search value="' + esc(S.route.q || '') + '" placeholder="Search ' + l.items.length + ' species" aria-label="Search species"></div>' +
        '<div class="rtwrap"><table class="rt"><thead><tr><th>Common name</th><th>Scientific name</th><th class="r">Rating</th></tr></thead><tbody>' +
        l.items.filter(i => !q || norm(i.common).indexOf(q) >= 0 || norm(i.sci).indexOf(q) >= 0).map(i => '<tr><td>' + esc(cap(i.common)) + '</td><td><i>' + esc(i.sci) + '</i></td><td class="r">' + i.pct + '%</td></tr>').join('') + '</tbody></table></div></div>').join('');
  }
  function settingsView() {
    const st = S.settings, lg = st.logo;
    return '<div class="intro"><div><p class="eyebrow">Library</p><h1>Settings</h1></div></div><div data-scope="settings"><div class="card"><h2>On your exhibits</h2><div class="grid2">' +
      field('Prepared by', 'preparedBy', st.preparedBy, { ph: 'Used for new appraisals', help: 'Each appraisal can still have its own line.' }) + '</div>' +
      '<h3>Letterhead logo</h3><div class="row">' + (lg && lg.data ? '<img alt="Current logo" src="data:image/' + (lg.type === 'jpg' ? 'jpeg' : 'png') + ';base64,' + lg.data + '" style="height:54px;background:#fff;border:1px solid var(--rule);border-radius:6px;padding:4px">' : '<span class="hint">No logo. Exports will have a plain header.</span>') +
      '<button class="btn small" data-act="pick-logo">Choose a logo…</button>' + (lg && lg.data ? '<button class="btn small" data-act="clear-logo">Remove</button>' : '') + '</div></div>' +
      '<div class="card"><h2>Citations printed under Sources</h2>' + field('9th edition', 'cite9', st.cite9, { area: true, rows: 2 }) + '<div style="margin-top:12px">' + field('10th edition', 'cite10', st.cite10, { area: true, rows: 2 }) + '</div><p class="hint" style="margin-top:8px">Check these against the title pages of your own copies.</p></div>' +
      (App.settingsExtra ? App.settingsExtra() : '') + '<div class="card"><h2>Your data</h2><p class="sub">Everything is kept on this Mac in: <code>' + esc((S.info && S.info.dataDir) || '') + '</code></p><div class="row" style="margin-top:10px"><button class="btn small" data-act="reveal-data">Show in Finder</button></div></div></div>';
  }

  // ---------- render ----------
  function render() {
    const r = S.route; let h;
    if (!S.ready) h = '<p class="hint">Loading…</p>';
    else if (App.views[r.view]) h = App.views[r.view](r);
    else if (r.view === 'appraisal' && S.appraisals[r.id]) h = appraisalView(S.appraisals[r.id]);
    else if (r.view === 'sheets') h = sheetsView();
    else if (r.view === 'sheet' && S.sheets[r.id]) h = sheetView(S.sheets[r.id]);
    else if (r.view === 'ratings') h = ratingsView();
    else if (r.view === 'settings') h = settingsView();
    else if (r.view === 'home') h = homeView();
    else { r.view = 'cases'; h = App.views.cases ? App.views.cases(r) : homeView(); }
    $('#app').innerHTML = h;
    const at = r.view === 'sheet' ? 'sheets' : r.view === 'case' ? 'cases' : r.view === 'appraisal' ? (S.apHome[r.id] ? 'cases' : 'home') : r.view;
    $('#nav').innerHTML = [['cases', 'Cases'], ['home', 'Appraisals'], ['sheets', 'Price sheets'], ['ratings', 'Species ratings'], ['settings', 'Settings']].map(n => '<button class="nav" data-act="nav" data-view="' + n[0] + '"' + (at === n[0] ? ' aria-current="page"' : '') + '>' + n[1] + '</button>').join('');
    $('#splist').innerHTML = ratingIndex().map(x => '<option value="' + esc(cap(x.common)) + '">' + esc(x.sci) + '</option>').join('');
    if (r.view === 'appraisal' && cur()) refresh(); else renderTape();
    if (App.after[r.view]) App.after[r.view](r);
  }
  function go(route) { S.route = route; S.tape = null; flush(); if (App.onRoute) App.onRoute(route); render(); window.scrollTo(0, 0); }

  // Recalculate and patch only the output cells, so typing never loses its place.
  function refresh() {
    const a = cur(); if (!a) return;
    const A = E.calcAppraisal(a), out = {}, show = {}, bad = {};
    out.total = out.total2 = money(A.total, 0); out.trees = money(A.trees, 0); out.lines = money(A.lines, 0); out.done = A.done + ' of ' + A.n;
    out.count = plural(A.n, 'tree') + (A.missing ? ', ' + A.missing + ' incomplete' : '');
    const d = a.defaults || {}, ds = E.num(d.site), dc = E.num(d.contrib), dp = E.num(d.place);
    out.Ld = ds !== null && dc !== null && dp !== null ? E.pct((ds + dc + dp) / 3) : '';
    A.rows.forEach((c, i) => {
      const id = c.id;
      out['area:' + id] = c.areaUsed !== null && c.areaUsed !== undefined ? fmt(c.areaUsed, 1) + (c.adjusted ? '*' : '') : '';
      out['L:' + id] = c.L !== null && c.L !== undefined ? E.pct(c.L) : '';
      out['basic:' + id] = c.basic !== null ? money(c.basic, 0) : '';
      out['value:' + id] = c.value !== null ? money(c.value) : (a.trees[i].size ? 'needs data' : '—');
      out['diff:' + id] = c.diff === undefined ? '' : (Math.abs(c.diff) < 0.5 ? 'matches' :(c.diff > 0 ? '+' : '−') + money(Math.abs(c.diff), 0));
      bad['diff:' + id] = c.diff !== undefined && Math.abs(c.diff) > 2; // within $2 is hand rounding, not an error
      out['method:' + id] = c.method ? 'Auto: ' + R.shortMethod(c) : 'Auto';
    });
    A.lineRows.forEach(l => { out['amt:' + l.id] = l.amount !== null ? money(l.amount) : ''; });
    a.species.forEach(sp => {
      const u = E.unitCost(sp), b = E.baseRow(sp), rt = sp.rating || {};
      out['unit:' + sp.id] = u ? (u.mode === 'manual' ? 'Unit cost <b>' + money(u.unit, 2) + '</b> per square inch, as entered.' : 'Unit cost <b>' + money(u.unit, 2) + '</b> per square inch: ' + money(u.cost) + (u.mode === 'installed' ? ' installed' : '') + ' for the ' + fmt(u.row.mid, 2) + ' in tree ÷ ' + fmt(u.ta, 2) + ' sq in.')
        : (b ? 'Enter a cost for the replacement tree.' : 'Add a replacement tree with a trunk size and a cost.');
      const inst = sp.unitMode === 'installed' ? (E.num(sp.install) || 0) : 0;
      (sp.repl || []).forEach((r, i) => { const c = E.num(r.cost); out['psi:' + sp.id + ':' + i] = perSqInText({ caliper: r.size, price: c === null ? null : c + inst }); });
      const lr = listRating(sp.common, sp.sci);
      out['rsrc:' + sp.id] = rt.source === 'list' ? 'From the Louisiana list (USDA Forest Service): ' + rt.pct + '%.'
        : (lr ? 'Your own rating. The Louisiana list gives ' + lr.pct + '%.' : 'Not on the Louisiana list. Enter your own rating and a short reason.');
      show['rnote:' + sp.id] = rt.source !== 'list';
    });
    $$('[data-out]').forEach(el => {
      const k = el.dataset.out, v = out[k]; if (v === undefined) return;
      if (k.indexOf('method:') === 0) { if (el.options[0].text !== v) el.options[0].text = v; }
      else if (k.indexOf('unit:') === 0) el.innerHTML = v;
      else if (el.textContent !== v) el.textContent = v;
      if (k.indexOf('diff:') === 0) { el.classList.toggle('diff-bad', !!bad[k]); el.classList.toggle('diff-ok', v !== '' && !bad[k]); }
      if (k.indexOf('rsrc:') === 0) el.classList.toggle('warn', v.indexOf('From the') !== 0);
    });
    $$('[data-show]').forEach(el => { el.hidden = !show[el.dataset.show]; });
    $$('td[data-spcell]').forEach(td => {
      const i = a.trees.findIndex(t => t.id === td.dataset.spcell); if (i < 0) return; const t = a.trees[i];
      if ((td.dataset.id || '') !== (t.sp || '')) { td.dataset.id = t.sp || ''; td.innerHTML = spInner(a, t, i); return; }
      const box = $('input', td), sp = a.species.find(s => s.id === t.sp);
      if (box && sp && box !== document.activeElement) { const v = String(shown(sp.rating ? sp.rating.pct : null)); if (box.value !== v) box.value = v; }
    });
    A.rows.forEach(c => { const tr = $('tr[data-id="' + c.id + '"]'); if (tr) tr.classList.toggle('inc', c.value === null); });
    renderTape(A);
  }

  function renderTape(A) {
    const el = $('#tape'), a = cur();
    const i = a && S.tape ? a.trees.findIndex(t => t.id === S.tape) : -1;
    if (i < 0 || S.route.view !== 'appraisal') { el.hidden = true; document.body.classList.remove('has-tape'); return; }
    const c = (A || E.calcAppraisal(a)).rows[i], t = a.trees[i];
    el.hidden = false; document.body.classList.add('has-tape');
    el.innerHTML = '<div class="row"><div><p class="eyebrow">Worksheet</p><h2>Tree ' + esc(R.tag(t, i)) + '</h2></div><span class="sp"></span><button class="icon" data-act="close-tape" aria-label="Close worksheet" title="Close">✕</button></div>' +
      '<p class="hint">' + esc((c.sp && (c.sp.common || c.sp.sci)) || 'No species') + (c.methodName ? ' · ' + esc(c.methodName) : '') + '</p>' +
      (c.missing.length ? '<p class="note miss">Still needed: ' + esc(c.missing.join('; ')) + '.</p>' : '') +
      '<ol class="steps">' + c.steps.map((s, n) => '<li' + (n === c.steps.length - 1 && c.value !== null ? ' class="final"' : '') + '><span class="lb">' + esc(s.label) + '</span><span class="rs">' + esc(s.res) + '</span>' + (s.fx ? '<span class="fx">' + esc(s.fx) + '</span>' : '') + '</li>').join('') + '</ol>' +
      c.warn.map(w => '<p class="note">' + esc(w) + '</p>').join('') +
      '<p class="hint" style="margin-top:14px">These are the published formulas. Check the steps against your copy of the Guide before you rely on them.</p>';
  }

  // ---------- modal and toast ----------
  function openModal(html, narrow) { const m = $('#modal'); m.innerHTML = '<div class="dlg' + (narrow ? ' narrow' : '') + '" role="dialog" aria-modal="true">' + html + '</div>'; m.hidden = false; const f = $('[autofocus]', m) || $('input,textarea,button', m); if (f) f.focus(); }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; S.modal = null; }
  let toastTimer;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 3200); }

  function pickerHTML(spId, q) {
    const n = norm(q), sheets = Object.values(S.sheets), a = cur(), sp = a && a.species.find(s => s.id === spId), baseAt = baseIndex(sp);
    return '<h2>Choose from a price sheet</h2><p class="sub"><b>Use as base price</b> makes that tree the one the unit cost per square inch is figured from. <b>Add</b> only lists the size as another replacement for this species. Rows without a trunk size can be added, but you will need to type the size.</p>' +
      '<p class="unitline" data-base-now>' + (sp ? baseLine(sp) : '') + '</p>' +
      '<div style="margin-top:10px"><input class="in" data-picker-q autofocus value="' + esc(q || '') + '" placeholder="Search, for example oak or cypress" aria-label="Search price sheets"></div><div class="body">' +
      sheets.map(s => {
        const rows = (s.items || []).map((it, i) => ({ it: it, i: i })).filter(x => !n || norm(x.it.variety + ' ' + x.it.cat).indexOf(n) >= 0);
        if (!rows.length) return '';
        return '<h3>' + esc(s.supplier) + ' <span class="hint" style="font-family:var(--f-body);font-weight:400">' + esc([s.title, s.date].filter(Boolean).join(' · ')) + '</span></h3><p class="hint">' + esc(s.basis || '') + '</p>' +
          '<table class="rt" style="margin-top:6px"><thead><tr><th>Tree</th><th>Container and size</th><th class="r">Trunk (in)</th><th class="r">Price</th><th class="r">Price per sq in</th><th></th></tr></thead><tbody>' +
          rows.map(x => { const at = sp ? replAt(sp, s, x.it) : -1, isBase = at >= 0 && at === baseAt, psi = perSqIn(x.it), who = ' data-sp="' + spId + '" data-sheet="' + s.id + '" data-i="' + x.i + '"'; return '<tr' + (isBase ? ' class="on"' : '') + '><td>' + esc(x.it.variety) + (x.it.ltd ? ' <span class="tagx">Limited</span>' : '') + '</td><td>' + esc(x.it.dims || '') + '</td><td class="r">' + esc(x.it.caliper || '—') + '</td><td class="r">' + money(x.it.price) + '</td><td class="r">' + (psi === null ? '—' : money(psi, 2)) + '</td>' +
            '<td class="r" style="white-space:nowrap">' + (isBase ? '<span class="tagx ok">Base price</span> ' : '<button class="btn small" data-act="pick-base"' + who + (psi === null ? ' disabled title="Needs a trunk size and a price on the price sheet"' : '') + '>Use as base price</button> ') +
            '<button class="btn small" data-act="pick-row"' + who + (at >= 0 ? ' disabled>Added' : '>Add') + '</button></td></tr>'; }).join('') + '</tbody></table>';
      }).join('') + '</div><div class="row end" style="margin-top:14px"><button class="btn primary" data-act="close-modal">Done</button></div>';
  }

  // Lines such as "Tree 7 Water oak multi-trunk 21" + 24"", "3, Pecan, 10" or tab-separated cells.
  function parseTreeList(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      let l = line.replace(/[“”″"]/g, '').replace(/\bmulti-?\s?trunk\b/ig, '').trim();
      if (!l || /^(tree\s*#|#|tree\s+(and|number)|species)/i.test(l) && !/\d/.test(l.replace(/^tree\s*#?\s*and\s*species/i, ''))) return;
      let tag = '', species = '', size = '', cells = null;
      if (l.indexOf('\t') >= 0) cells = l.split('\t'); else if (/,/.test(l) && !/\d,\d{3}/.test(l)) cells = l.split(',');
      if (cells) {
        cells = cells.map(c => c.trim()).filter(c => c !== '');
        const sizeLike = c => /^\d[\d.\s/]*(\s*\+\s*\d[\d.\s/]*)*(\s*in\.?)?$/i.test(c);
        if (cells.length >= 3) { tag = cells[0].replace(/^tree\s*#?\s*/i, ''); species = cells[1]; size = cells[2]; }
        else if (cells.length === 2) { if (sizeLike(cells[0]) && sizeLike(cells[1])) { tag = cells[0]; size = cells[1]; } else { species = cells[0]; size = cells[1]; } }
        else if (cells.length === 1) { if (sizeLike(cells[0])) size = cells[0]; else species = cells[0]; }
      } else {
        const m = l.match(/^(?:tree\s*#?\s*)?(\d+[a-z]?)?[.):]?\s*(.*?)\s*((?:\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)(?:\s*\+\s*\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)*)?\s*(?:in\.?|inches)?$/i);
        if (m) { tag = m[1] || ''; species = (m[2] || '').trim(); size = (m[3] || '').trim(); if (!species && !size && tag) { size = tag; tag = ''; } }
      }
      size = String(size).replace(/\s*(in\.?|inches)$/i, '').replace(/\s*\+\s*/g, '+').trim();
      if (species || size) out.push({ tag: tag, species: species.replace(/\s+/g, ' '), size: size });
    });
    return out;
  }

  // ---------- exports ----------
  const fileName = a => R.title(a).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Appraisal';
  function buildDocx(a) { const A = E.calcAppraisal(a); return Docx.build({ shortTitle: R.title(a), logo: S.settings.logo, blocks: R.docxBlocks(a, A, ctx()) }); }
  async function exportDocx(open) {
    const a = cur(); await flush();
    const data = Docx.bytesToB64(buildDocx(a)), name = fileName(a) + ' - Appraisal.docx';
    try {
      if (open) { const r = await Host.call('saveExport', { name: name, data: data }); if (r && !r.downloaded) await Host.call('openInPages', { path: r.path }); toast(r && r.downloaded ? 'Word file downloaded. Open it with Pages.' : 'Opening in Pages…'); return r; }
      const r2 = await Host.call('saveAs', { name: name, data: data }); if (r2 && r2.path) toast('Saved ' + name); return r2;
    } catch (e) { toast('Could not export: ' + (e.message || e)); }
  }
  async function exportCsv() {
    const a = cur(), A = E.calcAppraisal(a), bytes = new TextEncoder().encode('﻿' + R.csv(a, A));
    try { const r = await Host.call('saveAs', { name: fileName(a) + ' - Appraisal.csv', data: Docx.bytesToB64(bytes) }); if (r && r.path) toast('Saved the spreadsheet'); } catch (e) { toast('Could not save: ' + (e.message || e)); }
  }
  async function copyTable(which) {
    const a = cur(), A = E.calcAppraisal(a), t = which === 'detail' ? R.detail(a, A) : R.summary(a, A);
    try { await Host.call('copy', { html: R.tableHTML(t, true), text: R.tableTSV(t) }); toast('Copied. Paste it into your report in Pages.'); } catch (e) { toast('Could not copy: ' + (e.message || e)); }
  }

  // ---------- interaction ----------
  function scopeOf(el) {
    const sc = el.closest('[data-scope]'); if (!sc) return null;
    const a = cur(), k = sc.dataset.scope, ap = a ? { col: 'appraisals', id: a.id } : null;
    if (App.scopes[k]) return App.scopes[k](sc, el);
    if (k === 'appraisal') return Object.assign({ obj: a }, ap);
    if (k === 'defaults') { a.defaults = a.defaults || {}; return Object.assign({ obj: a.defaults }, ap); }
    if (k === 'tree') return Object.assign({ obj: a.trees.find(t => t.id === sc.dataset.id) }, ap);
    if (k === 'species') return Object.assign({ obj: a.species.find(s => s.id === sc.dataset.id), kind: 'species' }, ap);
    if (k === 'repl') { const sp = a.species.find(s => s.id === sc.dataset.sp); return Object.assign({ obj: sp && sp.repl[+sc.dataset.i], sp: sp }, ap); }
    if (k === 'line') return Object.assign({ obj: a.lines.find(x => x.id === sc.dataset.id) }, ap);
    if (k === 'sheet') return { obj: S.sheets[S.route.id], col: 'sheets', id: S.route.id };
    if (k === 'item') return { obj: S.sheets[S.route.id].items[+sc.dataset.i], col: 'sheets', id: S.route.id };
    if (k === 'custom') return { obj: S.ratings.custom.find(x => x.id === sc.dataset.id), col: 'library', id: 'ratings' };
    if (k === 'settings') return { obj: S.settings, col: 'library', id: 'settings' };
    return null;
  }
  function setPath(o, path, v) { const ks = path.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]] === null || typeof x[ks[i]] !== 'object') x[ks[i]] = {}; x = x[ks[i]]; } x[ks[ks.length - 1]] = v; }
  function readVal(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.kind === 'num') return E.num(el.value);
    if (el.dataset.bind === 'rounding') return el.value === 'guide9' ? 'guide9' : +el.value;
    return el.value;
  }
  function onField(el, committed) {
    const sc = scopeOf(el); if (!sc || !sc.obj) return;
    const path = el.dataset.bind;
    if (path === 'sp' && el.value === '__new') { el.value = sc.obj.sp || ''; S.modal = { type: 'species', tree: sc.obj.id }; openModal(speciesDialog(), true); return; }
    if (path === 'methodText') { const a = cur(), auto = R.methodText(a, E.calcAppraisal(a), ctx()).join('\n\n'); sc.obj.methodText = el.value.trim() === auto.trim() ? '' : el.value; save(sc.col, sc.id); return; }
    setPath(sc.obj, path, readVal(el));
    { const box = el.closest('[data-scope]'), kind = box && box.dataset.scope, a = cur(), holder = kind === 'defaults' ? a : kind === 'tree' ? sc.obj : null;
      if (holder && holder.guess && holder.guess[path]) { delete holder.guess[path]; el.classList.remove('guess'); el.removeAttribute('title'); } }
    if (sc.kind === 'species') {
      const sp = sc.obj;
      if (path === 'rating.pct') { const lr = listRating(sp.common, sp.sci); sp.rating.listPct = lr ? lr.pct : null; sp.rating.listId = lr ? lr.listId : null; sp.rating.source = lr && E.num(sp.rating.pct) === lr.pct ? 'list' : 'custom'; }
      if (path === 'common' && committed && !(sp.repl || []).length) fillFromSheets(sp);
      if (path === 'common' && committed) { const hit = findRating(sp.common); if (hit) { applyRating(sp, hit); save(sc.col, sc.id); render(); return; } if (sp.rating && sp.rating.source === 'list') { sp.rating.source = 'custom'; sp.rating.listId = null; sp.rating.listPct = null; } }
    }
    save(sc.col, sc.id);
    if (sc.col === 'appraisals') { if (committed && el.hasAttribute('data-rerender')) render(); else if (committed && el.hasAttribute('data-rerender-ph')) render(); else refresh(); }
    else { if (App.changed[sc.col]) App.changed[sc.col](el, sc, committed, path); if (committed && el.hasAttribute('data-rerender')) render(); }
  }
  function speciesDialog() {
    return '<h2>Add a species</h2><p class="sub">Type a common or scientific name. If it is on the Louisiana list, its rating is filled in.</p><div style="margin-top:12px"><input class="in" data-species-name autofocus list="splist" placeholder="For example, Pecan" aria-label="Species name"></div>' +
      '<div class="row end" style="margin-top:14px"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="species-ok">Add</button></div>';
  }
  function armed(b, label) {
    if (b.classList.contains('armed')) return true;
    const old = b.innerHTML; b.classList.add('armed'); b.textContent = label || 'Click again to remove';
    setTimeout(() => { if (document.contains(b)) { b.classList.remove('armed'); b.innerHTML = old; } }, 3000); return false;
  }
  function focusCell(treeId, col) { const el = $('tr[data-id="' + treeId + '"] [data-col="' + col + '"]'); if (el) { el.focus(); if (el.select) el.select(); } }

  const ACT = {
    nav: b => go({ view: b.dataset.view }),
    open: b => go({ view: 'appraisal', id: b.dataset.id, tab: 'trees' }),
    tab: b => { S.route.tab = b.dataset.tab; flush(); render(); },
    'new': () => { S.modal = { type: 'new' }; openModal('<h2>New appraisal</h2><div style="margin-top:10px"><label class="f"><span>Job or report name</span><input data-new-title autofocus placeholder="For example, the client’s name"></label></div>' +
      '<p class="l" style="margin:14px 0 6px">Which edition of the Guide?</p><div class="edpick"><button type="button" data-act="create" data-ed="9"><b>9th edition</b><span>Species, condition and location ratings.</span></button><button type="button" data-act="create" data-ed="10"><b>10th edition</b><span>Condition, functional and external limitations.</span></button></div>' +
      '<p class="hint" style="margin-top:8px">You can switch editions later without losing anything.</p><div class="row end" style="margin-top:12px"><button class="btn" data-act="close-modal">Cancel</button></div>', true); },
    create: b => { const t = $('[data-new-title]'), a = blankAppraisal(t ? t.value.trim() : '', b.dataset.ed), cid = S.modal && S.modal.caseId; if (cid && S.cases[cid]) { S.apHome[a.id] = cid; const c = S.cases[cid].doc; a.client = (c.to && c.to.name) || ''; }
      S.appraisals[a.id] = a; save('appraisals', a.id, 0); closeModal(); go({ view: 'appraisal', id: a.id, tab: 'setup' }); },
    duplicate: () => { const a = JSON.parse(JSON.stringify(cur())); a.id = uid(); a.title = R.title(a) + ' (copy)'; a.createdAt = Date.now(); delete a.example; if (S.apHome[cur().id]) S.apHome[a.id] = S.apHome[cur().id]; S.appraisals[a.id] = a; save('appraisals', a.id, 0); go({ view: 'appraisal', id: a.id, tab: 'setup' }); toast('Duplicated. You are now in the copy.'); },
    'del-appraisal': b => { if (!armed(b, 'Click again to delete')) return; const id = cur().id, cid = S.apHome[id]; delete S.appraisals[id]; clearTimeout(timers['appraisals/' + id]); delete timers['appraisals/' + id];
      if (cid && S.cases[cid]) { Host.call('caseRemove', { path: S.cases[cid].path, name: 'appraisal-' + id }); delete S.apHome[id]; go({ view: 'case', id: cid, tab: 'appraisal' }); }
      else { Host.call('remove', { collection: 'appraisals', id: id }); go({ view: 'home' }); }
      toast('Appraisal deleted'); },
    set: b => { const sc = scopeOf(b); if (!sc) return; const v = b.dataset.val; setPath(sc.obj, b.dataset.path, v === 'true' ? true : v === 'false' ? false : v);
      if (b.dataset.path === 'locationMode' && v === 'single') E.oneLocation(sc.obj, false);
      if (b.dataset.path === 'edition') { const a = sc.obj; if (v === '9' && a.rounding !== 'guide9') a.rounding = 'guide9'; if (v === '10' && a.rounding === 'guide9') a.rounding = 100; }
      save(sc.col, sc.id); render(); },
    'add-species': () => { S.modal = { type: 'species' }; openModal(speciesDialog(), true); },
    'species-ok': () => { const a = cur(), name = ($('[data-species-name]').value || '').trim(); if (!name) return; let sp = speciesByName(a, name); if (!sp) sp = addSpecies(a, name);
      if (S.modal && S.modal.tree) { const t = a.trees.find(x => x.id === S.modal.tree); if (t) t.sp = sp.id; } save('appraisals', a.id); closeModal(); render(); },
    'del-species': b => { const a = cur(), n = a.trees.filter(t => t.sp === b.dataset.id).length; if (n && !armed(b, n + ' trees use it. Click again')) return; if (!n && !armed(b)) return; a.species = a.species.filter(s => s.id !== b.dataset.id); a.trees.forEach(t => { if (t.sp === b.dataset.id) t.sp = ''; }); save('appraisals', a.id); render(); },
    'add-repl': b => { const a = cur(), sp = a.species.find(s => s.id === b.dataset.id); sp.repl.push({ size: '', cost: null, source: '' }); save('appraisals', a.id); render(); },
    'del-repl': b => { const a = cur(), sp = a.species.find(s => s.id === b.dataset.sp); sp.repl.splice(+b.dataset.i, 1); save('appraisals', a.id); render(); },
    pick: b => { S.modal = { type: 'picker', sp: b.dataset.id, q: '' }; const sp = cur().species.find(s => s.id === b.dataset.id); S.modal.q = ''; openModal(pickerHTML(b.dataset.id, ''), false); const q = $('[data-picker-q]'); if (q && sp && sp.common) { const w = sp.common.split(' ').pop(); q.value = w; S.modal.q = w; $('#modal .dlg').innerHTML = pickerHTML(b.dataset.id, w); const q2 = $('[data-picker-q]'); q2.focus(); q2.setSelectionRange(w.length, w.length); } },
    'pick-row': b => { const a = cur(), sp = a.species.find(s => s.id === b.dataset.sp), sh = S.sheets[b.dataset.sheet], it = sh.items[+b.dataset.i];
      sp.repl.push(replFrom(sh, it)); save('appraisals', a.id); b.textContent = 'Added'; b.disabled = true; const now = $('[data-base-now]'); if (now) now.innerHTML = baseLine(sp); },
    'pick-base': b => { const a = cur(), sp = a.species.find(s => s.id === b.dataset.sp), sh = S.sheets[b.dataset.sheet], it = sh.items[+b.dataset.i];
      let at = replAt(sp, sh, it); if (at < 0) { sp.repl.push(replFrom(sh, it)); at = sp.repl.length - 1; }
      const wasManual = setBase(sp, at); save('appraisals', a.id);
      if (S.modal && S.modal.type === 'picker') { const body = $('#modal .body'), top = body ? body.scrollTop : 0; $('#modal .dlg').innerHTML = pickerHTML(sp.id, S.modal.q); const nb = $('#modal .body'); if (nb) nb.scrollTop = top; }
      else { const y = window.scrollY; render(); window.scrollTo(0, y); }
      if (wasManual) toast('The unit cost now comes from this tree instead of the figure typed in'); },
    'opt-adopt': b => { const a = cur(), sp = a.species.find(s => s.id === b.dataset.sp), sh = S.sheets[b.dataset.sheet], it = sh && sh.items[+b.dataset.i]; if (!sp || !it) return;
      let at = replAt(sp, sh, it); if (at < 0) { sp.repl.push(replFrom(sh, it)); at = sp.repl.length - 1; }
      E.choose(sp, b.dataset.kind + at); save('appraisals', a.id); const y = window.scrollY; render(); window.scrollTo(0, y); },
    'opt-pick': b => { const a = cur(), sp = a.species.find(s => s.id === b.dataset.sp); if (!sp) return; E.choose(sp, b.dataset.key); save('appraisals', a.id); const y = window.scrollY; render(); window.scrollTo(0, y); },
    'auto-build': () => { const a = cur(), r = autoBuild(a); save('appraisals', a.id); render();
      toast([r.added ? plural(r.added, 'price sheet size') + ' added' : 'No new price sheet sizes to add', r.ratings.length ? 'starting ratings filled in' : '', r.none.length ? 'nothing on the price sheets for ' + r.none.join(', ') : ''].filter(Boolean).join('; ') + '.'); },
    'keep-guesses': () => { const a = cur(); a.guess = null; a.trees.forEach(t => { delete t.guess; }); save('appraisals', a.id); render(); },
    'close-modal': () => { const had = S.modal; closeModal(); if (had && had.type === 'picker') render(); },
    'add-tree': () => { const a = cur(), t = newTree(a); a.trees.push(t); save('appraisals', a.id); render(); focusCell(t.id, a.species.length ? 'size' : 'sp'); },
    'add-trees': b => { const a = cur(); let first = null; for (let i = 0; i < +b.dataset.n; i++) { const t = newTree(a); a.trees.push(t); first = first || t; } save('appraisals', a.id); render(); focusCell(first.id, 'size'); },
    'del-tree': b => { const a = cur(), t = a.trees.find(x => x.id === b.dataset.id); if (t && (t.size || t.note) && !armed(b)) return; a.trees = a.trees.filter(x => x.id !== b.dataset.id); if (S.tape === b.dataset.id) S.tape = null; save('appraisals', a.id); render(); },
    tape: b => { S.tape = S.tape === b.dataset.id ? null : b.dataset.id; $$('.trees tr.sel').forEach(r => r.classList.remove('sel')); const tr = $('tr[data-id="' + S.tape + '"]'); if (tr) tr.classList.add('sel'); renderTape(); },
    'close-tape': () => { S.tape = null; $$('.trees tr.sel').forEach(r => r.classList.remove('sel')); renderTape(); },
    'paste-list': () => { S.modal = { type: 'paste' }; openModal('<h2>Paste a list of trees</h2><p class="sub">One tree per line: number, species and trunk size. Rows copied from a spreadsheet or a table in a report work.</p>' +
      '<div style="margin-top:10px"><textarea class="method" data-paste autofocus placeholder="Tree 1 Pecan 17\nTree 2 Water oak 24\nTree 7 Water oak 21 + 24" aria-label="List of trees"></textarea></div><p class="hint" data-paste-count style="margin-top:6px"></p>' +
      '<div class="row end" style="margin-top:12px"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="paste-ok">Add these trees</button></div>'); },
    'paste-ok': () => { const a = cur(), rows = parseTreeList($('[data-paste]').value); if (!rows.length) { toast('No trees found in that text'); return; }
      rows.forEach(r => { const t = newTree(a); if (r.species) { let sp = speciesByName(a, r.species); if (!sp) sp = addSpecies(a, r.species); t.sp = sp.id; } t.tag = r.tag; t.size = r.size; a.trees.push(t); });
      save('appraisals', a.id); closeModal(); render(); toast('Added ' + plural(rows.length, 'tree')); },
    'copy-compare': async () => { const a = cur(), t = R.compare(a); try { await Host.call('copy', { html: R.tableHTML(t, true), text: R.tableTSV(t) }); toast('Copied. Paste it into your report.'); } catch (e) { toast('Could not copy: ' + (e.message || e)); } },
    'add-line': b => { const a = cur(); a.lines = a.lines || []; const x = { id: uid(), desc: b.dataset.desc || '', qty: null, each: null, amt: null }; a.lines.push(x); save('appraisals', a.id); render(); const el = $('tr[data-id="' + x.id + '"] [data-bind="' + (x.desc ? 'qty' : 'desc') + '"]'); if (el) el.focus(); },
    'del-line': b => { const a = cur(); a.lines = a.lines.filter(x => x.id !== b.dataset.id); save('appraisals', a.id); render(); },
    'reset-method': () => { const a = cur(); a.methodText = ''; save('appraisals', a.id); render(); },
    'export-pages': () => exportDocx(true), 'export-docx': () => exportDocx(false), 'export-csv': () => exportCsv(), 'copy-table': b => copyTable(b.dataset.which),
    'open-sheet': b => go({ view: 'sheet', id: b.dataset.id }),
    'new-sheet': () => { const s = { id: uid(), supplier: '', address: '', title: '', date: '', basis: '', source: '', notes: '', items: [{ cat: '', variety: '', dims: '', caliper: '', price: null, ltd: false, comments: '' }] }; S.sheets[s.id] = s; save('sheets', s.id, 0); go({ view: 'sheet', id: s.id }); },
    'add-item': () => { const s = S.sheets[S.route.id], last = s.items[s.items.length - 1]; s.items.push({ cat: last ? last.cat : '', variety: last ? last.variety : '', dims: '', caliper: '', price: null, ltd: false, comments: '' }); save('sheets', s.id); render(); const rows = $$('tr[data-scope="item"]'); const el = rows.length && $('[data-bind="dims"]', rows[rows.length - 1]); if (el) el.focus(); },
    'del-item': b => { const s = S.sheets[S.route.id]; s.items.splice(+b.dataset.i, 1); save('sheets', s.id); render(); },
    'del-sheet': b => { if (!armed(b, 'Click again to delete')) return; const id = S.route.id; delete S.sheets[id]; clearTimeout(timers['sheets/' + id]); delete timers['sheets/' + id]; Host.call('remove', { collection: 'sheets', id: id }); go({ view: 'sheets' }); toast('Price sheet deleted'); },
    'add-custom': () => { const c = { id: uid(), common: '', sci: '', pct: null, reason: '' }; S.ratings.custom.push(c); save('library', 'ratings'); render(); const el = $('tr[data-id="' + c.id + '"] input'); if (el) el.focus(); },
    'del-custom': b => { S.ratings.custom = S.ratings.custom.filter(x => x.id !== b.dataset.id); save('library', 'ratings'); render(); },
    'pick-logo': async () => { try { const r = await Host.call('pickImage'); if (r && r.data) { S.settings.logo = r; save('library', 'settings'); render(); } } catch (e) { toast('Could not read that image'); } },
    'clear-logo': () => { S.settings.logo = null; save('library', 'settings'); render(); },
    'reveal-data': () => Host.call('reveal', { path: S.info.dataDir })
  };

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) { if (e.target.id === 'modal') ACT['close-modal'](); return; }
    const fn = ACT[b.dataset.act]; if (fn) { e.preventDefault(); fn(b); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.hasAttribute('data-picker-q')) { S.modal.q = el.value; const pos = el.selectionStart; $('#modal .dlg').innerHTML = pickerHTML(S.modal.sp, el.value); const q = $('[data-picker-q]'); q.focus(); q.setSelectionRange(pos, pos); return; }
    if (el.hasAttribute('data-paste')) { const n = parseTreeList(el.value).length; $('[data-paste-count]').textContent = n ? plural(n, 'tree') + ' found.' : ''; return; }
    if (el.hasAttribute('data-search')) { S.route.q = el.value; const pos = el.selectionStart; render(); const s = $('[data-search]'); s.focus(); s.setSelectionRange(pos, pos); return; }
    if (el.dataset.bind && el.tagName !== 'SELECT' && el.type !== 'checkbox' && el.type !== 'radio') onField(el, false);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.radio === 'base') { const sc = scopeOf(el); if (sc && sc.sp) { sc.sp.repl.forEach(r => { r.base = false; }); sc.obj.base = true; save(sc.col, sc.id); refresh(); } return; }
    if (el.dataset.bind) onField(el, true);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('#modal').hidden) ACT['close-modal'](); else if (S.tape) ACT['close-tape'](); return; }
    const el = e.target;
    if (e.key === 'Enter' && el.hasAttribute && el.hasAttribute('data-species-name')) { e.preventDefault(); ACT['species-ok'](); return; }
    if (e.key === 'Enter' && el.hasAttribute && el.hasAttribute('data-new-title')) { e.preventDefault(); return; }
    if (!el.closest || !el.closest('.trees') || !el.dataset.col || el.tagName === 'SELECT' && e.key !== 'Enter') return;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && el.tagName === 'INPUT') || (e.key === 'ArrowUp' && el.tagName === 'INPUT')) {
      const tr = el.closest('tr'); let to = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
      e.preventDefault();
      if (to && to.dataset.scope === 'tree') { const n = $('[data-col="' + el.dataset.col + '"]', to); if (n) { n.focus(); if (n.select) n.select(); } }
      else if (e.key === 'Enter' && !to) { const a = cur(), col = el.dataset.col; onField(el, true); const t = newTree(a); a.trees.push(t); save('appraisals', a.id); render(); focusCell(t.id, col); }
    }
  });
  // Rows copied from a spreadsheet land across the editable columns, starting where the cursor is.
  document.addEventListener('paste', e => {
    const el = e.target; if (!el.closest || !el.closest('.trees') || !el.dataset.col) return;
    const text = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(text.replace(/\s+$/, ''))) return;
    e.preventDefault();
    const a = cur(), cols = ['tag', 'sp', 'size'].concat(ratingCols(a), a.showStated ? ['stated'] : [], ['note']);
    const startCol = cols.indexOf(el.dataset.col), tr = el.closest('tr'); let ti = a.trees.findIndex(t => t.id === tr.dataset.id); if (startCol < 0 || ti < 0) return;
    text.replace(/\s+$/, '').split(/\r?\n/).forEach(line => {
      if (!a.trees[ti]) a.trees.push(newTree(a));
      const t = a.trees[ti++];
      line.split('\t').forEach((v, j) => {
        const k = cols[startCol + j]; if (!k) return; v = v.trim();
        if (k === 'sp') { if (v) { let sp = speciesByName(a, v); if (!sp) sp = addSpecies(a, v); t.sp = sp.id; } }
        else if (k === 'tag' || k === 'note') t[k] = v;
        else if (k === 'size') t.size = v.replace(/["”″]/g, '').replace(/\s*\+\s*/g, '+');
        else { t[k] = E.num(v); if (t.guess) delete t.guess[k]; }
      });
    });
    save('appraisals', a.id); render(); toast('Pasted');
  });

  // Used by the Mac app's self-test: runs the real code paths without touching the screen.
  window.__selfTest = async function () {
    const out = { mode: Host.mode, ready: S.ready, sheets: Object.keys(S.sheets).length, ratings: S.ratings ? S.ratings.lists[0].items.length : 0, appraisals: Object.keys(S.appraisals).length };
    const ex = Object.values(S.appraisals).find(a => a.example); if (!ex) { out.error = 'no example appraisal'; return out; }
    const A = E.calcAppraisal(ex); out.exampleTotal = A.total; out.exampleDone = A.done + '/' + A.n;
    S.route = { view: 'appraisal', id: ex.id, tab: 'results' }; render();
    const bytes = buildDocx(ex); out.docxBytes = bytes.length;
    const r = await Host.call('saveExport', { name: 'Self test - Appraisal.docx', data: Docx.bytesToB64(bytes) }); out.docxPath = r && r.path;
    S.route = { view: 'appraisal', id: ex.id, tab: 'trees' }; render(); out.treeRows = $$('tr[data-scope="tree"]').length; out.firstValue = ($('.vbtn') || {}).textContent;
    // The trees table: a species rating column that edits the species, one editable location rating, no site, contribution or placement columns.
    const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const trs = () => $$('table.trees tr[data-scope="tree"]'), snap = JSON.stringify(ex), total = A.total, sp0 = ex.species.find(s => s.id === ex.trees[0].sp);
    out.columns = $$('table.trees thead th').map(t => t.textContent).join('|');
    out.locationIsOneColumn = !!$('[data-col=loc]') && !$('[data-col=site]') && !$('[data-col=contrib]') && !$('[data-col=place]');
    type($('[data-col=sprate]', trs()[0]), '50'); out.speciesRatingEdits = sp0.rating.pct === 50 && $('[data-col=sprate]', trs()[1]).value === '50' && E.calcAppraisal(ex).total < total;
    type($('[data-col=loc]', trs()[0]), '90'); out.locationEdits = ex.trees[0].loc === 90;
    Object.assign(ex, JSON.parse(snap)); render(); out.tableRestored = E.calcAppraisal(ex).total === total;
    // An appraisal from before the change keeps every value when its three location columns become one.
    const old = JSON.parse(snap); old.id = 'selftest-old'; delete old.locOne; old.locationMode = 'parts'; old.defaults = Object.assign({}, old.defaults, { site: 80, contrib: 65, place: 71, loc: null }); old.trees[0].site = 55; old.trees[1].loc = 3;
    const was = E.calcAppraisal(old).rows.map(r => r.raw); out.migrated = migrate(old) && old.locationMode === 'single' && old.locOne === true && !migrate(old);
    out.migrationKeepsValues = E.calcAppraisal(old).rows.every((r, i) => r.raw !== null && r.raw === was[i]);
    // Choosing the base price straight from a price sheet.
    S.route = { view: 'appraisal', id: ex.id, tab: 'species' }; render(); ACT.pick($('[data-act=pick]'));
    const pb = () => $$('#modal [data-act=pick-base]'), rowOf = re => pb().find(b => re.test(b.closest('tr').textContent));
    out.baseOptions = pb().length; out.basePerSqIn = $$('#modal .rt thead th').some(t => t.textContent === 'Price per sq in');
    const small = rowOf(/45 gal/), sp1 = ex.species.find(s => s.id === ex.trees[0].sp); if (small) small.click();   // sp1: the sample was restored above, so its species are new objects
    out.baseChosen = !!small && sp1.repl.length === 2 && baseIndex(sp1) === 0 && Math.abs(E.unitCost(sp1).unit - 200 / E.TA(2.25)) < 1e-9 && $$('#modal tr.on').length === 1;
    const fresh = pb().find(b => !b.disabled && $('[data-act=pick-row]', b.closest('tr')) && !$('[data-act=pick-row]', b.closest('tr')).disabled); if (fresh) fresh.click();
    out.baseAddedFromSheet = !!fresh && sp1.repl.length === 3 && baseIndex(sp1) === 2 && sp1.repl.filter(r => r.base).length === 1;
    closeModal(); Object.assign(ex, JSON.parse(snap)); save('appraisals', ex.id, 0); render(); out.baseRestored = E.calcAppraisal(ex).total === total;
    // A new appraisal works out at once: price sheet sizes for the species, starting ratings marked as guesses, and a choice of methods.
    const na = blankAppraisal('Self test options', '9'), nl = addSpecies(na, 'live oak'), nw = addSpecies(na, 'water oak'); S.appraisals[na.id] = na;
    [[nl, '24'], [nl, '3'], [nw, '20']].forEach(p => { const t = newTree(na); t.sp = p[0].id; t.size = p[1]; na.trees.push(t); });
    out.sheetSizesFound = nl.repl.length >= 4 && nw.repl.length === 0 && nl.repl.filter(r => r.base).length === 1 && !nl.repl[baseIndex(nl)].ltd;
    out.startsWithGuesses = E.calcAppraisal(na).done === 2 && guesses(na).defaults.join() === 'cond,loc' && R.checks(na, E.calcAppraisal(na)).some(c => /starting guess/.test(c.text));
    S.route = { view: 'appraisal', id: na.id, tab: 'options' }; render();
    const ob = k => $('.optv[data-sp="' + nl.id + '"][data-key="' + k + '"]'), dollars = b => +b.textContent.replace(/[^0-9]/g, ''), spSum = () => E.calcAppraisal(na).rows.reduce((s, c, i) => s + (na.trees[i].sp === nl.id ? c.value || 0 : 0), 0);
    out.optionCount = $$('.optv[data-sp="' + nl.id + '"]').length; out.optionCards = $$('.optcard').length;
    let wantSum = dollars(ob('r1')); ob('r1').click(); out.optionReplacement = E.choiceOf(nl) === 'r1' && spSum() === wantSum && ob('r1').classList.contains('on');
    wantSum = dollars(ob('f0')); ob('f0').click(); out.optionFormula = E.choiceOf(nl) === 'f0' && spSum() === wantSum && baseIndex(nl) === 0;
    out.optionWording = /selected as the basis for the species/.test(R.methodText(na, E.calcAppraisal(na), ctx()).join(' '));
    // A species no price sheet lists still gets a list to choose from: the other oaks for a water oak, every priced tree for a pecan.
    const cw = comparables(nw), cp = comparables(addSpecies({ species: [] }, 'pecan')), cl = comparables(nl);
    out.comparablesFound = cw.related && cw.list.length >= 5 && cw.list.every(m => /oak/i.test(m.it.cat)) && !cp.related && cp.list.length > cw.list.length && cl.list.length === 0;
    const cb = $$('.optcard[data-id="' + nw.id + '"] .optv.cand'); out.comparableChoices = cb.length === cw.list.length * 2 && !!$('.optcard[data-id="' + nw.id + '"] details.more[open]');
    const pickC = cb.find(b => b.dataset.kind === 'f' && dollars(b) > 0), wantC = pickC ? dollars(pickC) : -1; if (pickC) pickC.click();
    out.comparableAdopted = nw.repl.length === 1 && E.choiceOf(nw) === 'f0' && E.calcAppraisal(na).rows[2].value === wantC && $$('.optcard[data-id="' + nw.id + '"] .optv.on').length === 1 && $$('.optcard[data-id="' + nw.id + '"] .optv.cand').length === (cw.list.length - 1) * 2;
    S.route = { view: 'appraisal', id: na.id, tab: 'species' }; render(); const ub = $('.spcard[data-id="' + nw.id + '"] details.more [data-act=pick-base]'); if (ub) ub.click();
    out.comparableOnSpeciesTab = !!ub && nw.repl.length === 2 && baseIndex(nw) === 1 && S.route.tab === 'species' && !!$('.spcard[data-id="' + nw.id + '"]');
    S.route = { view: 'appraisal', id: na.id, tab: 'trees' }; render(); out.guessShaded = $$('table.trees .c.guess').length === 2 && !!$('.guessbar');
    type($('tr.dflt [data-bind=cond]'), '65'); ACT['keep-guesses'](); out.guessCleared = na.guess === null && !$('.guessbar') && na.defaults.cond === 65 && na.defaults.loc === 70;
    clearTimeout(timers['appraisals/' + na.id]); delete timers['appraisals/' + na.id]; delete S.appraisals[na.id]; S.route = { view: 'appraisal', id: ex.id, tab: 'trees' }; render();   // never saved
    if (window.__caseSelfTest) { try { out.cases = await window.__caseSelfTest(); } catch (e) { out.casesError = String((e && e.message) || e); } }
    return out;
  };
  window.__app = { S: S, go: go, render: render, parseTreeList: parseTreeList, buildDocx: buildDocx, flush: flush };
  Object.assign(App, { perSqIn: perSqIn, comparables: comparables, START: START, sheetMatches: sheetMatches, fillFromSheets: fillFromSheets, autoBuild: autoBuild, guesses: guesses, migrate: migrate, blankAppraisal: blankAppraisal, baseIndex: baseIndex, replAt: replAt, newTree: newTree, addSpecies: addSpecies, speciesByName: speciesByName, E: E, R: R, $: $, $$: $$, esc: esc, uid: uid, norm: norm, cap: cap, today: today, plural: plural, money: money, fmt: fmt, field: field, seg: seg, save: save, push: push, flush: flush,
    go: go, render: render, toast: toast, openModal: openModal, closeModal: closeModal, armed: armed, setPath: setPath, ACT: ACT, blankAppraisal: blankAppraisal, ctx: ctx });

  // Start once every script on the page has loaded, so the case screens are registered first.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
