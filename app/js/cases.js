/* Expert Report: cases. Each case is a real folder on disk that holds its photos, emails, documents, notes and reports.
 * The app's own record of the case (case.json, and any appraisals) sits in "Case data" inside that folder. */
(function () {
  'use strict';
  const A = App, S = A.S, E = A.E, $ = A.$, $$ = A.$$, esc = A.esc, uid = A.uid, field = A.field, toast = A.toast, plural = A.plural, money = A.money;
  const CS = { files: {}, thumbs: {}, loaded: {}, note: null, noteTimer: null };

  const TYPES = [['cutting', 'Wrongful cutting or damage'], ['injury', 'Personal injury'], ['failure', 'Tree failure onto a structure'], ['herbicide', 'Herbicide damage'],
    ['construction', 'Construction and tree preservation'], ['diagnosis', 'Diagnosis or consultation'], ['other', 'Other']];
  const typeName = k => (TYPES.find(t => t[0] === k) || TYPES[TYPES.length - 1])[1];
  const SEC = { summary: 'Summary', assignment: 'Assignment', purpose: 'Purpose of the Report', use: 'Intended Use of Report', limits: 'Limits of the Assignment', qualifications: 'Qualifications',
    observations: 'Observations', materials: 'Materials Reviewed', discussion: 'Discussion', appraisal: 'Determination of Appraisal Value', risk: 'Tree Risk Assessment', zones: 'Tree Protection Zones',
    recommendations: 'Tree Preservation Recommendations', cause: 'Determining the Cause of Death', symptoms: 'Symptoms and Evidence of Herbicide Exposure', recs: 'Recommendations', conclusion: 'Conclusion',
    certification: 'Certification of Performance' };
  const AUTO = { qualifications: 'Written from the people ticked on the Overview tab, unless you type your own text here.', materials: 'The numbered list comes from the Files tab.',
    appraisal: 'The summary table from the Appraisal tab is added after your text.', risk: 'The risk tables from the Risk tab are added after your text.',
    zones: 'The protection zone table from the Preservation tab is added after your text.', recommendations: 'The recommendations ticked on the Preservation tab are added after your text.',
    certification: 'Written from the certification wording in Settings and the people on the Overview tab.' };
  const OUTLINE = {
    cutting: ['summary', 'use', 'qualifications', 'observations', 'materials', 'discussion', 'appraisal', 'conclusion', 'certification'],
    injury: ['summary', 'assignment', 'qualifications', 'materials', 'observations', 'risk', 'discussion', 'conclusion', 'certification'],
    failure: ['summary', 'assignment', 'qualifications', 'materials', 'observations', 'risk', 'discussion', 'conclusion', 'certification'],
    herbicide: ['purpose', 'qualifications', 'observations', 'materials', 'cause', 'symptoms', 'appraisal', 'recs', 'conclusion', 'certification'],
    construction: ['summary', 'assignment', 'limits', 'qualifications', 'observations', 'zones', 'recommendations', 'conclusion', 'certification'],
    diagnosis: ['summary', 'observations', 'materials', 'discussion', 'recs', 'conclusion'],
    other: ['summary', 'assignment', 'qualifications', 'observations', 'materials', 'discussion', 'conclusion', 'certification'] };
  const outline = type => (OUTLINE[type] || OUTLINE.other).map(k => ({ id: uid(), key: k, title: SEC[k], on: true, text: '' }));
  const LETTER = 'Thank you for your request for a professional evaluation of [what you were asked to look at]. The following report is based on [the site visit and its date, and the materials reviewed].\n\nPlease contact our office if you have any questions, or if we may be of further service regarding this matter.';
  // {I} becomes I or We, {my} becomes my or our, to match the number of people signing.
  const CERT = ['{I} have personally inspected the subject trees and site referred to in this report, and have stated {my} findings accurately.',
    '{I} have no current or prospective interest in the vegetation or the property that is the subject of this report. {I} also have no personal bias with respect to the parties involved.',
    'The analysis, opinions, and conclusions in this report were developed in accordance with commonly accepted arboricultural practices.',
    '{My} compensation is not contingent upon the reporting of a predetermined conclusion that favors the cause of the client or any other party. Nor is {my} compensation contingent upon any subsequent outcome of this case, or any other event.'];

  function blankCase(name, type) {
    return { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), name: name, reportTitle: name ? name + ' Report' : '', type: type, to: { name: '', address: '', salutation: '' },
      authors: (S.settings.people || []).filter(p => p.self).map(p => p.id), reportDate: '', visits: '', lossDate: '', retainedBy: '', matter: '', notes: '', files: {}, photos: [], otherMaterials: '',
      letter: LETTER, sections: outline(type), risk: { level: Risk.LEVELS[1], date: '', timeframe: '', scope: '', trees: [] }, preserve: { project: '', method: 'isa', mult: 1, trees: [], recs: {}, recText: {} }, apOut: {} };
  }
  const rec = () => S.route.view === 'case' ? S.cases[S.route.id] : null;
  const doc = () => { const r = rec(); return r && r.doc; };
  const saveCase = (ms) => { const r = rec(); if (r) A.save('cases', r.doc.id, ms); };
  const filesOf = c => CS.files[c.id] || [];
  const meta = (c, rel) => (c.files[rel] = c.files[rel] || {});
  // Field notes arrive as photographs of handwritten pages. A picture counts as one if it is in the Field notes folder or has been marked as one.
  const isNote = (c, f) => { const m = (c.files || {})[f.rel] || {}; return f.kind === 'image' && f.folder !== 'Reports' && (m.fieldNote === true || (f.folder === 'Field notes' && m.fieldNote !== false)); };
  const caseAppraisals = c => Object.values(S.appraisals).filter(a => S.apHome[a.id] === c.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  function fmtDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function photosIn(c) { const have = {}; filesOf(c).forEach(f => { have[f.rel] = f; }); return (c.photos || []).filter(r => have[r]).map(r => have[r]); }

  // ---------- starting up and loading ----------
  A.boot = async function () {
    const st = S.settings; let changed = false;
    if (!st.people) {
      // Copied from the user's own recent reports so the first case is not a blank form. Each entry is marked for checking.
      st.people = [{ id: uid(), self: true, review: true, name: 'David Brock Barker', role: 'Consulting Arborist', credential: 'Louisiana Licensed Arborist #26-2788',
        qual: 'I, David Brock Barker, hold a Bachelor of Science in Sustainable Agriculture (Horticulture) from the University of Louisiana at Lafayette. I am a licensed arborist, licensed landscape horticulturalist, and am designated a Certified Nursery and Landscape Professional by the Louisiana Nursery and Landscape Association.',
        cert: 'I, David Brock Barker, certify that I am a Licensed Arborist in the state of Louisiana.', sig: null },
      { id: uid(), self: false, review: true, name: 'Frank Thibodeaux', role: 'Consulting Arborist', credential: 'ISA Certified Arborist #SO-0944A',
        qual: 'I, Frank Thibodeaux, hold a Master of Science in Urban Forestry from Southern University, and have been a practicing licensed Arborist in the state of Louisiana for 32 years.',
        cert: 'I, Frank Thibodeaux, certify that I am a member in good standing of the American Society of Consulting Arborists, and a Licensed Louisiana Arborist. I have been involved in the field of arboriculture for 32 years.', sig: null }];
      changed = true;
    }
    if (st.companyName === undefined) { st.companyName = 'Bob’s Tree Preservation Co.'; st.companyAddress = 'P.O. Box 1884\nScott, LA 70583'; changed = true; }
    if (!st.certLines) { st.certLines = CERT.join('\n'); changed = true; }
    if (changed) await A.push('library', 'settings');
    await loadCases();
  };
  async function loadCases() {
    Object.keys(S.cases).forEach(k => delete S.cases[k]);
    if (!S.settings.casesRoot) return;
    const list = await Host.call('caseList', { root: S.settings.casesRoot });
    list.forEach(x => { if (x.doc && x.doc.id) S.cases[x.doc.id] = { path: x.path, folder: x.folder, doc: x.doc }; });
  }
  async function loadCase(id) {
    const c = S.cases[id]; if (!c) return;
    const got = await Promise.all([Host.call('caseScan', { path: c.path }), Host.call('caseNames', { path: c.path, prefix: 'appraisal-' })]);
    CS.files[id] = got[0];
    for (const n of got[1]) { const d = await Host.call('caseGet', { path: c.path, name: n }); if (d && d.id && !S.appraisals[d.id]) { S.appraisals[d.id] = d; S.apHome[d.id] = id; if (A.migrate(d)) A.save('appraisals', d.id, 0); } else if (d && d.id) S.apHome[d.id] = id; }
    CS.loaded[id] = true;
  }
  async function rescan() { const r = rec(); if (!r) return; CS.files[r.doc.id] = await Host.call('caseScan', { path: r.path }); A.render(); }
  A.onRoute = function (route) {
    if (route.view === 'case' && S.cases[route.id]) {
      const r = S.cases[route.id];
      Host.call('setDropTarget', { path: r.path, folder: route.tab === 'photos' ? 'Photos' : '' }).catch(() => { });
      if (!CS.loaded[route.id]) loadCase(route.id).then(() => { if (S.route.view === 'case' && S.route.id === route.id) A.render(); }, e => toast('Could not read the case folder: ' + (e.message || e)));
    } else Host.call('setDropTarget', { path: '' }).catch(() => { });
  };
  // The Mac app calls this after files are dragged onto the window.
  window.__caseFilesChanged = function (n) { rescan().then(() => { if (n) toast('Added ' + plural(n, 'file')); }); };

  // ---------- list of cases ----------
  A.views.cases = function () {
    const list = Object.values(S.cases).sort((a, b) => (b.doc.updatedAt || 0) - (a.doc.updatedAt || 0)), root = S.settings.casesRoot;
    return (S.err ? '<p class="banner">Something went wrong reading or saving your data: ' + esc(S.err) + '</p>' : '') +
      '<div class="intro"><div><p class="eyebrow">Expert Report</p><h1>Cases</h1><p class="sub">Each case is a folder that holds its photos, emails, documents, notes and reports, with the appraisal, risk assessment and preservation work that go into the report.</p></div>' +
      '<button class="btn primary big" data-act="new-case">New case</button></div>' +
      (!root ? '<div class="empty"><h2>Choose where to keep your cases</h2><p>Pick or make a folder. Every case you start becomes a folder inside it that you can open in Finder at any time.</p><button class="btn primary" data-act="choose-root">Choose the folder…</button></div>'
        : list.length ? '<div class="alist">' + list.map(r => '<button class="acard" data-act="open-case" data-id="' + r.doc.id + '"><b>' + esc(r.doc.name || 'Untitled case') + '</b><span class="val" style="font:500 13px var(--f-body);color:var(--ink-2)">' + esc(fmtDate(new Date(r.doc.updatedAt || r.doc.createdAt).toISOString())) + '<small>last change</small></span>' +
          '<span class="meta"><span class="chip">' + esc(typeName(r.doc.type)) + '</span>' + esc((r.doc.to && r.doc.to.name) || '') + '</span></button>').join('') + '</div>'
          : '<div class="empty"><h2>No cases yet</h2><p>Start one and drop in whatever you have.</p><button class="btn primary" data-act="new-case">New case</button></div>') +
      (root ? '<p class="hint" style="margin-top:12px">Cases are kept in <code>' + esc(root) + '</code>. <button class="link" data-act="choose-root">Change</button></p>' : '');
  };

  // ---------- one case ----------
  // The site visit date comes from the photographs: the day on which most of the site photos were taken.
  // Pictures of field notes are left out (they are often photographed later), and so are pictures with no date in them, such as screenshots.
  function visitFromPhotos(c) {
    const by = {}; let total = 0;
    filesOf(c).forEach(f => { if (f.kind !== 'image' || f.folder === 'Reports' || isNote(c, f) || !f.taken) return; const d = String(f.taken).slice(0, 10); by[d] = (by[d] || 0) + 1; total++; });
    const days = Object.keys(by).sort((a, b) => by[b] - by[a] || (a < b ? -1 : 1));
    return days.length ? { date: days[0], n: by[days[0]], total: total, others: days.slice(1).map(d => ({ date: d, n: by[d] })) } : null;
  }
  // Fills the date in, and keeps it in step as photos are added, until the arborist types a date of their own.
  function syncVisit(c) {
    if (!CS.loaded[c.id]) return; const v = visitFromPhotos(c); if (!v) return;
    const text = A.R.longDate(v.date);
    if ((!String(c.visits || '').trim() || c.visitsFrom === 'photos') && (c.visits !== text || c.visitsFrom !== 'photos')) { c.visits = text; c.visitsFrom = 'photos'; A.save('cases', c.id); }
  }
  function visitHint(c) {
    const v = CS.loaded[c.id] ? visitFromPhotos(c) : null; if (!v) return '<p class="hint" style="margin-top:4px">Filled in from the dates of the site photos once they are in the case.</p>';
    const others = v.others.length ? ' Other dates: ' + v.others.slice(0, 4).map(o => A.R.longDate(o.date) + ' (' + o.n + ')').join(', ') + (v.others.length > 4 ? ', and more' : '') + '.' : '';
    const basis = v.n + ' of ' + plural(v.total, 'dated site photo') + (v.n === 1 ? ' was' : ' were') + ' taken on ';
    if (c.visitsFrom === 'photos') return '<p class="hint" style="margin-top:4px">From the photos: ' + basis + 'this date.' + esc(others) + ' Type over it to use a different date.</p>';
    return '<p class="hint" style="margin-top:4px">' + esc(basis + A.R.longDate(v.date) + '.' + others) + ' <button class="link" data-act="visit-from-photos">Use that date</button></p>';
  }
  A.views['case'] = function (r) {
    const cr = S.cases[r.id]; if (!cr) { S.route = { view: 'cases' }; return A.views.cases(); }
    syncVisit(cr.doc);
    const c = cr.doc, tab = r.tab || 'overview', files = filesOf(c), nPhotos = photosIn(c).length;
    const tabs = [['overview', 'Overview'], ['files', 'Files', files.length], ['photos', 'Photos', nPhotos], ['notes', 'Notes', files.filter(f => f.folder === 'Notes' && f.kind === 'text').length],
      ['appraisal', 'Appraisal', caseAppraisals(c).length], ['risk', 'Risk', (c.risk.trees || []).length], ['preserve', 'Preservation', (c.preserve.trees || []).length], ['report', 'Report']];
    const body = !CS.loaded[c.id] && tab !== 'overview' ? '<p class="hint">Reading the case folder…</p>' : (TAB[tab] || TAB.overview)(c, cr);
    return '<button class="backlink" data-act="nav" data-view="cases">‹ All cases</button>' +
      '<div class="ap-head"><div><h1>' + esc(c.name || 'Untitled case') + '</h1><p class="row" style="margin-top:6px"><span class="chip">' + esc(typeName(c.type)) + '</span><button class="link" data-act="case-folder">Show the folder in Finder</button></p></div></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(t => '<button class="tab" role="tab" data-act="case-tab" data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + (t[2] !== undefined ? ' <span class="count">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>' +
      '<div data-scope="case">' + body + '</div>';
  };
  const TAB = {};

  TAB.overview = function (c) {
    const people = S.settings.people || [];
    return '<div class="card"><h2>The case</h2><div class="grid2">' + field('Short name', 'name', c.name, { rerender: true, help: 'Used for the folder and at the top of each report page.' }) +
      '<label class="f"><span>Kind of case</span><select data-bind="type" data-rerender>' + TYPES.map(t => '<option value="' + t[0] + '"' + (c.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></label>' +
      '<div>' + field('Site visit date or dates', 'visits', c.visits, { ph: 'e.g. October 29, 2025' }) + visitHint(c) + '</div>' + field('Date of loss or incident', 'lossDate', c.lossDate, { ph: 'If there is one' }) +
      field('Retained by', 'retainedBy', c.retainedBy, { ph: 'Attorney or firm, if any' }) + field('Matter or case caption', 'matter', c.matter, { ph: 'e.g. Smith v. Jones' }) + '</div>' +
      '<div style="margin-top:12px">' + field('Notes for yourself', 'notes', c.notes, { area: true, rows: 2 }) + '</div></div>' +
      '<div class="card"><h2>Report is submitted to</h2><div class="grid2">' + field('Name', 'to.name', c.to.name, { ph: 'e.g. Mr. Robert Sample' }) + field('Greeting in the letter', 'to.salutation', c.to.salutation, { ph: 'e.g. Mr. Sample' }) + '</div>' +
      '<div style="margin-top:12px">' + field('Address', 'to.address', c.to.address, { area: true, rows: 2, ph: 'Street\nCity, State ZIP' }) + '</div></div>' +
      '<div class="card"><h2>Submitted by</h2>' + (people.length ? people.map(p => '<label class="check" style="margin:6px 0"><input type="checkbox" data-author="' + p.id + '" ' + (c.authors.indexOf(p.id) >= 0 ? 'checked' : '') + '><span><b>' + esc(p.name) + '</b><br><span class="hint">' + esc(p.credential || '') + '</span></span></label>').join('') : '<p class="hint">No people yet.</p>') +
      '<p class="hint" style="margin-top:8px">' + esc(S.settings.companyName || '') + '. People, credentials and signatures are kept in <button class="link" data-act="nav" data-view="settings">Settings</button>.</p></div>';
  };

  TAB.files = function (c) {
    const files = filesOf(c), groups = {}, order = ['Photos', 'Field notes', 'Emails', 'Documents', 'Notes', 'Reports'];
    files.forEach(f => { (groups[f.folder || 'Loose in the case folder'] = groups[f.folder || 'Loose in the case folder'] || []).push(f); });
    Object.keys(groups).forEach(g => { if (order.indexOf(g) < 0) order.push(g); });
    return '<div class="toolbar"><button class="btn primary" data-act="add-files">Add files…</button><button class="btn" data-act="add-files" data-folder="Field notes">Add field notes…</button><button class="btn" data-act="rescan">Refresh</button>' +
      '<span class="hint">You can also drag files onto this window, or drop them straight into the case folder in Finder. Copies are made; your originals stay where they are.</span></div>' +
      (files.length ? order.filter(g => groups[g]).map(g => '<div class="card"><h2>' + esc(g) + ' <span class="count">' + groups[g].length + '</span></h2><div class="scroll"><table class="tbl"><thead><tr><th>File</th><th style="width:110px">Date</th><th class="n" style="width:80px">Size</th><th>What it is</th><th style="width:22%">Who it came from</th><th style="width:86px">Reviewed</th><th style="width:34px"></th></tr></thead><tbody>' +
        groups[g].map(f => { const m = c.files[f.rel] || {}; return '<tr data-scope="cfile" data-rel="' + esc(f.rel) + '"><td><button class="link" data-act="open-file" data-rel="' + esc(f.rel) + '" title="Open">' + esc(f.name) + '</button>' + (f.kind === 'email' || f.kind === 'text' ? ' <button class="btn small" data-act="read-file" data-rel="' + esc(f.rel) + '">Read</button>' : '') + '</td>' +
          '<td class="o">' + esc(fmtDate(f.taken || f.modified)) + '</td><td class="o n">' + fmtSize(f.size) + '</td><td><input class="c" data-bind="desc" value="' + esc(m.desc || '') + '" placeholder="Short description" aria-label="What it is"></td>' +
          '<td><input class="c" data-bind="source" value="' + esc(m.source || '') + '" placeholder="e.g. counsel, client" aria-label="Who it came from"></td>' +
          '<td style="text-align:center"><input type="checkbox" data-bind="reviewed" ' + (m.reviewed ? 'checked' : '') + ' aria-label="List under materials reviewed"></td>' +
          '<td><button class="icon" data-act="trash-file" data-rel="' + esc(f.rel) + '" title="Move to the Removed files folder" aria-label="Remove ' + esc(f.name) + '">✕</button></td></tr>'; }).join('') + '</tbody></table></div></div>').join('')
        : '<div class="empty"><h2>Nothing in this case yet</h2><p>Add photos, emails, PDFs from counsel, and pictures of your field notes.</p></div>') +
      '<div class="card"><h2>Other materials reviewed</h2><p class="hint" style="margin-bottom:8px">Things you relied on that are not files here, one per line. Files ticked “Reviewed” above are listed first in the report.</p>' +
      '<textarea class="method" style="min-height:90px" data-bind="otherMaterials" aria-label="Other materials reviewed" placeholder="Historical Google Earth imagery of the site">' + esc(c.otherMaterials || '') + '</textarea></div>';
  };

  TAB.photos = function (c) {
    const imgs = filesOf(c).filter(f => f.kind === 'image' && f.folder !== 'Reports'), inR = photosIn(c), inSet = {}; inR.forEach(f => { inSet[f.rel] = 1; });
    const rest = imgs.filter(f => !inSet[f.rel] && !isNote(c, f)), notes = imgs.filter(f => isNote(c, f) && !inSet[f.rel]);
    const small = f => '<div class="pmini"><button class="pthumb" data-act="open-file" data-rel="' + esc(f.rel) + '" title="Open"><img data-thumb="' + esc(f.rel) + '" alt=""></button><span class="hint">' + esc(f.name) + (f.taken ? ' · ' + esc(fmtDate(f.taken)) : '') + '</span><button class="btn small" data-act="photo-add" data-rel="' + esc(f.rel) + '">Add to report</button><button class="link" data-act="photo-note" data-rel="' + esc(f.rel) + '" data-on="1">This is a field note page</button></div>';
    return '<div class="toolbar"><button class="btn primary" data-act="add-files" data-folder="Photos">Add photos…</button><button class="btn" data-act="add-files" data-folder="Field notes">Add field note photos…</button><button class="btn" data-act="rescan">Refresh</button><span class="hint">Photos in the report are numbered in the order shown. Refer to them in your text as (Photo 1).</span></div>' +
      '<div class="card"><h2>In the report <span class="count">' + inR.length + '</span></h2>' + (inR.length ? inR.map((f, i) => { const m = c.files[f.rel] || {}; return '<div class="pcard" data-scope="cfile" data-rel="' + esc(f.rel) + '"><button class="pthumb" data-act="open-file" data-rel="' + esc(f.rel) + '" title="Open"><img data-thumb="' + esc(f.rel) + '" alt=""></button><div class="pbody">' +
        '<div class="row"><span class="chip ed">Photo ' + (i + 1) + '</span><span class="hint">' + esc(f.name) + (f.taken ? ' · taken ' + esc(fmtDate(f.taken)) : '') + '</span><span class="sp"></span>' +
        '<button class="icon" data-act="photo-move" data-rel="' + esc(f.rel) + '" data-d="-1" title="Move earlier" aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="icon" data-act="photo-move" data-rel="' + esc(f.rel) + '" data-d="1" title="Move later" aria-label="Move later"' + (i === inR.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="link" data-act="photo-note" data-rel="' + esc(f.rel) + '" data-on="1" title="Takes it out of the report and files it with your field notes">This is a field note page</button><button class="btn small" data-act="photo-remove" data-rel="' + esc(f.rel) + '">Take out</button></div>' +
        '<textarea data-bind="caption" rows="2" placeholder="Caption: what this photo shows" aria-label="Caption for photo ' + (i + 1) + '">' + esc(m.caption || '') + '</textarea>' +
        '<input data-bind="source" value="' + esc(m.source || '') + '" placeholder="Who took or supplied it" aria-label="Source of photo ' + (i + 1) + '"></div></div>'; }).join('')
        : '<p class="hint">No photos chosen yet. Add them from the list below.</p>') + '</div>' +
      (rest.length ? '<div class="card"><h2>Other photos in the case <span class="count">' + rest.length + '</span></h2><div class="pgrid">' + rest.map(small).join('') + '</div></div>' : '') +
      (notes.length ? '<div class="card"><h2>Field notes <span class="count">' + notes.length + '</span></h2><p class="hint" style="margin-bottom:10px">Photographs of your handwritten notes. “Read the trees from field notes and photos” on the Appraisal tab types each page up here and fills the tree table from it. The typed copy is yours to correct against the page.</p>' +
        notes.map(f => { const m = c.files[f.rel] || {}; return '<div class="pcard" data-scope="cfile" data-rel="' + esc(f.rel) + '"><button class="pthumb" data-act="open-file" data-rel="' + esc(f.rel) + '" title="Open"><img data-thumb="' + esc(f.rel) + '" alt=""></button><div class="pbody"><div class="row"><span class="hint">' + esc(f.name) + '</span><span class="sp"></span><button class="btn small" data-act="photo-add" data-rel="' + esc(f.rel) + '">Add to report</button><button class="link" data-act="photo-note" data-rel="' + esc(f.rel) + '" data-on="0">Not a field note</button></div>' +
          '<textarea data-bind="transcript" rows="4" placeholder="What this page says" aria-label="Typed copy of ' + esc(f.name) + '">' + esc(m.transcript || '') + '</textarea></div></div>'; }).join('') + '</div>' : '') +
      (!imgs.length ? '<div class="empty"><h2>No photos yet</h2><p>Add them here, or drag them onto the window.</p></div>' : '');
  };

  TAB.notes = function (c) {
    const notes = filesOf(c).filter(f => f.folder === 'Notes' && f.kind === 'text');
    const cur = CS.note && CS.note.caseId === c.id && notes.find(f => f.rel === CS.note.rel) ? CS.note : null;
    return '<div class="toolbar"><button class="btn primary" data-act="new-note">New note</button><span class="hint">Each note is a plain text file in the case’s Notes folder.</span></div>' +
      (notes.length ? '<div class="notes"><div class="nlist">' + notes.map(f => '<button class="nitem" data-act="open-note" data-rel="' + esc(f.rel) + '" aria-current="' + (cur && cur.rel === f.rel) + '"><b>' + esc(f.name.replace(/\.(txt|md)$/i, '')) + '</b><span class="hint">' + esc(fmtDate(f.modified)) + '</span></button>').join('') + '</div>' +
        '<div class="card" style="margin:0">' + (cur ? '<label class="f"><span>Title</span><input data-note-title value="' + esc(cur.rel.split('/').pop().replace(/\.(txt|md)$/i, '')) + '"></label><textarea class="method" style="min-height:340px;margin-top:10px" data-note-text aria-label="Note text">' + esc(cur.text) + '</textarea>' +
          '<div class="row" style="margin-top:8px"><span class="hint" data-note-status>Saved in the case folder</span><span class="sp"></span><button class="btn small danger" data-act="trash-file" data-rel="' + esc(cur.rel) + '">Remove this note</button></div>' : '<p class="hint">Choose a note on the left.</p>') + '</div></div>'
        : '<div class="empty"><h2>No notes yet</h2><p>Call notes, things to follow up, anything you want kept with the case.</p></div>');
  };

  TAB.appraisal = function (c) {
    const list = caseAppraisals(c);
    return '<div class="toolbar"><button class="btn primary" data-act="case-new-appraisal">New appraisal for this case</button><span class="hint">An appraisal is kept in the case folder. Tick it to put its tables in the report.</span></div>' +
      (list.length ? '<div class="alist">' + list.map(a => { const R0 = E.calcAppraisal(a); return '<div class="acard incase"><label class="check" title="Include in the report"><input type="checkbox" data-apin="' + a.id + '" ' + (c.apOut && c.apOut[a.id] ? '' : 'checked') + ' aria-label="Include in the report"></label>' +
        '<button class="link name" data-act="open" data-id="' + a.id + '"><b>' + esc(A.R.title(a)) + '</b><br><span class="meta"><span class="chip ed">' + (E.edition(a) === '9' ? '9th edition' : '10th edition') + '</span>' + plural(R0.n, 'tree') + (R0.missing ? ', ' + R0.missing + ' incomplete' : '') + '</span></button>' +
        '<span class="val">' + money(R0.total, 0) + '<small>total</small></span></div>'; }).join('') + '</div>'
        : '<div class="empty"><h2>No appraisal in this case</h2><p>Add one if the report needs a value for the trees.</p></div>');
  };

  const sel = (bind, val, opts, label) => '<select class="c" data-bind="' + bind + '" aria-label="' + label + '"><option value=""></option>' + opts.map(o => '<option' + (val === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
  TAB.risk = function (c) {
    const k = c.risk;
    return '<p class="sub" style="margin-bottom:12px">Rate each tree part that could fail against what it could hit. The likelihood of failure and of impact combine into one likelihood, and that combines with the consequences to give the risk rating.</p>' +
      '<div class="card" data-scope="crisk"><h2>The assessment</h2><div class="grid2"><label class="f"><span>Level of assessment</span><select data-bind="level">' + Risk.LEVELS.map(l => '<option' + (k.level === l ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      field('Date or dates', 'date', k.date, { ph: 'When the trees were assessed, or the date the assessment looks back to' }) + field('Time frame', 'timeframe', k.timeframe, { ph: 'e.g. one year' }) + '</div>' +
      '<div style="margin-top:12px">' + field('Scope and limits', 'scope', k.scope, { area: true, rows: 2, ph: 'What was and was not inspected, tools used, anything that limited the assessment' }) + '</div></div>' +
      (k.trees || []).map((t, i) => '<div class="card" data-scope="rtree" data-id="' + t.id + '"><div class="row"><h2 style="margin:0">Tree ' + esc(Risk.label(t, i)) + '</h2><span class="chip" data-out="rov:' + t.id + '"></span><span class="sp"></span><button class="icon" data-act="risk-del-tree" data-id="' + t.id + '" title="Remove this tree" aria-label="Remove tree">✕</button></div>' +
        '<div class="grid2" style="margin-top:10px">' + field('Tree number or name', 'label', t.label, { ph: String(i + 1) }) + field('Species', 'species', t.species, { list: 'splist' }) + field('Trunk diameter (in)', 'dbh', t.dbh) + field('Height (ft)', 'height', t.height) + '</div>' +
        '<div style="margin-top:10px">' + field('Where it is and what is around it', 'location', t.location, { ph: 'e.g. east side of building 6, over the sidewalk and parking' }) + '</div>' +
        '<h3>Parts that could fail</h3><div class="scroll"><table class="tbl" style="min-width:1080px"><thead><tr><th style="width:130px">Tree part</th><th>Condition of concern</th><th style="width:16%">Target</th><th style="width:118px">Occupancy</th><th style="width:122px">Likelihood of failure</th><th style="width:118px">Likelihood of impact</th><th style="width:120px">Failure and impact</th><th style="width:124px">Consequences</th><th style="width:96px">Risk rating</th><th style="width:34px"></th></tr></thead><tbody>' +
        (t.rows || []).map(r => '<tr data-scope="rrow" data-tree="' + t.id + '" data-id="' + r.id + '"><td><input class="c" data-bind="part" list="rparts" value="' + esc(r.part || '') + '" aria-label="Tree part"></td><td><input class="c" data-bind="concern" value="' + esc(r.concern || '') + '" aria-label="Condition of concern"></td><td><input class="c" data-bind="target" value="' + esc(r.target || '') + '" aria-label="Target"></td>' +
          '<td>' + sel('occ', r.occ, Risk.OCC, 'Occupancy') + '</td><td>' + sel('lof', r.lof, Risk.FAIL, 'Likelihood of failure') + '</td><td>' + sel('loi', r.loi, Risk.IMPACT, 'Likelihood of impact') + '</td><td class="o" data-out="rlk:' + r.id + '"></td><td>' + sel('cons', r.cons, Risk.CONSEQ, 'Consequences') + '</td>' +
          '<td class="o" data-out="rrk:' + r.id + '" style="font-weight:600;color:var(--ink)"></td><td><button class="icon" data-act="risk-del-row" data-tree="' + t.id + '" data-id="' + r.id + '" title="Remove this row" aria-label="Remove row">✕</button></td></tr>').join('') +
        '</tbody></table></div><div class="row" style="margin-top:8px"><button class="btn small" data-act="risk-add-row" data-id="' + t.id + '">Add a part</button></div>' +
        '<div class="grid2" style="margin-top:12px"><label class="f"><span>Residual risk after mitigation</span><select data-bind="residual"><option value=""></option>' + Risk.RISK.map(o => '<option' + (t.residual === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>' + field('Next inspection', 'interval', t.interval, { ph: 'e.g. 12 months, or after the next major storm' }) + '</div>' +
        '<div style="margin-top:12px">' + field('Mitigation options', 'mitigation', t.mitigation, { area: true, rows: 2, ph: 'e.g. remove the dead branch; restrict access under the crown until the work is done' }) + '</div>' +
        '<div style="margin-top:12px">' + field('Notes on this tree', 'notes', t.notes, { area: true, rows: 2 }) + '</div></div>').join('') +
      '<div class="row" style="margin-top:14px"><button class="btn primary" data-act="risk-add-tree">Add a tree</button></div><datalist id="rparts">' + Risk.PARTS.map(p => '<option>' + p + '</option>').join('') + '</datalist>';
  };

  TAB.preserve = function (c, cr) { return window.PreserveUI ? PreserveUI.tab(c, cr) : '<p class="hint">The preservation part is not available.</p>'; };

  function reportChecks(c) { return window.CaseReport ? CaseReport.checks(c, { files: filesOf(c), photos: photosIn(c), appraisals: caseAppraisals(c).filter(a => !(c.apOut && c.apOut[a.id])), settings: S.settings }) : []; }
  // The outline: cover details, the letter and the sections. The Report tab builds the first version of the document from it.
  function outlineCards(c) {
    const used = {}; c.sections.forEach(s => { used[s.key] = 1; });
    const addable = Object.keys(SEC).filter(k => !used[k]);
    return '<div class="card"><h2>Cover and letter</h2><div class="grid2">' + field('Title on the cover', 'reportTitle', c.reportTitle) + field('Report date', 'reportDate', c.reportDate, { type: 'date' }) + '</div>' +
      '<div style="margin-top:12px">' + field('Letter', 'letter', c.letter, { area: true, rows: 6, help: 'The greeting and the names under “Respectfully submitted” are added for you. Replace anything in [square brackets].' }) + '</div></div>' +
      '<div class="card"><h2>Sections</h2><p class="hint" style="margin-bottom:10px">Untick a section to leave it out. This is the outline the first version of the report is built from. Once the report is written, edit it in the document itself. Leave a blank line between paragraphs; start a line with a hyphen for a bullet.</p>' +
      c.sections.map((s, i) => '<div class="sec" data-scope="csec" data-id="' + s.id + '"><div class="row"><input type="checkbox" data-bind="on" ' + (s.on ? 'checked' : '') + ' aria-label="Include this section"><input class="in" style="max-width:420px;font-weight:600" data-bind="title" value="' + esc(s.title) + '" aria-label="Section heading"><span class="sp"></span>' +
        '<button class="icon" data-act="sec-move" data-id="' + s.id + '" data-d="-1" title="Move up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="icon" data-act="sec-move" data-id="' + s.id + '" data-d="1" title="Move down" aria-label="Move down"' + (i === c.sections.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="icon" data-act="sec-del" data-id="' + s.id + '" title="Remove this section" aria-label="Remove section">✕</button></div>' +
        (AUTO[s.key] ? '<p class="hint" style="margin:6px 0 0 26px">' + esc(AUTO[s.key]) + '</p>' : '') +
        (s.key === 'certification' || s.key === 'materials' ? '' : '<textarea class="method" style="min-height:' + (AUTO[s.key] ? 70 : 120) + 'px;margin-top:8px" data-bind="text" aria-label="' + esc(s.title) + '">' + esc(s.text || '') + '</textarea>') + '</div>').join('') +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="sec-add" data-key="custom">Add a section of your own</button>' + addable.map(k => '<button class="btn small" data-act="sec-add" data-key="' + k + '">' + esc(SEC[k]) + '</button>').join('') + '</div></div>';
  }
  TAB.report = function (c) { return outlineCards(c); };   // replaced by the writing tab (write.js)

  // ---------- thumbnails ----------
  A.after['case'] = function (r) {
    const cr = S.cases[r.id]; if (!cr) return;
    refreshCase();
    const imgs = $$('img[data-thumb]'); let i = 0;
    (function next() {
      if (i >= imgs.length) return; const img = imgs[i++]; if (!document.contains(img)) return next();
      const key = cr.doc.id + '|' + img.dataset.thumb;
      if (CS.thumbs[key]) { img.src = CS.thumbs[key]; return next(); }
      Host.call('caseThumb', { path: cr.path, rel: img.dataset.thumb, max: 360 }).then(t => { CS.thumbs[key] = 'data:image/jpeg;base64,' + t.data; if (document.contains(img)) img.src = CS.thumbs[key]; }, () => { }).then(next);
    })();
  };
  // Patch the calculated cells on the Risk and Preservation tabs without redrawing, so typing keeps its place.
  function refreshCase() {
    const c = doc(); if (!c) return; const out = {};
    (c.risk.trees || []).forEach(t => { const k = Risk.calcTree(t); out['rov:' + t.id] = k.overall ? k.overall + ' risk' : (k.n ? 'Not finished' : 'Not rated'); (t.rows || []).forEach((r, i) => { out['rlk:' + r.id] = k.rows[i].like || ''; out['rrk:' + r.id] = k.rows[i].risk || ''; }); });
    if (window.PreserveUI) PreserveUI.outputs(c, out);
    $$('[data-out]').forEach(el => { const v = out[el.dataset.out]; if (v !== undefined && el.innerHTML !== v) el.innerHTML = v; });
  }
  A.changed.cases = function (el, sc, committed, path) { if (path === 'visits' && sc && sc.obj === doc()) { doc().visitsFrom = String(doc().visits || '').trim() ? '' : 'photos'; if (committed) A.render(); } refreshCase(); };

  // ---------- scopes for the fields above ----------
  const cs = extra => Object.assign({ col: 'cases', id: doc().id }, extra);
  A.scopes['case'] = () => cs({ obj: doc() });
  A.scopes.cfile = sc => cs({ obj: meta(doc(), sc.dataset.rel) });
  A.scopes.csec = sc => cs({ obj: doc().sections.find(s => s.id === sc.dataset.id) });
  A.scopes.crisk = () => cs({ obj: doc().risk });
  A.scopes.rtree = sc => cs({ obj: doc().risk.trees.find(t => t.id === sc.dataset.id) });
  A.scopes.rrow = sc => { const t = doc().risk.trees.find(x => x.id === sc.dataset.tree); return cs({ obj: t && t.rows.find(r => r.id === sc.dataset.id) }); };
  A.scopes.person = sc => ({ obj: S.settings.people.find(p => p.id === sc.dataset.id), col: 'library', id: 'settings' });

  // ---------- settings: where cases live, people, certification wording ----------
  A.settingsExtra = function () {
    const st = S.settings;
    return '<div class="card"><h2>Where cases are kept</h2><p class="sub">' + (st.casesRoot ? '<code>' + esc(st.casesRoot) + '</code>' : 'Not chosen yet.') + '</p><div class="row" style="margin-top:10px"><button class="btn small" data-act="choose-root">Choose the folder…</button></div></div>' +
      '<div class="card"><h2>People who sign reports</h2><p class="hint" style="margin-bottom:10px">Tick the people for each case on its Overview tab. The qualifications paragraph and the certification line go into the report as written here.</p>' +
      (st.people || []).map(p => '<div class="sec" data-scope="person" data-id="' + p.id + '">' + (p.review ? '<p class="note" style="margin:0 0 10px">Copied from an earlier report. Check that it is current, then untick “Needs checking”.</p>' : '') +
        '<div class="grid2">' + field('Name', 'name', p.name, { rerender: true }) + field('Credential line under the signature', 'credential', p.credential) + '</div>' +
        '<div style="margin-top:10px">' + field('Qualifications paragraph', 'qual', p.qual, { area: true, rows: 3 }) + '</div><div style="margin-top:10px">' + field('Certification line', 'cert', p.cert, { area: true, rows: 2 }) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (p.sig && p.sig.data ? '<img alt="Signature" src="data:image/png;base64,' + p.sig.data + '" style="height:38px;background:#fff;border:1px solid var(--rule);border-radius:6px;padding:3px">' : '<span class="hint">No signature image.</span>') +
        '<button class="btn small" data-act="person-sig" data-id="' + p.id + '">Choose a signature image…</button>' + (p.sig ? '<button class="btn small" data-act="person-sig-clear" data-id="' + p.id + '">Remove</button>' : '') +
        '<label class="check"><input type="checkbox" data-bind="self" ' + (p.self ? 'checked' : '') + '><span>Tick for new cases</span></label><label class="check"><input type="checkbox" data-bind="review" data-rerender ' + (p.review ? 'checked' : '') + '><span>Needs checking</span></label>' +
        '<span class="sp"></span><button class="btn small danger" data-act="person-del" data-id="' + p.id + '">Remove this person</button></div></div>').join('') +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="person-add">Add a person</button></div></div>' +
      '<div class="card" data-scope="settings"><h2>Company and certification wording</h2><div class="grid2">' + field('Company name', 'companyName', st.companyName) + field('Company address', 'companyAddress', st.companyAddress, { area: true, rows: 2 }) + '</div>' +
      '<div style="margin-top:12px">' + field('Certification statements, one per line', 'certLines', st.certLines, { area: true, rows: 7, help: 'Write {I} and {my} where the wording should change between one signer (I, my) and several (We, our).' }) + '</div></div>';
  };

  // ---------- actions ----------
  const ACT = A.ACT;
  function newCaseDialog() {
    S.modal = { type: 'newcase' };
    A.openModal('<h2>New case</h2><div style="margin-top:10px"><label class="f"><span>Short name</span><input data-case-name autofocus placeholder="e.g. the client’s name"></label></div>' +
      '<div style="margin-top:12px"><label class="f"><span>Kind of case</span><select data-case-type>' + TYPES.map(t => '<option value="' + t[0] + '">' + t[1] + '</option>').join('') + '</select><small>This sets the starting outline of the report. You can change the outline later.</small></label></div>' +
      '<p class="hint" style="margin-top:10px">A folder with this name is made in <code>' + esc(S.settings.casesRoot) + '</code>.</p><div class="row end" style="margin-top:14px"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="create-case">Create the case</button></div>', true);
  }
  async function chooseRoot() {
    const r = await Host.call('chooseFolder', { prompt: 'Choose the folder where your cases will be kept' });
    if (!r || !r.path) return false;
    S.settings.casesRoot = r.path; await A.push('library', 'settings'); await loadCases(); return true;
  }
  Object.assign(ACT, {
    'choose-root': async () => { try { if (await chooseRoot()) A.render(); } catch (e) { toast('Could not use that folder: ' + (e.message || e)); } },
    'new-case': async () => { try { if (!S.settings.casesRoot && !(await chooseRoot())) return; newCaseDialog(); } catch (e) { toast('Could not start a case: ' + (e.message || e)); } },
    'create-case': async () => {
      const name = ($('[data-case-name]').value || '').trim(), type = $('[data-case-type]').value; if (!name) { $('[data-case-name]').focus(); return; }
      try { const d = blankCase(name, type), r = await Host.call('caseCreate', { root: S.settings.casesRoot, name: name, doc: d }); S.cases[d.id] = { path: r.path, folder: r.folder, doc: d }; CS.files[d.id] = []; CS.loaded[d.id] = true; A.closeModal(); A.go({ view: 'case', id: d.id, tab: 'overview' }); }
      catch (e) { toast('Could not create the case: ' + (e.message || e)); }
    },
    'open-case': b => A.go({ view: 'case', id: b.dataset.id, tab: b.dataset.tab || 'overview' }),
    'case-tab': b => { S.route.tab = b.dataset.tab; A.flush(); A.onRoute(S.route); A.render(); },
    'case-folder': () => Host.call('caseOpen', { path: rec().path }),
    'add-files': async b => { const r = rec(); try { const added = await Host.call('caseAddFiles', { path: r.path, folder: b.dataset.folder || '' }); if (added && added.length) { await rescan(); toast('Added ' + plural(added.length, 'file')); } } catch (e) { toast('Could not add files: ' + (e.message || e)); } },
    rescan: () => rescan().then(() => toast('Folder read again')),
    'open-file': b => Host.call('caseOpen', { path: rec().path, rel: b.dataset.rel }),
    'read-file': async b => { try { const t = await Host.call('caseReadText', { path: rec().path, rel: b.dataset.rel }); A.openModal('<h2>' + esc(b.dataset.rel.split('/').pop()) + '</h2><div class="body"><pre style="white-space:pre-wrap;font:13px/1.5 var(--f-num);margin:0">' + esc(t) + '</pre></div><div class="row end" style="margin-top:14px"><button class="btn primary" data-act="close-modal">Close</button></div>'); } catch (e) { toast('Could not read it: ' + (e.message || e)); } },
    'trash-file': async b => { if (!A.armed(b, 'Click again')) return; const r = rec(), rel = b.dataset.rel; try { await Host.call('caseTrash', { path: r.path, rel: rel }); r.doc.photos = (r.doc.photos || []).filter(x => x !== rel); if (CS.note && CS.note.rel === rel) CS.note = null; saveCase(); await rescan(); toast('Moved to the Removed files folder'); } catch (e) { toast('Could not remove it: ' + (e.message || e)); } },
    'photo-add': b => { const c = doc(); c.photos = c.photos || []; if (c.photos.indexOf(b.dataset.rel) < 0) c.photos.push(b.dataset.rel); saveCase(); A.render(); },
    'visit-from-photos': () => { const c = doc(); c.visits = ''; c.visitsFrom = 'photos'; syncVisit(c); saveCase(); A.render(); },
    'photo-note': b => { const c = doc(); meta(c, b.dataset.rel).fieldNote = b.dataset.on === '1'; if (b.dataset.on === '1') c.photos = (c.photos || []).filter(x => x !== b.dataset.rel); saveCase(); A.render(); },
    'photo-remove': b => { const c = doc(); c.photos = c.photos.filter(x => x !== b.dataset.rel); saveCase(); A.render(); },
    'photo-move': b => { const c = doc(), list = photosIn(c).map(f => f.rel), i = list.indexOf(b.dataset.rel), j = i + (+b.dataset.d); if (i < 0 || j < 0 || j >= list.length) return; list.splice(j, 0, list.splice(i, 1)[0]); c.photos = list; saveCase(); A.render(); },
    'new-note': async () => { const r = rec(), rel = 'Notes/Note ' + A.today() + ' ' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.txt'; try { await Host.call('caseWriteText', { path: r.path, rel: rel, text: '' }); CS.note = { caseId: r.doc.id, rel: rel, text: '' }; await rescan(); const t = $('[data-note-text]'); if (t) t.focus(); } catch (e) { toast('Could not make the note: ' + (e.message || e)); } },
    'open-note': async b => { const r = rec(); await flushNote(); try { const t = await Host.call('caseReadText', { path: r.path, rel: b.dataset.rel }); CS.note = { caseId: r.doc.id, rel: b.dataset.rel, text: t }; A.render(); } catch (e) { toast('Could not open the note: ' + (e.message || e)); } },
    'case-new-appraisal': () => { const c = doc(); ACT['new'](); S.modal = { type: 'new', caseId: c.id }; const t = $('[data-new-title]'); if (t) t.value = c.name || ''; },
    'risk-add-tree': () => { const c = doc(); c.risk.trees.push({ id: uid(), label: '', species: '', dbh: '', height: '', location: '', rows: [{ id: uid(), part: '', concern: '', target: '', occ: '', lof: '', loi: '', cons: '' }], mitigation: '', residual: '', interval: '', notes: '' }); saveCase(); A.render(); },
    'risk-del-tree': b => { if (!A.armed(b)) return; const c = doc(); c.risk.trees = c.risk.trees.filter(t => t.id !== b.dataset.id); saveCase(); A.render(); },
    'risk-add-row': b => { const t = doc().risk.trees.find(x => x.id === b.dataset.id); t.rows.push({ id: uid(), part: '', concern: '', target: '', occ: '', lof: '', loi: '', cons: '' }); saveCase(); A.render(); },
    'risk-del-row': b => { const t = doc().risk.trees.find(x => x.id === b.dataset.tree); t.rows = t.rows.filter(r => r.id !== b.dataset.id); saveCase(); A.render(); },
    'sec-move': b => { const c = doc(), i = c.sections.findIndex(s => s.id === b.dataset.id), j = i + (+b.dataset.d); if (i < 0 || j < 0 || j >= c.sections.length) return; c.sections.splice(j, 0, c.sections.splice(i, 1)[0]); saveCase(); A.render(); },
    'sec-del': b => { const c = doc(), s = c.sections.find(x => x.id === b.dataset.id); if (s && String(s.text || '').trim() && !A.armed(b, 'It has text. Click again')) return; c.sections = c.sections.filter(x => x.id !== b.dataset.id); saveCase(); A.render(); },
    'sec-add': b => { const c = doc(), k = b.dataset.key, s = { id: uid(), key: k, title: SEC[k] || 'New section', on: true, text: '' }, at = c.sections.findIndex(x => x.key === 'conclusion'); if (at >= 0) c.sections.splice(at, 0, s); else c.sections.push(s); saveCase(); A.render(); },
    'person-add': () => { S.settings.people.push({ id: uid(), self: false, review: false, name: '', role: 'Consulting Arborist', credential: '', qual: '', cert: '', sig: null }); A.save('library', 'settings'); A.render(); },
    'person-del': b => { if (!A.armed(b, 'Click again to remove')) return; S.settings.people = S.settings.people.filter(p => p.id !== b.dataset.id); A.save('library', 'settings'); A.render(); },
    'person-sig': async b => { try { const r = await Host.call('pickImage'); if (r && r.data) { S.settings.people.find(p => p.id === b.dataset.id).sig = r; A.save('library', 'settings'); A.render(); } } catch (e) { toast('Could not read that image'); } },
    'person-sig-clear': b => { S.settings.people.find(p => p.id === b.dataset.id).sig = null; A.save('library', 'settings'); A.render(); },
    'create-report': async b => {
      const r = rec(), c = r.doc; b.disabled = true; const old = b.textContent; b.textContent = 'Building the report…';
      try {
        await A.flush();
        const built = await CaseReport.build(c, { path: r.path, files: filesOf(c), photos: photosIn(c), appraisals: caseAppraisals(c).filter(a => !(c.apOut && c.apOut[a.id])), settings: S.settings, ratings: S.ratings, sheets: S.sheets });
        const name = (c.reportTitle || c.name || 'Report').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + ' - draft ' + A.today() + '.docx';
        const saved = await Host.call('caseSaveReport', { path: r.path, name: name, data: Docx.bytesToB64(built.bytes) });
        await Host.call('openInPages', { path: saved.path }); await rescan(); toast('Report created with ' + plural(built.photos, 'photo') + '. Opening in Pages…');
      } catch (e) { toast('Could not create the report: ' + (e.message || e)); }
      b.disabled = false; b.textContent = old;
    }
  });

  // Ticks that are not plain fields: authors on the Overview tab and "include in report" on the Appraisal tab.
  document.addEventListener('change', e => {
    const el = e.target, c = doc(); if (!c) return;
    if (el.dataset.author) { const id = el.dataset.author; c.authors = (S.settings.people || []).map(p => p.id).filter(p => p === id ? el.checked : c.authors.indexOf(p) >= 0); saveCase(); }
    else if (el.dataset.apin) { c.apOut = c.apOut || {}; if (el.checked) delete c.apOut[el.dataset.apin]; else c.apOut[el.dataset.apin] = true; saveCase(); }
  });
  // Notes are files, saved a moment after typing stops; changing the title renames the file.
  function flushNote() { clearTimeout(CS.noteTimer); const n = CS.note, r = n && S.cases[n.caseId]; if (!n || !r || !n.dirty) return Promise.resolve(); n.dirty = false; return Host.call('caseWriteText', { path: r.path, rel: n.rel, text: n.text }).then(() => { const s = $('[data-note-status]'); if (s) s.textContent = 'Saved in the case folder'; }, e => toast('Could not save the note: ' + (e.message || e))); }
  document.addEventListener('input', e => {
    const el = e.target; if (!el.hasAttribute || !el.hasAttribute('data-note-text') || !CS.note) return;
    CS.note.text = el.value; CS.note.dirty = true; const s = $('[data-note-status]'); if (s) s.textContent = 'Saving…'; clearTimeout(CS.noteTimer); CS.noteTimer = setTimeout(flushNote, 600);
  });
  document.addEventListener('change', async e => {
    const el = e.target; if (!el.hasAttribute || !el.hasAttribute('data-note-title') || !CS.note) return;
    const r = rec(), name = el.value.trim(); if (!name) return;
    try { await flushNote(); const out = await Host.call('caseRename', { path: r.path, rel: CS.note.rel, name: name + '.txt' }); CS.note.rel = out.rel; await rescan(); } catch (err) { toast('Could not rename the note: ' + (err.message || err)); }
  });
  window.addEventListener('beforeunload', flushNote);
  // In the preview there is no Mac window to catch dropped files, so the page uploads them itself.
  if (Host.mode !== 'app') {
    document.addEventListener('dragover', e => { if (rec()) e.preventDefault(); });
    document.addEventListener('drop', async e => {
      const r = rec(); if (!r || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); let n = 0;
      for (const f of Array.from(e.dataTransfer.files)) { const bytes = new Uint8Array(await f.arrayBuffer()); await Host.call('caseUpload', { path: r.path, folder: S.route.tab === 'photos' ? 'Photos' : '', name: f.name, data: Docx.bytesToB64(bytes) }); n++; }
      window.__caseFilesChanged(n);
    });
  }

  // Used by the Mac app's self-test: makes a case in a temporary folder and runs it through to a finished report.
  window.__caseSelfTest = async function () {
    const out = {};
    const r = await Host.call('chooseFolder', { prompt: 'test' }); if (!r || !r.path) { out.skipped = 'no test folder'; return out; }
    S.settings.casesRoot = r.path; await loadCases(); out.casesBefore = Object.keys(S.cases).length;
    const d = blankCase('Self test case', 'cutting'), made = await Host.call('caseCreate', { root: r.path, name: d.name, doc: d });
    S.cases[d.id] = { path: made.path, folder: made.folder, doc: d }; CS.files[d.id] = []; CS.loaded[d.id] = true;
    S.route = { view: 'case', id: d.id, tab: 'files' }; A.onRoute(S.route);
    const added = await Host.call('caseAddFiles', { path: made.path, folder: '' }); out.added = added.length;
    CS.files[d.id] = await Host.call('caseScan', { path: made.path }); out.scanned = CS.files[d.id].map(f => f.rel);
    d.photos = CS.files[d.id].filter(f => f.kind === 'image').map(f => f.rel); d.photos.forEach((rel, i) => { meta(d, rel).caption = 'Self test caption ' + (i + 1); });
    d.to = { name: 'Mr. Test', address: '1 Test St.\nLafayette, LA', salutation: 'Mr. Test' }; d.reportDate = A.today();
    d.risk.trees.push({ id: uid(), label: '1', species: 'Water oak', dbh: '24', rows: [{ id: uid(), part: 'Branch', concern: 'dead', target: 'walk', occ: 'Frequent', lof: 'Probable', loi: 'High', cons: 'Significant' }] });
    d.sections.push({ id: uid(), key: 'risk', title: 'Tree Risk Assessment', on: true, text: '' });
    await A.push('cases', d.id);
    A.render(); out.tabs = $$('.tab').length; out.fileRows = $$('tr[data-scope=cfile]').length;
    S.route.tab = 'photos'; A.render(); await new Promise(res => setTimeout(res, 900)); out.thumbs = $$('img[data-thumb]').filter(i => i.naturalWidth > 0).length + '/' + $$('img[data-thumb]').length;
    S.route.tab = 'risk'; A.render(); out.risk = ($('[data-out^="rov:"]') || {}).textContent;
    if (window.PreserveUI && PreserveUI.selfTest) out.preserve = PreserveUI.selfTest(d);
    const built = await CaseReport.build(d, { path: made.path, files: CS.files[d.id], photos: photosIn(d), appraisals: [], settings: S.settings, ratings: S.ratings, sheets: S.sheets });
    const saved = await Host.call('caseSaveReport', { path: made.path, name: 'Self test report.docx', data: Docx.bytesToB64(built.bytes) });
    out.reportBytes = built.bytes.length; out.reportPhotos = built.photos; out.reportPath = saved.path; out.opened = !!(await Host.call('openInPages', { path: saved.path }));
    await loadCases(); out.casesAfter = Object.keys(S.cases).length; out.checks = reportChecks(d).length;
    if (window.__writeSelfTest && S.cases[d.id]) out.write = await window.__writeSelfTest(d.id);
    if (window.__agentSelfTest && S.cases[d.id]) out.agent = await window.__agentSelfTest(d.id);
    S.route = { view: 'case', id: d.id, tab: 'photos' }; A.render(); await new Promise(res => setTimeout(res, 600));
    return out;
  };

  window.CaseUI = { visitFromPhotos: visitFromPhotos, syncVisit: syncVisit, isNote: isNote, meta: meta, CS: CS, TAB: TAB, SEC: SEC, TYPES: TYPES, doc: doc, rec: rec, saveCase: saveCase, refreshCase: refreshCase, filesOf: filesOf, photosIn: photosIn, caseAppraisals: caseAppraisals, loadCases: loadCases, loadCase: loadCase, fmtDate: fmtDate, flushNote: flushNote, outlineCards: outlineCards, reportChecks: reportChecks, rescan: rescan };
})();
