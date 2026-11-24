/* Expert Report: tree risk rating. Pure functions, no DOM.
 * The two matrices are the standard ISA tree risk assessment matrices, as already used in the TRAQer app.
 * All labels and wording around them here are original. */
(function (root) {
  'use strict';
  var FAIL = ['Improbable', 'Possible', 'Probable', 'Imminent'];
  var IMPACT = ['Very low', 'Low', 'Medium', 'High'];
  var LIKE = ['Unlikely', 'Somewhat likely', 'Likely', 'Very likely'];
  var CONSEQ = ['Negligible', 'Minor', 'Significant', 'Severe'];
  var RISK = ['Low', 'Moderate', 'High', 'Extreme'];
  var OCC = ['Rare', 'Occasional', 'Frequent', 'Constant'];
  var PARTS = ['Branch', 'Trunk', 'Root collar', 'Roots and soil', 'Whole tree'];
  var LEVELS = ['Level 1: limited visual assessment', 'Level 2: basic assessment', 'Level 3: advanced assessment'];
  // Matrix 1: rows are likelihood of failure, columns likelihood of impacting the target.
  var M1 = [
    ['Unlikely', 'Unlikely', 'Unlikely', 'Unlikely'],
    ['Unlikely', 'Unlikely', 'Unlikely', 'Somewhat likely'],
    ['Unlikely', 'Unlikely', 'Somewhat likely', 'Likely'],
    ['Unlikely', 'Somewhat likely', 'Likely', 'Very likely']
  ];
  // Matrix 2: rows are likelihood of failure and impact, columns consequences.
  var M2 = [
    ['Low', 'Low', 'Low', 'Low'],
    ['Low', 'Low', 'Moderate', 'Moderate'],
    ['Low', 'Moderate', 'High', 'High'],
    ['Low', 'Moderate', 'High', 'Extreme']
  ];
  function like(lof, loi) { var i = FAIL.indexOf(lof), j = IMPACT.indexOf(loi); return i < 0 || j < 0 ? null : M1[i][j]; }
  function rate(lk, cons) { var i = LIKE.indexOf(lk), j = CONSEQ.indexOf(cons); return i < 0 || j < 0 ? null : M2[i][j]; }
  function calcRow(r) { var lk = like(r.lof, r.loi); return { like: lk, risk: lk ? rate(lk, r.cons) : null }; }
  function used(r) { return !!(String(r.part || '').trim() || String(r.concern || '').trim() || String(r.target || '').trim() || r.lof || r.loi || r.cons); }
  function calcTree(t) {
    var rows = (t.rows || []).map(calcRow), top = -1, missing = 0, n = 0;
    (t.rows || []).forEach(function (r, i) { if (!used(r)) return; n++; if (rows[i].risk === null) missing++; else top = Math.max(top, RISK.indexOf(rows[i].risk)); });
    return { rows: rows, overall: top < 0 ? null : RISK[top], missing: missing, n: n };
  }
  function label(t, i) { return String(t.label || '').trim() || String(i + 1); }
  // One table per tree for the report.
  function table(t) {
    var c = calcTree(t), rows = [];
    (t.rows || []).forEach(function (r, i) {
      if (!used(r)) return;
      rows.push([r.part || '', r.concern || '', (r.target || '') + (r.occ ? ' (' + r.occ.toLowerCase() + ' use)' : ''), r.lof || '—', r.loi || '—', c.rows[i].like || '—', r.cons || '—', c.rows[i].risk || 'incomplete']);
    });
    return { head: ['Tree part', 'Condition of concern', 'Target', 'Likelihood of failure', 'Likelihood of impact', 'Failure and impact', 'Consequences', 'Risk rating'], rows: rows,
      widths: [860, 1800, 1400, 1020, 1020, 1000, 1280, 980], align: ['l', 'l', 'l', 'l', 'l', 'l', 'l', 'l'], size: 8 };
  }
  function summary(risk) {
    var rows = [];
    ((risk && risk.trees) || []).forEach(function (t, i) { var c = calcTree(t); rows.push([label(t, i), t.species || '', t.dbh ? String(t.dbh) : '', c.overall || (c.n ? 'incomplete' : 'not rated'), t.residual || '', t.interval || '']); });
    return { head: ['Tree', 'Species', 'Diameter (in)', 'Risk rating', 'Residual risk after mitigation', 'Next inspection'], rows: rows, widths: [900, 2200, 1200, 1400, 2060, 1600], align: ['l', 'l', 'r', 'l', 'l', 'l'], size: 9 };
  }
  root.Risk = { FAIL: FAIL, IMPACT: IMPACT, LIKE: LIKE, CONSEQ: CONSEQ, RISK: RISK, OCC: OCC, PARTS: PARTS, LEVELS: LEVELS, like: like, rate: rate, calcRow: calcRow, calcTree: calcTree, used: used, label: label, table: table, summary: summary };
})(typeof window !== 'undefined' ? window : globalThis);
