/* Expert Report: the assistant. A text box where the arborist says what they want in plain words.
 * Claude answers, and can read and change the open case through the tools below. Every change is listed in the
 * conversation as it is made, and the changes from the last request can be undone in one step. */
(function () {
  'use strict';
  const A = App, S = A.S, $ = A.$, esc = A.esc, E = A.E, R = A.R, C = CaseUI, CR = CaseReport, WU = WriteUI, plural = A.plural, uid = A.uid;
  const G = { open: false, out: false, ready: false, draft: '', msgs: [], log: [], busy: false, snap: null, live: '', changed: 0, voice: { on: false, starting: false, base: '', told: false } };
  const MODEL = () => (S.settings && S.settings.aiModel) || 'claude-opus-5-5';

  // ---------- where the user is ----------
  function rec() { const r = S.route || {}; if (r.view === 'case') return S.cases[r.id] || null; if (r.view === 'appraisal' && S.apHome[r.id]) return S.cases[S.apHome[r.id]] || null; return null; }
  function need() { const r = rec(); if (!r) throw new Error('No case is open. Ask the user to open a case first, or use go_to to open one.'); return r; }
  function where() {
    const r = S.route || {}, cr = rec();
    if (r.view === 'appraisal') { const a = S.appraisals[r.id]; return 'appraisal "' + R.title(a) + '" (' + (r.tab || 'trees') + ' tab)' + (cr ? ' in case "' + cr.doc.name + '"' : ', not filed in a case'); }
    if (r.view === 'case' && cr) return 'case "' + cr.doc.name + '", ' + (r.tab || 'overview') + ' tab';
    return 'the ' + (r.view || 'cases') + ' screen, with no case open';
  }
  function apOf(v, make) {
    const cr = rec(), list = cr ? C.caseAppraisals(cr.doc) : [], cur = S.route.view === 'appraisal' ? S.appraisals[S.route.id] : null, key = String(v || '').trim();
    if (key === 'new' && make) { const c = need().doc, a = A.blankAppraisal(c.name || '', make === '10' ? '10' : '9'); a.client = (c.to && c.to.name) || ''; S.appraisals[a.id] = a; S.apHome[a.id] = c.id; G.lastAp = a.id; did('Started a new appraisal (' + (make === '10' ? '10th' : '9th') + ' edition).'); return a; }
    const hit = key ? (S.appraisals[key] || list.find(a => A.norm(R.title(a)) === A.norm(key))) : (cur || list.find(a => a.id === G.lastAp) || list[0]);
    if (!hit) throw new Error(key ? 'There is no appraisal called "' + key + '". Use look with what "case" to list them.' : 'This case has no appraisal yet. Pass appraisal "new" to start one.');
    G.lastAp = hit.id; return hit;
  }
  function fileOf(v) {
    const cr = need(), c = cr.doc, files = C.filesOf(c), key = String(v || '').trim(), m = /^photo\s*#?\s*(\d+)$/i.exec(key);
    if (m) { const f = C.photosIn(c)[+m[1] - 1]; if (!f) throw new Error('The report has no photo ' + m[1] + '.'); return f; }
    const n = A.norm(key), f = files.find(x => x.rel === key) || files.find(x => A.norm(x.name) === n) || files.find(x => A.norm(x.name.replace(/\.[^.]+$/, '')) === n);
    if (!f) throw new Error('There is no file called "' + key + '" in this case. Use look with what "files" to list them.');
    return f;
  }
  const did = t => { G.changed++; G.log.push({ who: 'did', text: t }); paint(); };
  const str = v => v === null || v === undefined ? '' : String(v).trim();
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null;
  const saveCase = c => A.save('cases', c.id), saveAp = a => A.save('appraisals', a.id);

  // ---------- what the assistant can see ----------
  function seeCase() {
    const cr = need(), c = cr.doc, files = C.filesOf(c), cx = WU.ctxFor(c, cr), d = WU.W.docs[c.id], who = CR.people(c, S.settings);
    return { case: c.name, kind: c.type, report_title: c.reportTitle, report_date: c.reportDate, submitted_to: c.to, signed_by: who.map(p => p.name + (p.credential ? ', ' + p.credential : '')), site_visit: c.visits, site_visit_basis: c.visitsFrom === 'photos' ? 'the day most site photos were taken' : 'typed by the arborist',
      date_of_loss: c.lossDate, retained_by: c.retainedBy, matter: c.matter, notes: c.notes, other_materials: c.otherMaterials,
      photos_in_report: C.photosIn(c).map((f, i) => ({ photo: i + 1, file: f.rel, taken: f.taken || null, caption: (c.files[f.rel] || {}).caption || '', source: (c.files[f.rel] || {}).source || '' })),
      field_note_pages: files.filter(f => C.isNote(c, f)).map(f => ({ file: f.rel, typed_copy: (c.files[f.rel] || {}).transcript || '' })),
      other_files: files.filter(f => !C.isNote(c, f) && C.photosIn(c).indexOf(f) < 0).map(f => f.rel + ' [' + f.kind + ((c.files[f.rel] || {}).reviewed ? ', reviewed' : '') + ']'),
      appraisals: C.caseAppraisals(c).map(a => { const T = E.calcAppraisal(a); return { id: a.id, title: R.title(a), edition: E.edition(a), trees: T.n, incomplete: T.missing, total: E.money(T.total), in_report: !(c.apOut && c.apOut[a.id]) }; }),
      risk_trees: (c.risk.trees || []).length, preservation_trees: (c.preserve.trees || []).length,
      report: d ? { written: true, headings: Object.keys(WU.docSections(d.html)), open_questions: d.questions || [] } : { written: false, outline: c.sections.filter(s => s.on).map(s => s.title) },
      checks: CR.checks(c, cx, d ? d.html : null).map(k => k.text) };
  }
  function seeAppraisal(v) {
    const a = apOf(v), T = E.calcAppraisal(a), ks = E.compareKeys(a), cmp = ks.length ? E.compare(a) : null;
    return { id: a.id, title: R.title(a), edition: E.edition(a), size_entered_as: a.sizeMode || 'dbh', location_rating: (a.locationMode || 'parts') === 'parts' ? 'average of site, contribution, placement' : 'single figure', oversize_trees: a.oversize, rounding: E.roundRule(a), defaults_for_blank_cells: a.defaults,
      species: a.species.map(s => { const u = E.unitCost(s); return { name: s.common, scientific: s.sci, species_rating: s.rating && s.rating.pct, rating_source: s.rating && s.rating.source, installation: s.install, replacement_trees: (s.repl || []).map(r => ({ size: r.size, cost: r.cost, source: r.source || '' })), unit_cost_per_sq_in: u ? +u.unit.toFixed(2) : null }; }),
      trees: a.trees.map((t, i) => { const k = T.rows[i]; return { tree: R.tag(t, i), species: k.sp ? k.sp.common : '', diameter: t.size, condition: t.cond, site: t.site, contribution: t.contrib, placement: t.place, location: t.loc, functional: t.func, external: t.ext, method: k.methodName || t.method, basic_cost: k.basic === null ? null : Math.round(k.basic), value: k.value, missing: k.missing, warnings: k.warn, note: t.note || '' }; }),
      other_costs: (a.lines || []).map((x, i) => ({ description: x.desc, qty: x.qty, each: x.each, amount: T.lineRows[i].amount })),
      totals: { trees: E.money(T.trees), other_costs: E.money(T.lines), total: E.money(T.total), trees_valued: T.done + ' of ' + T.n },
      comparison: cmp ? ks.map(k => ({ approach: E.approach(k).name, total_for_trees: E.money(cmp.by[k].A.trees), by_tree: cmp.by[k].A.rows.map(r => r.value) })) : 'none ticked',
      checks: R.checks(a, T).map(k => k.text) };
  }
  function seeReport() {
    const cr = need(), c = cr.doc, d = WU.W.docs[c.id];
    if (!d) return { written: false, note: 'No report document yet. write_section will start one from the outline.', letter: c.letter, outline: c.sections.filter(s => s.on).map(s => ({ heading: s.title, text: s.text || '' })) };
    return { written: true, sections: WU.docSections(d.html), blocks_from_other_tabs: (d.html.match(/data-auto="[^"]+"/g) || []).map(x => x.slice(11, -1)), open_questions: d.questions || [], checks: CR.checks(c, WU.ctxFor(c, cr), d.html).map(k => k.text) };
  }
  const SEE = {
    case: seeCase, appraisal: seeAppraisal, report: seeReport,
    files: () => { const c = need().doc; return C.filesOf(c).map(f => ({ file: f.rel, kind: f.kind, size_kb: Math.round(f.size / 1024), taken: f.taken || undefined, field_note: C.isNote(c, f) || undefined, notes: c.files[f.rel] || undefined })); },
    risk: () => { const k = need().doc.risk; return { level: k.level, date: k.date, time_frame: k.timeframe, scope: k.scope, trees: (k.trees || []).map((t, i) => { const r = Risk.calcTree(t); return { label: Risk.label(t, i), species: t.species, diameter: t.dbh, height: t.height, location: t.location, parts: (t.rows || []).map((x, j) => ({ part: x.part, concern: x.concern, target: x.target, occupancy: x.occ, failure: x.lof, impact: x.loi, consequences: x.cons, risk: r.rows[j] ? r.rows[j].risk : null })), overall: r.overall, mitigation: t.mitigation, residual: t.residual, next_inspection: t.interval, notes: t.notes }; }) }; },
    preservation: () => { const p = need().doc.preserve; return { method: p.method, method_name: (Zones.METHODS[Zones.methodOf(p)] || {}).name, project: p.project, trees: (p.trees || []).map((t, i) => { const k = Zones.calcTree(t, p); return { label: Zones.label(t, i), species: t.species, diameter: t.dbh, tolerance: t.tol, age: t.age, zone_radius_ft: k.r === null ? null : +k.r.toFixed(1), disturbed_pct: k.total === null ? null : +k.total.toFixed(1), tier: k.tier, needs: k.missing || undefined, disturbances: (t.encs || []).map(e => ({ what: e.desc, kind: e.kind, value: e.value })), notes: t.notes }; }) }; },
    cases: () => Object.keys(S.cases).map(id => ({ id: id, name: S.cases[id].doc.name, kind: S.cases[id].doc.type }))
  };

  // ---------- what the assistant can do ----------
  const NUMS = { condition: 'cond', site: 'site', contribution: 'contrib', placement: 'place', location: 'loc', functional: 'func', external: 'ext' };
  const rating = { type: 'string', description: 'Percent, digits only. An empty string clears the cell.' };
  const TOOLS = [
    { name: 'look', description: 'Read the current state of the app. Call this before answering a question about the case or changing anything, so you work from what is actually there. "case" gives the overview (facts, photos, files, appraisals, report checks); "appraisal" gives every tree with its figures and value as the app worked them out; "report" gives the written text by heading; "files", "risk", "preservation" and "cases" give those lists.',
      input_schema: { type: 'object', properties: { what: { type: 'string', enum: ['case', 'appraisal', 'report', 'files', 'risk', 'preservation', 'cases'] }, appraisal: { type: 'string', description: 'For "appraisal": its id or title. Leave out for the one on screen.' } }, required: ['what'] },
      run: i => { if (!SEE[i.what]) throw new Error('Unknown: ' + i.what); return JSON.stringify(SEE[i.what](i.appraisal)); } },
    { name: 'read_file', description: 'Read a note, an email or another text file in the case. For a picture use view_image.',
      input_schema: { type: 'object', properties: { file: { type: 'string', description: 'File name or path within the case.' } }, required: ['file'] },
      run: async i => { const f = fileOf(i.file); if (f.kind !== 'text' && f.kind !== 'email') throw new Error('That is a ' + f.kind + ' file, which cannot be read as text here.'); const t = await Host.call('caseReadText', { path: need().path, rel: f.rel }); return t.length > 60000 ? t.slice(0, 60000) + '\n[cut off: the file is longer than this]' : t; } },
    { name: 'view_image', description: 'Look at a photo or a photographed page of field notes. Use it when asked to describe, caption or read a picture. Never estimate a trunk diameter, height or condition rating from a photo.',
      input_schema: { type: 'object', properties: { file: { type: 'string', description: 'File name or path, or "Photo 3" for the third photo in the report.' } }, required: ['file'] },
      run: i => { const f = fileOf(i.file); if (f.kind !== 'image') throw new Error('That is not a picture.'); return [{ type: 'text', text: f.rel + (f.taken ? ', taken ' + f.taken.slice(0, 10) : '') }, { type: 'case_image', rel: f.rel, max: 1600 }]; } },
    { name: 'update_case', description: 'Change facts on the case Overview: names, dates, who the report goes to. Only the fields you pass are changed.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, report_title: { type: 'string' }, report_date: { type: 'string', description: 'YYYY-MM-DD' }, submitted_to_name: { type: 'string' }, submitted_to_address: { type: 'string' }, salutation: { type: 'string' }, site_visit: { type: 'string' }, date_of_loss: { type: 'string' }, retained_by: { type: 'string' }, matter: { type: 'string' }, notes: { type: 'string' }, other_materials: { type: 'string', description: 'Materials reviewed that are not files in the case, one per line.' } } },
      run: i => { const c = need().doc, map = { name: 'name', report_title: 'reportTitle', report_date: 'reportDate', site_visit: 'visits', date_of_loss: 'lossDate', retained_by: 'retainedBy', matter: 'matter', notes: 'notes', other_materials: 'otherMaterials' }, done = [];
        Object.keys(map).forEach(k => { if (has(i, k)) { c[map[k]] = String(i[k]); done.push(k.replace(/_/g, ' ')); } });
        if (has(i, 'site_visit')) c.visitsFrom = '';
        c.to = c.to || {}; [['submitted_to_name', 'name'], ['submitted_to_address', 'address'], ['salutation', 'salutation']].forEach(p => { if (has(i, p[0])) { c.to[p[1]] = String(i[p[0]]); done.push(p[0].replace(/_/g, ' ')); } });
        if (!done.length) throw new Error('Nothing to change was passed.'); saveCase(c); did('Case: set ' + done.join(', ') + '.'); return 'Done.'; } },
    { name: 'update_file', description: 'Change what the app records about a file: a photo’s caption and source, whether it is in the report, whether it is a page of field notes and its typed copy, or a document’s description and whether the arborist reviewed it.',
      input_schema: { type: 'object', properties: { file: { type: 'string', description: 'File name or path, or "Photo 3".' }, caption: { type: 'string' }, source: { type: 'string', description: 'Who took or supplied it.' }, in_report: { type: 'boolean' }, field_note: { type: 'boolean' }, typed_copy: { type: 'string' }, description: { type: 'string' }, reviewed: { type: 'boolean' } }, required: ['file'] },
      run: i => { const c = need().doc, f = fileOf(i.file), m = C.meta(c, f.rel), done = [];
        [['caption', 'caption'], ['source', 'source'], ['typed_copy', 'transcript'], ['description', 'desc']].forEach(p => { if (has(i, p[0])) { m[p[1]] = String(i[p[0]]); done.push(p[0].replace(/_/g, ' ')); } });
        if (has(i, 'caption')) m.captionBy = 'assistant'; if (has(i, 'typed_copy')) m.transcriptBy = 'draft';
        if (has(i, 'reviewed')) { m.reviewed = !!i.reviewed; done.push(i.reviewed ? 'marked reviewed' : 'not reviewed'); }
        if (has(i, 'field_note')) { m.fieldNote = !!i.field_note; if (i.field_note) c.photos = (c.photos || []).filter(x => x !== f.rel); done.push(i.field_note ? 'filed as a field note page' : 'not a field note'); }
        if (has(i, 'in_report')) { if (f.kind !== 'image') throw new Error('Only pictures go on the photo pages.'); c.photos = (c.photos || []).filter(x => x !== f.rel); if (i.in_report) c.photos.push(f.rel); done.push(i.in_report ? 'added to the report' : 'taken out of the report'); }
        if (!done.length) throw new Error('Nothing to change was passed.'); saveCase(c); did(f.name + ': ' + done.join(', ') + '.'); return 'Done.'; } },
    { name: 'update_trees', description: 'Add trees to an appraisal or change trees already in it. A tree whose "tree" label matches an existing one is changed; otherwise it is added. Only the fields you pass are changed. The app works out every value itself: never pass or state a value you calculated.',
      input_schema: { type: 'object', properties: { appraisal: { type: 'string', description: 'Id or title; leave out for the one on screen; "new" starts one.' }, new_edition: { type: 'string', enum: ['9', '10'], description: 'Only with appraisal "new".' },
        trees: { type: 'array', items: { type: 'object', properties: { tree: { type: 'string', description: 'Tree number or label.' }, rename_to: { type: 'string' }, species: { type: 'string', description: 'Common name.' }, diameter: { type: 'string', description: 'Trunk size as measured, in inches; several stems as 21+24.' },
          condition: rating, site: rating, contribution: rating, placement: rating, location: rating, functional: rating, external: rating, method: { type: 'string', enum: ['auto', 'formula', 'replace'] }, note: { type: 'string' } }, required: ['tree'] } } }, required: ['trees'] },
      run: i => { const a = apOf(i.appraisal, i.new_edition || '9'); let added = 0, changed = 0;
        i.trees.forEach(x => { const key = str(x.tree); let t = a.trees.find((y, j) => R.tag(y, j) === key);
          if (!t) { t = A.newTree(a); t.sp = ''; t.tag = key; a.trees.push(t); added++; } else changed++;
          if (has(x, 'rename_to')) t.tag = str(x.rename_to);
          if (has(x, 'species') && str(x.species)) { const sp = A.speciesByName(a, x.species) || A.addSpecies(a, x.species); t.sp = sp.id; }
          if (has(x, 'diameter')) t.size = str(x.diameter);
          Object.keys(NUMS).forEach(k => { if (has(x, k)) { t[NUMS[k]] = E.num(x[k]); if (t.guess) delete t.guess[NUMS[k]]; } });
          if (has(x, 'method')) t.method = x.method; if (has(x, 'note')) t.note = String(x.note); });
        saveAp(a); did('Appraisal "' + R.title(a) + '": ' + [added ? plural(added, 'tree') + ' added' : '', changed ? plural(changed, 'tree') + ' changed' : ''].filter(Boolean).join(', ') + ' (' + i.trees.map(x => x.tree).slice(0, 12).join(', ') + (i.trees.length > 12 ? '…' : '') + ').');
        const T = E.calcAppraisal(a); return JSON.stringify({ appraisal: a.id, trees: T.n, valued: T.done, total: E.money(T.total), still_missing: T.rows.map((k, j) => k.missing.length ? R.tag(a.trees[j], j) + ': ' + k.missing.join(', ') : '').filter(Boolean).slice(0, 20) }); } },
    { name: 'remove_trees', description: 'Take trees out of an appraisal.',
      input_schema: { type: 'object', properties: { appraisal: { type: 'string' }, trees: { type: 'array', items: { type: 'string' }, description: 'Tree numbers or labels.' } }, required: ['trees'] },
      run: i => { const a = apOf(i.appraisal), want = i.trees.map(str), before = a.trees.length, keep = a.trees.filter((t, j) => want.indexOf(R.tag(t, j)) < 0); a.trees = keep; const n = before - keep.length; if (!n) throw new Error('None of those trees is in the appraisal.'); saveAp(a); did('Appraisal "' + R.title(a) + '": removed ' + plural(n, 'tree') + ' (' + want.join(', ') + ').'); return 'Removed ' + n + '.'; } },
    { name: 'update_appraisal', description: 'Change an appraisal’s settings: its title, the edition it follows, the ratings used for blank cells, which editions and methods are compared side by side, and how trees too large to replace are handled.',
      input_schema: { type: 'object', properties: { appraisal: { type: 'string' }, title: { type: 'string' }, edition: { type: 'string', enum: ['9', '10'] }, compare: { type: 'array', items: { type: 'string', enum: ['9f', '9r', '10f', '10r'] }, description: '9f 9th edition Trunk Formula Method, 9r 9th edition Replacement Cost Method, 10f 10th edition Trunk Formula Technique, 10r 10th edition direct replacement. The list replaces what is ticked; an empty list turns the comparison off.' },
        defaults: { type: 'object', properties: { condition: rating, site: rating, contribution: rating, placement: rating, location: rating, functional: rating, external: rating } }, oversize_trees: { type: 'string', enum: ['formula', 'largest'], description: 'formula: trunk formula; largest: value at the largest replacement tree listed.' }, in_report: { type: 'boolean' } } },
      run: i => { const a = apOf(i.appraisal), done = [];
        if (has(i, 'title')) { a.title = String(i.title); done.push('title'); }
        if (has(i, 'edition') && E.edition(a) !== i.edition) { a.edition = i.edition; a.rounding = i.edition === '9' ? 'guide9' : 100; done.push(i.edition === '9' ? '9th edition' : '10th edition'); }
        if (has(i, 'compare')) { a.compare = {}; i.compare.forEach(k => { if (E.approach(k)) a.compare[k] = true; }); done.push(i.compare.length ? 'comparing ' + i.compare.map(k => E.approach(k).short).join(', ') : 'comparison off'); }
        if (has(i, 'defaults')) { a.defaults = a.defaults || {}; Object.keys(NUMS).forEach(k => { if (has(i.defaults, k)) { a.defaults[NUMS[k]] = E.num(i.defaults[k]); if (a.guess) delete a.guess[NUMS[k]]; } }); done.push('ratings for blank cells'); }
        if (has(i, 'oversize_trees')) { a.oversize = i.oversize_trees; done.push('oversize trees: ' + i.oversize_trees); }
        if (has(i, 'in_report') && S.apHome[a.id]) { const c = S.cases[S.apHome[a.id]].doc; c.apOut = c.apOut || {}; if (i.in_report) delete c.apOut[a.id]; else c.apOut[a.id] = true; saveCase(c); done.push(i.in_report ? 'in the report' : 'left out of the report'); }
        if (!done.length) throw new Error('Nothing to change was passed.'); saveAp(a); did('Appraisal "' + R.title(a) + '": ' + done.join('; ') + '.'); return 'Done. Total is now ' + E.money(E.calcAppraisal(a).total) + '.'; } },
    { name: 'update_species', description: 'Set what an appraisal needs for a species: its species rating, the installation cost, and the replacement trees with their nursery prices. Prices must come from the user or a price sheet in the case, never from your own knowledge.',
      input_schema: { type: 'object', properties: { appraisal: { type: 'string' }, species: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, species_rating: rating, installation: { type: 'string', description: 'Dollars.' }, replacement_trees: { type: 'array', description: 'Replaces the list for this species.', items: { type: 'object', properties: { size: { type: 'string', description: 'Caliper in inches, e.g. 3 or 2.5-3.' }, cost: { type: 'string' }, source: { type: 'string' } }, required: ['size', 'cost'] } } }, required: ['name'] } } }, required: ['species'] },
      run: i => { const a = apOf(i.appraisal), names = [];
        i.species.forEach(x => { const sp = A.speciesByName(a, x.name) || A.addSpecies(a, x.name); names.push(sp.common);
          if (has(x, 'species_rating')) { sp.rating = sp.rating || {}; sp.rating.pct = E.num(x.species_rating); if (sp.rating.listPct !== sp.rating.pct) sp.rating.source = 'custom'; }
          if (has(x, 'installation')) sp.install = E.num(x.installation);
          if (has(x, 'replacement_trees')) sp.repl = x.replacement_trees.map(r => ({ size: str(r.size), cost: E.num(r.cost), source: str(r.source), base: false, ltd: false })); });
        saveAp(a); did('Appraisal "' + R.title(a) + '": species and costs set for ' + names.join(', ') + '.'); return 'Done. Total is now ' + E.money(E.calcAppraisal(a).total) + '.'; } },
    { name: 'update_costs', description: 'Set the other cost lines of an appraisal (stump grinding, cleanup, and so on).',
      input_schema: { type: 'object', properties: { appraisal: { type: 'string' }, replace_all: { type: 'boolean', description: 'true replaces every line; otherwise the lines are added.' }, lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, qty: { type: 'string' }, each: { type: 'string' }, amount: { type: 'string', description: 'Use instead of qty and each for a lump sum.' } }, required: ['description'] } } }, required: ['lines'] },
      run: i => { const a = apOf(i.appraisal); if (i.replace_all) a.lines = []; a.lines = a.lines || []; i.lines.forEach(x => a.lines.push({ id: uid(), desc: String(x.description), qty: E.num(x.qty), each: E.num(x.each), amt: E.num(x.amount) })); saveAp(a); did('Appraisal "' + R.title(a) + '": ' + (i.replace_all ? 'cost lines replaced with ' : 'added ') + plural(i.lines.length, 'cost line') + '.'); return 'Done. Other costs now ' + E.money(E.calcAppraisal(a).lines) + '.'; } },
    { name: 'write_section', description: 'Write or change the text under a heading of the report. Use blank lines between paragraphs and start a line with "- " for a list item. Write only what the case material supports; leave the arborist’s own observations and opinions as [bracketed gaps] unless they have told you what to say. Tables, the cover, signatures and photo pages are not text and cannot be changed here.',
      input_schema: { type: 'object', properties: { heading: { type: 'string', description: 'The heading as it appears in the report. A heading that is not there yet is added.' }, text: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] } }, required: ['heading', 'text', 'mode'] },
      run: i => writeSection(i) },
    { name: 'update_risk', description: 'Add or change trees in the tree risk assessment. A tree whose label matches is changed; otherwise it is added. The app works out the ratings from the likelihoods and consequences you enter; enter only what the arborist recorded or told you.',
      input_schema: { type: 'object', properties: { trees: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, species: { type: 'string' }, diameter: { type: 'string' }, height: { type: 'string' }, location: { type: 'string' }, mitigation: { type: 'string' }, residual_risk: { type: 'string', enum: Risk.RISK }, next_inspection: { type: 'string' }, notes: { type: 'string' },
        parts: { type: 'array', description: 'Replaces the tree’s rows.', items: { type: 'object', properties: { part: { type: 'string' }, concern: { type: 'string' }, target: { type: 'string' }, occupancy: { type: 'string', enum: Risk.OCC }, failure: { type: 'string', enum: Risk.FAIL }, impact: { type: 'string', enum: Risk.IMPACT }, consequences: { type: 'string', enum: Risk.CONSEQ } } } } }, required: ['label'] } } }, required: ['trees'] },
      run: i => { const c = need().doc, k = c.risk; k.trees = k.trees || []; const names = [];
        i.trees.forEach(x => { const key = str(x.label); let t = k.trees.find((y, j) => Risk.label(y, j) === key); if (!t) { t = { id: uid(), label: key, species: '', dbh: '', height: '', location: '', rows: [], mitigation: '', residual: '', interval: '', notes: '' }; k.trees.push(t); }
          [['species', 'species'], ['diameter', 'dbh'], ['height', 'height'], ['location', 'location'], ['mitigation', 'mitigation'], ['residual_risk', 'residual'], ['next_inspection', 'interval'], ['notes', 'notes']].forEach(p => { if (has(x, p[0])) t[p[1]] = String(x[p[0]]); });
          if (has(x, 'parts')) t.rows = x.parts.map(r => ({ id: uid(), part: str(r.part), concern: str(r.concern), target: str(r.target), occ: str(r.occupancy), lof: str(r.failure), loi: str(r.impact), cons: str(r.consequences) })); names.push(key); });
        saveCase(c); did('Risk assessment: set tree ' + names.join(', ') + '.'); return JSON.stringify(SEE.risk().trees.filter(t => names.indexOf(t.label) >= 0).map(t => ({ label: t.label, overall: t.overall }))); } },
    { name: 'update_preservation', description: 'Add or change trees on the Preservation tab (protection zones for construction near trees). The app works out the zone radius and the share disturbed.',
      input_schema: { type: 'object', properties: { project: { type: 'string', description: 'What is being built near the trees.' }, trees: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, species: { type: 'string' }, diameter: { type: 'string' }, tolerance: { type: 'string', enum: ['good', 'moderate', 'poor'], description: 'Species tolerance of construction.' }, age: { type: 'string', enum: ['young', 'mature', 'over'] }, notes: { type: 'string' },
        disturbances: { type: 'array', description: 'Replaces the tree’s list.', items: { type: 'object', properties: { what: { type: 'string' }, kind: { type: 'string', enum: ['line', 'pct', 'area'], description: 'line: a straight edge, value is its distance from the trunk in feet; pct: percent of the zone; area: square feet.' }, value: { type: 'string' } }, required: ['kind', 'value'] } } }, required: ['label'] } } } },
      run: i => { const c = need().doc, p = c.preserve; p.trees = p.trees || []; const names = [];
        if (has(i, 'project')) p.project = String(i.project);
        (i.trees || []).forEach(x => { const key = str(x.label); let t = p.trees.find((y, j) => Zones.label(y, j) === key); if (!t) { t = { id: uid(), label: key, species: '', dbh: '', tol: '', age: '', encs: [], notes: '' }; p.trees.push(t); }
          [['species', 'species'], ['diameter', 'dbh'], ['tolerance', 'tol'], ['age', 'age'], ['notes', 'notes']].forEach(q => { if (has(x, q[0])) t[q[1]] = String(x[q[0]]); });
          if (has(x, 'disturbances')) t.encs = x.disturbances.map(e => ({ id: uid(), desc: str(e.what), kind: e.kind, value: E.num(e.value) })); names.push(key); });
        saveCase(c); did('Preservation: ' + (names.length ? 'set tree ' + names.join(', ') : 'project described') + '.'); return JSON.stringify(SEE.preservation().trees.filter(t => names.indexOf(t.label) >= 0)); } },
    { name: 'go_to', description: 'Show the user a screen: a tab of the open case, an appraisal, or another case.',
      input_schema: { type: 'object', properties: { tab: { type: 'string', enum: ['overview', 'files', 'photos', 'notes', 'appraisal', 'risk', 'preserve', 'report', 'trees', 'species', 'costs', 'results', 'setup'], description: 'The first eight are case tabs; trees, species, costs, results and setup are tabs of an appraisal.' }, appraisal: { type: 'string' }, case: { type: 'string', description: 'Id or name of another case to open.' } } },
      run: i => { if (has(i, 'case')) { const id = S.cases[i.case] ? i.case : Object.keys(S.cases).find(k => A.norm(S.cases[k].doc.name) === A.norm(i.case)); if (!id) throw new Error('There is no case called "' + i.case + '".'); A.go({ view: 'case', id: id, tab: i.tab || 'overview' }); return 'Opened ' + S.cases[id].doc.name + '.'; }
        if (['trees', 'species', 'costs', 'results', 'setup'].indexOf(i.tab) >= 0 || has(i, 'appraisal')) { const a = apOf(i.appraisal); A.go({ view: 'appraisal', id: a.id, tab: ['trees', 'species', 'costs', 'results', 'setup'].indexOf(i.tab) >= 0 ? i.tab : 'trees' }); return 'Showing the appraisal.'; }
        const cr = need(); A.go({ view: 'case', id: cr.doc.id, tab: i.tab || 'overview' }); return 'Showing the ' + (i.tab || 'overview') + ' tab.'; } }
  ];
  function writeSection(i) {
    const cr = need(), c = cr.doc; WU.sync();
    if (!WU.W.docs[c.id]) { if (WU.W.state[c.id] !== 'ready') throw new Error('The report is still opening. Use go_to with tab "report" and try again.'); WU.startDoc(c, cr); did('Started the report document from the outline.'); }
    const d = WU.W.docs[c.id], box = new DOMParser().parseFromString('<div id="r">' + d.html + '</div>', 'text/html').getElementById('r'), want = A.norm(i.heading);
    let h = Array.from(box.children).find(n => n.tagName === 'H2' && A.norm(n.textContent) === want), added = false;
    if (!h) { h = box.ownerDocument.createElement('h2'); h.textContent = String(i.heading).trim(); const before = Array.from(box.children).find(n => n.tagName === 'H2' && /certification/i.test(n.textContent)); if (before) box.insertBefore(h, before); else box.appendChild(h); added = true; }
    const own = []; for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) own.push(n);
    const text = own.filter(n => !n.hasAttribute('data-auto'));
    if (i.mode === 'replace') text.forEach(n => n.remove());
    const tmp = box.ownerDocument.createElement('div');
    tmp.innerHTML = CR.paras(i.text).map(b => b.t === 'bullets' ? '<ul>' + b.items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p>' + esc(b.text) + '</p>').join('');
    let at = i.mode === 'append' && text.length ? text[text.length - 1] : h;
    Array.from(tmp.children).forEach(n => { at.after(n); at = n; });
    d.html = box.innerHTML; WU.dropPage(c.id); WU.saveDoc(c.id, 0);
    const s = c.sections.find(x => A.norm(x.title) === want); if (s) { s.text = i.mode === 'append' && str(s.text) ? s.text + '\n\n' + i.text : i.text; saveCase(c); }
    did('Report: ' + (added ? 'added the section “' : i.mode === 'append' ? 'added to “' : 'rewrote “') + h.textContent + '”.');
    return 'Done. ' + CR.checks(c, WU.ctxFor(c, cr), d.html).length + ' checks are now showing for the report.';
  }

  const SYSTEM = [
    'You are the assistant built into Expert Report, a Mac app a consulting arborist uses to keep case files and write expert reports: tree appraisals under the Guide for Plant Appraisal (9th and 10th editions), tree risk assessments, tree preservation plans for construction, and the written report. The arborist types to you in a small panel beside their work. They are an expert in trees and not a programmer; speak plainly and briefly, the way a capable assistant in their office would.',
    'You act on the app through tools. When the arborist asks for something to be done, do it rather than explaining how, then say in a sentence or two what you changed. Call look first whenever the answer depends on what is in the case; do not rely on memory of an earlier look after changes have been made. If a request could mean two different things that would lead to different changes, ask one short question instead of guessing. Each message from the arborist begins with a bracketed note of the screen they are on; "this", "here" and "the appraisal" refer to that.',
    'The report will be signed by the arborist and may be tested in court, so three rules are firm. First, the app does the arithmetic: read values from look and never state a figure you worked out yourself. Second, measurements, ratings, prices and observations come from the arborist or from material in the case; never invent one, never estimate a measurement or a rating from a photograph, and when something needed is missing, say so and ask. Third, opinions and conclusions are the arborist’s: write them up when they tell you what they are, and otherwise leave a [bracketed gap] in report text. Do not describe the arborist as ISA certified or TRAQ qualified unless they have told you so.',
    'Everything you change is listed for the arborist as you go and can be undone, so you do not need to ask permission for ordinary edits they have requested. Do ask before removing trees or replacing text they wrote unless they asked for exactly that. You cannot delete files, send anything outside the app, export the report or change settings; if asked, say where in the app they can do it. If a tool reports an error, read it, fix the request if you can, and otherwise tell the arborist plainly what stopped you.'
  ].join('\n\n');

  // ---------- one request from the user ----------
  function valid(s, v) {
    if (!s || !s.type) return true;
    if (s.type === 'object') { if (!v || typeof v !== 'object' || Array.isArray(v)) return false; if ((s.required || []).some(k => v[k] === undefined || v[k] === null)) return false; return Object.keys(s.properties || {}).every(k => v[k] === undefined || v[k] === null || valid(s.properties[k], v[k])); }
    if (s.type === 'array') return Array.isArray(v) && v.every(x => valid(s.items, x));
    if (s.type === 'string') return (typeof v === 'string' || typeof v === 'number') && (!s.enum || s.enum.indexOf(String(v)) >= 0);
    if (s.type === 'boolean') return typeof v === 'boolean';
    return true;
  }
  // After a fallback to another model, the blocks before the switch that only the first model understands are left out, as the API requires.
  function echo(content) {
    let last = -1; content.forEach((b, i) => { if (b.type === 'fallback') last = i; });
    return last < 0 ? content : content.filter((b, i) => i >= last || (b.type !== 'thinking' && b.type !== 'redacted_thinking' && b.type !== 'tool_use'));
  }
  function snapshot() {
    const cr = rec(), ap = S.route.view === 'appraisal' ? S.appraisals[S.route.id] : null, s = { caseId: cr ? cr.doc.id : null, aps: {}, apIds: Object.keys(S.appraisals) };
    if (cr) { s.doc = JSON.stringify(cr.doc); C.caseAppraisals(cr.doc).forEach(a => { s.aps[a.id] = JSON.stringify(a); }); s.report = WU.W.docs[cr.doc.id] ? JSON.stringify(WU.W.docs[cr.doc.id]) : null; }
    if (ap) s.aps[ap.id] = JSON.stringify(ap);
    return s;
  }
  function undo() {
    const s = G.snap; if (!s || G.busy) return;
    Object.keys(S.appraisals).forEach(id => { if (s.apIds.indexOf(id) < 0) { const cid = S.apHome[id]; delete S.appraisals[id]; delete S.apHome[id]; if (cid && S.cases[cid]) Host.call('caseRemove', { path: S.cases[cid].path, name: 'appraisal-' + id }); if (S.route.view === 'appraisal' && S.route.id === id) S.route = cid ? { view: 'case', id: cid, tab: 'appraisal' } : { view: 'home' }; } });
    Object.keys(s.aps).forEach(id => { S.appraisals[id] = JSON.parse(s.aps[id]); A.save('appraisals', id, 0); });
    if (s.caseId && S.cases[s.caseId]) { S.cases[s.caseId].doc = JSON.parse(s.doc); A.save('cases', s.caseId, 0); if (s.report) { WU.W.docs[s.caseId] = JSON.parse(s.report); WU.dropPage(s.caseId); WU.saveDoc(s.caseId, 0); } else if (WU.W.docs[s.caseId]) { WU.W.docs[s.caseId] = null; WU.dropPage(s.caseId); Host.call('caseRemove', { path: S.cases[s.caseId].path, name: 'report' }); } }
    G.snap = null; G.log.push({ who: 'note', text: 'Those changes were undone.' });
    G.msgs.push({ role: 'user', content: [{ type: 'text', text: '[The arborist pressed Undo: every change you made in answer to their last request has been reversed. Look again before relying on anything.]' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Understood.' }] });
    A.render(); paint();
  }
  async function send(text) {
    if (G.busy || !str(text)) return;
    const st = await Host.call('aiKeyStatus').catch(() => null);
    if (!st || !st.set) { G.log.push({ who: 'you', text: text }, { who: 'key', text: '' }); paint(); return; }
    G.busy = true; G.live = ''; G.changed = 0; const start = G.msgs.length, snap = snapshot(), cr = rec();
    G.log.push({ who: 'you', text: text }); paint();
    G.msgs.push({ role: 'user', content: [{ type: 'text', text: '[On screen: ' + where() + '. Today is ' + A.today() + '.]\n' + text }] });
    try {
      for (let step = 0; step < 16; step++) {
        const res = await Host.call('aiTurn', { path: cr ? cr.path : (rec() || {}).path, model: MODEL(), effort: 'medium', maxTokens: 16000, system: SYSTEM, messages: G.msgs, tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true })) });
        G.live = '';
        if (res.stop === 'refusal') throw new Error('Anthropic’s safety filter declined that request' + (res.detail ? ' (category: ' + res.detail + ')' : '') + '. Try wording it differently.');
        const content = echo(res.content || []), bad = res.invalid || {};
        if (!content.length) throw new Error('The assistant sent back nothing. Try again.');
        G.msgs.push({ role: 'assistant', content: content });
        content.filter(b => b.type === 'text' && str(b.text)).forEach(b => G.log.push({ who: 'agent', text: b.text.trim() }));
        const uses = content.filter(b => b.type === 'tool_use'); paint();
        if (!uses.length) { if (res.stop === 'max_tokens') G.log.push({ who: 'note', text: 'That answer was cut off at the length limit.' }); break; }
        const results = [];
        for (const u of uses) {
          const t = TOOLS.find(x => x.name === u.name); let out, err = false;
          if (res.stop === 'max_tokens') { out = 'This request was cut off before it was complete, so it was not carried out. Send it again in smaller pieces.'; err = true; }
          else if (bad[u.id] !== undefined) { out = JSON.stringify({ INVALID_JSON: bad[u.id] }); err = true; }
          else if (!t) { out = 'There is no tool called ' + u.name + '.'; err = true; }
          else if (!valid(t.input_schema, u.input)) { out = 'The input did not match what this tool takes. Check the required fields and the allowed values, then send it again.'; err = true; }
          else { try { out = await t.run(u.input || {}); } catch (e) { out = e.message || String(e); err = true; } }
          const r = { type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : out }; if (err) r.is_error = true; results.push(r);
        }
        G.msgs.push({ role: 'user', content: results });
        if (G.changed) A.render();
        if (step === 15) G.log.push({ who: 'note', text: 'The assistant stopped after many steps. Ask it to carry on if the job is not finished.' });
      }
    } catch (e) {
      // The exchange that failed is dropped from the conversation, so the next message starts from a clean history. Changes already made stay, and can be undone.
      G.msgs.length = start; G.log.push({ who: 'err', text: e.message || String(e) });
    }
    G.busy = false; G.live = ''; if (G.changed) { G.snap = snap; G.log.push({ who: 'undo', text: plural(G.changed, 'change') }); await A.flush(); A.render(); }
    paint(); focusBox();
  }
  // ---------- speaking instead of typing ----------
  // What is said appears in the text box as it is heard. Nothing is sent until the user presses Send, so a misheard word can be fixed first.
  function vocabulary() {
    const w = ['DBH', 'diameter', 'trunk formula', 'replacement cost', 'condition rating', 'species rating', 'location rating', 'functional limitations', 'external limitations', 'caliper', 'appraisal', 'tree protection zone', 'critical root zone', 'stump', 'water oak', 'live oak', 'pecan', 'bald cypress', 'sweetgum', 'loblolly pine', 'hackberry', 'crape myrtle', 'southern magnolia', 'Chinese tallow', 'ninth edition', 'tenth edition'];
    const cr = rec(); if (cr) C.caseAppraisals(cr.doc).forEach(a => a.species.forEach(s => { if (s.common && w.indexOf(s.common) < 0) w.push(s.common); }));
    return w;
  }
  async function voice() {
    const v = G.voice; if (G.busy || v.starting) return;
    if (v.on) { Host.call('voiceStop').catch(() => { }); return; }      // the last words arrive through __voice, which also switches the button off
    v.starting = true; v.base = text(); paint();
    try {
      const r = await Host.call('voiceStart', { words: vocabulary() }); v.on = true;
      if (r && r.onDevice === false && !v.told) { v.told = true; G.log.push({ who: 'note', text: 'This Mac does not transcribe speech by itself, so what you say to the microphone is sent to Apple to be turned into text.' }); }
    } catch (e) { G.log.push({ who: 'err', text: e.message || String(e) }); }
    v.starting = false; paint(); focusBox();
  }
  window.__voice = m => {
    const v = G.voice; if (!v.on || !m) return;
    if (typeof m.text === 'string' && m.text) setText(v.base + (v.base && !/\s$/.test(v.base) ? ' ' : '') + m.text);
    if (m.done) { v.on = false; if (m.error) G.log.push({ who: 'note', text: m.error }); paint(); focusBox(true); }
  };
  window.__aiLive = t => { if (!G.busy) return; G.live = String(t || ''); const el = $('#agent-live'); if (el) { el.textContent = G.live; el.hidden = !G.live; const lg = $('#agent-log'); if (lg) lg.scrollTop = lg.scrollHeight; } tell({ t: 'live', text: G.live }); };

  // ---------- the panel ----------
  const EXAMPLES = ['What is still missing from this report?', 'Add tree 4: water oak, 22 inches, condition 60', 'Compare the 9th and 10th edition for this appraisal', 'Look at photo 2 and suggest a caption'];
  function line(x, i, all) {
    if (x.who === 'you') return '<div class="ag you">' + esc(x.text) + '</div>';
    if (x.who === 'agent') return '<div class="ag bot">' + esc(x.text).replace(/\n/g, '<br>') + '</div>';
    if (x.who === 'did') return '<div class="ag did">' + esc(x.text) + '</div>';
    if (x.who === 'err') return '<div class="ag err">' + esc(x.text) + '</div>';
    if (x.who === 'key') return '<div class="ag note">The assistant uses your own Anthropic API key. Add it once in Settings. <button class="link" data-act="ai-open-settings">Open Settings</button></div>';
    if (x.who === 'undo') return i === all.length - 1 && G.snap ? '<div class="ag note">' + esc(x.text) + ' made. <button class="link" data-act="agent-undo">Undo ' + (G.changed === 1 ? 'it' : 'them') + '</button></div>' : '';
    return '<div class="ag note">' + esc(x.text) + '</div>';
  }
  // What the panel shows. `away` is the panel in its own window: the window has a title bar of its own, so the header only carries the buttons.
  const POP = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function panel(away) {
    const fresh = G.log.length ? '<button class="link" data-act="agent-new"' + (G.busy ? ' disabled' : '') + '>New conversation</button>' : '';
    return '<section class="agent-panel" role="dialog" aria-label="Assistant">' +
      (away ? '<header class="win"><span class="sp"></span>' + fresh + '<button class="link" data-act="agent-dock" title="Show the assistant inside the main window again">Put back in the main window</button></header>'
        : '<header title="' + (canDragOut ? 'Drag to move. Drag it past the edge of this window and it becomes a window of its own. Double-click to put it back in the corner.' : 'Drag to move. Double-click to put it back in the corner.') + '"><span class="grip" aria-hidden="true"></span><b>Assistant</b><span class="sp"></span>' + fresh +
          (canPop ? '<button class="icon" data-act="agent-pop" aria-label="Move the assistant to a window of its own" title="Move to a window of its own, which can sit beside this window or on another screen">' + POP + '</button>' : '') +
          '<button class="icon" data-act="agent-toggle" aria-label="Close the assistant" title="Close">✕</button></header>') +
      '<div id="agent-log" aria-live="polite">' + (G.log.length ? G.log.map(line).join('') : '<p class="hint">Tell me what you want done in this case, or ask about it. I can read the case, fill in and change the appraisal, risk and preservation tables, caption photos, and write report sections. Everything I change is listed here and can be undone.</p>' + EXAMPLES.map(e => '<button class="ag-ex" data-act="agent-example">' + esc(e) + '</button>').join('')) +
      '<div class="ag bot" id="agent-live"' + (G.live ? '' : ' hidden') + '>' + esc(G.live) + '</div>' + (G.busy ? '<div class="ag note" id="agent-busy">Working…</div>' : '') + '</div>' +
      '<footer><textarea id="agent-in" rows="2" placeholder="' + (G.voice.on ? 'Listening… say what you want done' : 'Type what you want done, or use the microphone…') + '" aria-label="Message to the assistant"' + (G.busy ? ' disabled' : '') + '></textarea>' +
      '<button class="mic' + (G.voice.on ? ' on' : '') + '" data-act="agent-voice" aria-pressed="' + G.voice.on + '" aria-label="' + (G.voice.on ? 'Stop listening' : 'Speak your request') + '" title="' + (G.voice.on ? 'Listening. Click to stop.' : 'Speak your request') + '"' + (G.busy || G.voice.starting ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>' +
      '<button class="btn primary" data-act="agent-send"' + (G.busy ? ' disabled' : '') + '>Send</button></footer></section>';
  }
  function paint() {
    let root = $('#agent');
    if (!root) { root = document.createElement('div'); root.id = 'agent'; document.body.appendChild(root); }
    if (G.out) {
      root.innerHTML = '<button class="agent-fab away" data-act="agent-front" title="The assistant is in its own window. Click to bring it forward.">Assistant</button>'; place();
      tell({ t: 'paint', html: panel(true) }); return;
    }
    if (!G.open) { root.innerHTML = '<button class="agent-fab" data-act="agent-toggle" aria-label="Open the assistant">Assistant</button>'; place(); return; }
    const keep = $('#agent-in') ? $('#agent-in').value : G.draft; G.draft = '';
    root.innerHTML = panel(false);
    place(); const box = $('#agent-in'); if (box) box.value = keep; const lg = $('#agent-log'); if (lg) lg.scrollTop = lg.scrollHeight;
  }

  // ---------- the text box, wherever the panel is ----------
  const text = () => G.out ? G.draft : (($('#agent-in') || {}).value || '');
  function setText(v, focus) {
    if (G.out) { G.draft = v; tell({ t: 'value', value: v, focus: !!focus }); return; }
    const b = $('#agent-in'); if (!b) return;
    b.value = v; b.scrollTop = b.scrollHeight; if (focus) { b.focus(); b.setSelectionRange(v.length, v.length); }
  }
  function focusBox(end) {
    if (G.out) { tell({ t: 'focus', end: !!end }); return; }
    const b = $('#agent-in'); if (!b) return;
    b.focus(); if (end) b.setSelectionRange(b.value.length, b.value.length);
  }

  // ---------- the panel in a window of its own ----------
  // A panel drawn on the page cannot leave the main window, so the Mac app can open a second window for it (the preview opens a browser window).
  // This page stays in charge. It sends that window what to draw (`tell`); what is clicked or typed there comes back through `__agentRemote`.
  // The choice is remembered in the settings, so the Assistant button opens the window again next time.
  const chan = Host.mode === 'server' && window.BroadcastChannel ? new BroadcastChannel('er-assistant') : null;
  const canPop = Host.mode === 'app' || !!chan;
  const canDragOut = Host.mode === 'app';   // dragging the panel past the edge of the main window turns it into its own window, still under the pointer
  let popup = null;
  function tell(m) {
    if (!G.out) return;
    if (Host.mode === 'app') Host.call('agentWindow', { op: 'post', msg: m }).catch(() => { });
    else if (chan) chan.postMessage({ to: 'panel', m: m });
  }
  function remember(v) { const st = S.settings; if (st && !!st.agentOut !== v) { st.agentOut = v; A.save('library', 'settings'); } }
  async function popOut(grab) {
    if (G.out || !canPop) return;
    const draft = text();
    try {
      if (Host.mode === 'app') await Host.call('agentWindow', { op: 'open', grab: grab || null });
      else { popup = window.open('assistant.html', 'er-assistant', 'popup,width=440,height=660'); if (!popup) throw new Error('The browser did not allow a new window.'); }
    } catch (e) { G.open = true; G.log.push({ who: 'err', text: 'The assistant could not be moved to its own window. ' + (e.message || e) }); paint(); return; }
    G.draft = draft; G.ready = false; G.out = true; G.open = true; remember(true); paint();   // the window asks for its contents when it has loaded
  }
  function dock(open) {
    if (!G.out) return;
    G.out = false; G.ready = false; G.open = !!open; remember(false);
    if (Host.mode === 'app') Host.call('agentWindow', { op: 'close' }).catch(() => { }); else if (popup) { try { popup.close(); } catch (e) { } popup = null; }
    paint(); if (open) focusBox(true);
  }
  const REMOTE = ['agent-send', 'agent-voice', 'agent-example', 'agent-undo', 'agent-new', 'agent-dock', 'ai-open-settings'];
  window.__agentRemote = m => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'probe') { if (G.onProbe) G.onProbe(m); return; }
    if (!G.out) return;
    if (m.t === 'ready') { G.ready = true; tell({ t: 'paint', html: panel(true), value: G.draft, focus: true }); }
    else if (m.t === 'draft') G.draft = String(m.value || '');
    else if (m.t === 'closed') { G.out = false; G.ready = false; G.open = false; popup = null; paint(); }   // closed with the window's own close button
    else if (m.t === 'act' && REMOTE.indexOf(m.act) >= 0) {
      if (typeof m.value === 'string') G.draft = m.value;
      const fn = A.ACT[m.act]; if (fn) fn({ textContent: String(m.text || ''), dataset: {} });
      if (m.act === 'ai-open-settings' && Host.mode === 'app') Host.call('agentWindow', { op: 'main' }).catch(() => { });
    }
  };
  if (chan) { chan.onmessage = e => { if (e.data && e.data.to === 'main') window.__agentRemote(e.data.m); }; chan.postMessage({ to: 'panel', m: { t: 'bye' } }); }   // a window left over from before a reload closes itself

  // ---------- moving the panel ----------
  // G.pos is null while the panel sits in its corner, or {x, y}: where its top left corner was dragged to.
  // It is kept while the app is open (closing and reopening the panel leaves it where it was) and starts in the corner again on the next launch.
  // The title bar always stays on screen, with enough of it showing to grab, so the panel cannot be lost off an edge.
  function place() {
    const root = $('#agent'); if (!root) return;
    if (!G.open || G.out || !G.pos) { root.style.left = root.style.top = root.style.right = root.style.bottom = ''; return; }
    const w = root.offsetWidth, vw = window.innerWidth, vh = window.innerHeight, KEEP = 140, BAR = 48;
    G.pos.x = Math.round(Math.max(KEEP - w, Math.min(vw - KEEP, G.pos.x)));
    G.pos.y = Math.round(Math.max(0, Math.min(vh - BAR, G.pos.y)));
    root.style.left = G.pos.x + 'px'; root.style.top = G.pos.y + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto';
  }
  let drag = null;
  const bar = e => { const h = e.target.closest && e.target.closest('.agent-panel header'); return h && !e.target.closest('button') ? h : null; };
  function drop(e) {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const root = $('#agent'); if (root) { root.classList.remove('moving'); try { root.releasePointerCapture(drag.id); } catch (x) { } }
    drag = null;
  }
  document.addEventListener('pointerdown', e => {
    if (!bar(e) || e.button !== 0) return;
    const root = $('#agent'), r = root.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    root.classList.add('moving'); try { root.setPointerCapture(e.pointerId); } catch (x) { }
  });
  document.addEventListener('mousedown', e => { if (bar(e)) e.preventDefault(); });   // no text selection while dragging
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.buttons === 0) { drop(e); return; }   // the button was let go outside the window
    if (canDragOut && !G.stay && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth - 1 || e.clientY >= window.innerHeight - 1)) {
      const grab = { x: drag.dx, y: drag.dy }; drop(e); G.pos = null; popOut(grab); return;   // the Mac side keeps the new window under the pointer until the button is let go
    }
    G.pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy }; place();
  });
  document.addEventListener('pointerup', drop); document.addEventListener('pointercancel', drop);
  window.addEventListener('blur', () => drop());
  window.addEventListener('resize', place);
  document.addEventListener('dblclick', e => { if (bar(e)) { G.pos = null; place(); } });
  Object.assign(A.ACT, {
    'agent-toggle': () => { if (!G.open && canPop && S.settings && S.settings.agentOut) { popOut(); return; } G.open = !G.open; paint(); focusBox(); },
    'agent-send': () => { const t = text(); if (!str(t) || G.busy) return; if (G.voice.on) { G.voice.on = false; Host.call('voiceStop').catch(() => { }); } setText(''); send(t); },
    'agent-voice': () => voice(),
    'agent-example': b => setText(b.textContent, true),
    'agent-undo': () => undo(),
    'agent-new': () => { if (G.busy) return; G.msgs = []; G.log = []; G.snap = null; G.lastAp = null; paint(); },
    'agent-pop': () => popOut(),
    'agent-dock': () => dock(true),
    'agent-front': () => { if (Host.mode === 'app') Host.call('agentWindow', { op: 'front' }).catch(() => { }); else if (popup && !popup.closed) popup.focus(); else dock(true); }
  });
  document.addEventListener('keydown', e => { if (e.target.id === 'agent-in' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); A.ACT['agent-send'](); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();

  // Used by the Mac app's self-test: a scripted conversation run through the real loop and tools, then undone.
  window.__agentSelfTest = async function (caseId) {
    const out = {}, real = Host.call, c = () => S.cases[caseId].doc, sec = () => (WU.W.docs[caseId] ? WU.docSections(WU.W.docs[caseId].html).Summary : null);
    S.route = { view: 'case', id: caseId, tab: 'overview' }; A.render(); G.open = true; G.msgs = []; G.log = []; G.lastAp = null; paint();
    const script = [
      { stop: 'tool_use', content: [{ type: 'thinking', thinking: 'plan', signature: 'sig' }, { type: 'text', text: 'Starting.' }, { type: 'tool_use', id: 'u1', name: 'update_trees', input: { appraisal: 'new', trees: [{ tree: 'A1', species: 'Live oak', diameter: '30', condition: '70' }, { tree: 'A2', species: 'Pecan', diameter: '12' }] } }, { type: 'tool_use', id: 'u2', name: 'update_case', input: { matter: 'Self test matter' } }] },
      { stop: 'tool_use', content: [{ type: 'tool_use', id: 'u3', name: 'write_section', input: { heading: 'Summary', text: 'Agent wrote this.\n\n- one\n- two', mode: 'replace' } }, { type: 'tool_use', id: 'u4', name: 'look', input: { what: 'appraisal' } }, { type: 'tool_use', id: 'u5', name: 'update_trees', input: { trees: 'nope' } }, { type: 'tool_use', id: 'u6', name: 'view_image', input: { file: 'Photo 1' } }] },
      { stop: 'end_turn', content: [{ type: 'text', text: 'All done.' }] }];
    const sent = [], before = { aps: C.caseAppraisals(c()).length, matter: c().matter, summary: sec() };
    Host.call = (m, p) => m === 'aiKeyStatus' ? Promise.resolve({ set: true }) : m === 'aiTurn' ? (sent.push(JSON.parse(JSON.stringify(p))), Promise.resolve(Object.assign({ usage: {}, model: 'test' }, script.shift()))) : real(m, p);
    try { await send('Do the self test'); } finally { Host.call = real; }
    const aps = C.caseAppraisals(c()), na = aps[aps.length - 1], res = i => (sent[i].messages[sent[i].messages.length - 1].content || []);
    out.calls = sent.length; out.roles = G.msgs.map(m => m.role).join(',');
    out.firstMessage = /^\[On screen: case "/.test(sent[0].messages[0].content[0].text) && sent[0].tools.length === TOOLS.length && sent[0].tools.every(t => t.eager_input_streaming === true && t.input_schema && !t.run);
    out.treesAdded = aps.length === before.aps + 1 && na.trees.length === 2 && na.trees[0].size === '30' && na.trees[0].cond === 70 && na.species.length === 2;
    out.caseChanged = c().matter === 'Self test matter';
    out.sectionWritten = /^Agent wrote this\.\n\n- one\n- two$/.test(sec() || '');
    out.resultsFirst = res(1).map(r => r.tool_use_id + (r.is_error ? '!' : '')).join(',');
    out.resultsSecond = res(2).map(r => r.tool_use_id + (r.is_error ? '!' : '')).join(',');
    out.lookSawTrees = /"tree":"A1"/.test(String(res(2)[1].content)) && /"value":/.test(String(res(2)[1].content));
    out.imageResult = Array.isArray(res(2)[3].content) && res(2)[3].content[1].type === 'case_image';
    out.thinkingEchoed = JSON.stringify(sent[1].messages[1].content[0]) === JSON.stringify({ type: 'thinking', thinking: 'plan', signature: 'sig' });
    out.log = G.log.map(x => x.who).join(',');
    out.undoOffered = !!$('[data-act=agent-undo]');
    undo(); await A.flush(); await WU.flushDocs();
    out.undone = C.caseAppraisals(c()).length === before.aps && c().matter === before.matter && sec() === before.summary && !S.appraisals[na.id];
    out.fallbackEcho = echo([{ type: 'thinking' }, { type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'fallback' }, { type: 'thinking' }, { type: 'tool_use' }]).map(b => b.type).join(',');
    out.validator = [valid(TOOLS[5].input_schema, { trees: [{ tree: '1' }] }), valid(TOOLS[5].input_schema, { trees: [{ species: 'x' }] }), valid(TOOLS[5].input_schema, { trees: [{ tree: '1', method: 'guess' }] }), valid(TOOLS[0].input_schema, { what: 'everything' })].join(',');
    const realCall = Host.call; Host.call = (m, p) => m === 'voiceStart' ? Promise.resolve({ ok: true, onDevice: true }) : m === 'voiceStop' ? (setTimeout(() => window.__voice({ text: 'add tree four, water oak', done: true }), 30), Promise.resolve(true)) : realCall(m, p);
    try {
      $('#agent-in').value = 'Please'; await voice(); out.voiceOn = G.voice.on && $('.mic').classList.contains('on');
      window.__voice({ text: 'add tree', done: false }); out.voicePartial = $('#agent-in').value === 'Please add tree';
      await voice(); await new Promise(r => setTimeout(r, 120)); out.voiceDone = !G.voice.on && $('#agent-in').value === 'Please add tree four, water oak' && !$('.mic').classList.contains('on');
      window.__voice({ text: 'ignored after stopping', done: false }); out.voiceIgnoredWhenOff = $('#agent-in').value === 'Please add tree four, water oak'; $('#agent-in').value = '';
    } finally { Host.call = realCall; }
    // Moving the panel: drag by the title bar, stay put through a redraw and a close, never leave the window, double-click to go back.
    const root = $('#agent'), box = () => { const r = root.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }, same = (a, b) => a[0] === b[0] && a[1] === b[1];
    const fire = (el, type, x, y, held) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: held, pointerId: 7, isPrimary: true }));
    const pull = (el, dx, dy) => { const r = el.getBoundingClientRect(), x = r.left + 4, y = r.top + 4; fire(el, 'pointerdown', x, y, 1); fire(document.body, 'pointermove', x + dx, y + dy, 1); fire(document.body, 'pointerup', x + dx, y + dy, 0); };
    G.pos = null; paint(); const home = box();
    pull($('.agent-panel header b'), -120, -40); const moved = box();
    out.moved = moved[0] === home[0] - 120 && moved[1] === home[1] - 40;
    fire(document.body, 'pointermove', 5, 5, 1); out.moveEndsOnRelease = same(box(), moved);
    paint(); out.movedKeptOnRedraw = same(box(), moved);
    pull($('.agent-panel header [data-act=agent-toggle]'), 60, 60); out.buttonsDoNotDrag = same(box(), moved);
    G.open = false; paint(); const fab = $('.agent-fab').getBoundingClientRect(); out.buttonStaysInCorner = Math.round(window.innerWidth - fab.right) === 18 && Math.round(window.innerHeight - fab.bottom) === 18;
    G.open = true; paint(); out.reopensWhereLeft = same(box(), moved);
    G.stay = true; pull($('.agent-panel header b'), -9000, -9000); let r = root.getBoundingClientRect(); out.staysReachableTopLeft = Math.round(r.top) === 0 && Math.round(r.right) === 140;
    pull($('.agent-panel header .sp'), 18000, 18000); r = root.getBoundingClientRect(); out.staysReachableBottomRight = Math.round(window.innerHeight - r.top) === 48 && Math.round(window.innerWidth - r.left) === 140; G.stay = false;
    $('.agent-panel header b').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); out.doubleClickGoesHome = same(box(), home) && G.pos === null;
    // A window of its own (Mac app only): the panel leaves the main window, what is typed and clicked there reaches this page, and it can be put back.
    if (Host.mode === 'app') {
      const until = async (f, ms) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 25)); return !!f(); };
      let got = null; G.onProbe = p => { got = p; };
      const ask = async what => { got = null; tell(Object.assign({ t: 'probe' }, what || {})); await until(() => got, 4000); return got || {}; };
      const was = S.settings.agentOut, call0 = Host.call;
      try {
        $('#agent-in').value = 'carried over'; await popOut();
        out.popOpens = G.out && !$('.agent-panel') && !!$('.agent-fab.away') && await until(() => G.ready, 6000);
        let p = await ask(); out.popShowsPanel = p.panel === true && p.dock === true && p.value === 'carried over' && S.settings.agentOut === true;
        Host.call = (m, q) => m === 'aiKeyStatus' ? Promise.resolve({ set: true }) : m === 'aiTurn' ? Promise.resolve({ stop: 'end_turn', usage: {}, model: 'test', content: [{ type: 'text', text: 'Hello from the window.' }] }) : call0(m, q);
        const n0 = G.log.length; await ask({ type: 'Asked from the window', click: '[data-act=agent-send]' });
        await until(() => !G.busy && G.log.length >= n0 + 2, 4000);
        out.popSends = G.log.slice(n0).map(x => x.who + ':' + x.text).join('|') === 'you:Asked from the window|agent:Hello from the window.';
        p = await ask(); out.popShowsAnswer = /Hello from the window\./.test(p.log || '') && p.value === '';
        G.busy = true; window.__aiLive('still writing'); p = await ask(); out.popShowsLive = p.live === 'still writing'; G.busy = false; G.live = ''; paint();
        setText('typed here'); p = await ask(); out.popTextSet = p.value === 'typed here';
        await ask({ type: 'draft kept', click: '[data-act=agent-dock]' }); await until(() => !G.out, 3000);
        out.popPutBack = !G.out && G.open && !!$('.agent-panel') && $('#agent-in').value === 'draft kept' && S.settings.agentOut === false && (await call0('agentWindow', { op: 'state' })).open === false;
        await popOut(); await until(() => G.ready, 6000); await call0('agentWindow', { op: 'close', tell: true }); await until(() => !G.out, 3000);
        out.popClosedByItsButton = !G.out && !G.open && !!$('.agent-fab') && !$('.agent-fab.away') && S.settings.agentOut === true;
        A.ACT['agent-toggle'](); await until(() => G.ready, 6000); const st = await call0('agentWindow', { op: 'state' }); out.popReopensInWindow = G.out && st.open === true; out.popFloatsAndTakesTyping = st.floating === true && st.canType === true;
        dock(false);
        // Dragged past the edge of the main window: it becomes its own window and follows the pointer until the button is let go (the test's pointer goes to -2900, -2950 on the screen).
        G.open = true; G.pos = null; paint(); const hb = $('.agent-panel header b').getBoundingClientRect();
        fire($('.agent-panel header b'), 'pointerdown', hb.left + 4, hb.top + 4, 1); fire(document.body, 'pointermove', hb.left - 60, hb.top - 20, 1);
        const inside = !G.out && !!$('.agent-panel') && Math.round(root.getBoundingClientRect().left) === home[0] - 64;
        fire(document.body, 'pointermove', window.innerWidth + 40, hb.top, 1); await until(() => G.ready, 6000);
        let fs = await call0('agentWindow', { op: 'state' }); for (let i = 0; i < 60 && fs.following; i++) { await new Promise(r => setTimeout(r, 50)); fs = await call0('agentWindow', { op: 'state' }); }
        out.popDraggedOut = inside && G.out && !$('.agent-panel') && G.pos === null && fs.open === true && fs.following === false && fs.grabX >= 24 && fs.x === -2900 - fs.grabX && fs.top === -2936;
        fire(document.body, 'pointermove', 300, 300, 1); fire(document.body, 'pointerup', 300, 300, 0); out.popDragLetGo = G.out && G.pos === null;
        dock(false);
      } catch (e) { out.popError = e.message || String(e); }
      Host.call = call0; G.onProbe = null; S.settings.agentOut = was; A.save('library', 'settings'); G.msgs = []; G.log = []; G.snap = null;
    }
    G.open = false; paint();
    return out;
  };

  window.AgentUI = { G: G, TOOLS: TOOLS, SYSTEM: SYSTEM, send: send, undo: undo, valid: valid, echo: echo, paint: paint, where: where, popOut: popOut, dock: dock };
})();
