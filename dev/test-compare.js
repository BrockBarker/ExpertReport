// Run with:  jsc app/js/engine.js app/js/report.js dev/test-compare.js
var pass = 0, fail = 0, E = Engine, R = Report;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL  ' + name + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); } }
function near(name, got, want, tol) { ok(name + ' = ' + want, got !== null && got !== undefined && Math.abs(got - want) <= (tol === undefined ? 0.01 : tol), got); }

var a = { id: 'a', edition: '9', sizeMode: 'dbh', locationMode: 'parts', oversize: 'formula', depreciateReplacement: true, ata: true, rounding: 'guide9',
  defaults: { cond: 70, site: 75, contrib: 75, place: 75, loc: null, func: 100, ext: 100 }, compare: { '9f': true, '10f': true, '10r': true },
  species: [{ id: 's', common: 'Pecan', rating: { pct: 74 }, repl: [{ size: '3', cost: 275 }], install: 150, unitMode: 'tree' }],
  trees: [{ id: 't1', sp: 's', size: '17', method: 'auto' }, { id: 't2', sp: 's', size: '3', method: 'auto' }, { id: 't3', sp: 's', size: '24', method: 'auto', func: 80, ext: 90 }], lines: [] };
var before = JSON.stringify(a);
ok('only the ticked approaches', E.compareKeys(a).join() === '9f,10f,10r');
ok('nothing ticked, nothing compared', E.compareKeys({}).length === 0 && E.compare({ trees: [] }).keys.length === 0);
var all = E.compare(a, ['9f', '9r', '10f', '10r']);
ok('the appraisal itself is not changed', JSON.stringify(a) === before);
var unit = 275 / (0.7854 * 9), ta17 = 0.7854 * 289, f9 = 0.74 * 0.70 * 0.75;
var r = all.by['9f'].A.rows;
near('9th formula, basic tree cost', r[0].basic, (ta17 - 0.7854 * 9) * unit + 425, 0.01);
near('9th formula, value rounded to $10', r[0].value, Math.round(((ta17 - 0.7854 * 9) * unit + 425) * f9 / 10) * 10);
ok('9th formula is held even for a tree of replaceable size', r[1].method === 'formula');
r = all.by['9r'].A.rows;
near('9th replacement, small tree', r[1].value, Math.round(425 * f9 / 10) * 10);
ok('9th replacement on a large tree is flagged as valued at the largest listed tree', r[0].capped === true && r[0].value === Math.round(425 * f9 / 10) * 10, r[0]);
r = all.by['10f'].A.rows;
near('10th formula, basic cost is whole trunk area times unit cost', r[0].basic, ta17 * unit, 0.01);
near('10th formula, value rounded to $100', r[0].value, Math.round(ta17 * unit * 0.70 / 100) * 100);
near('10th formula uses the tree\'s own functional and external limits', r[2].raw, 0.7854 * 576 * unit * 0.70 * 0.80 * 0.90, 0.01);
r = all.by['10r'].A.rows;
near('10th replacement, depreciated by condition', r[1].value, Math.round(425 * 0.70 / 100) * 100);
ok('the other edition keeps its own rounding rule', E.roundRule(all.by['10f'].a) === 100 && E.roundRule(all.by['9f'].a) === 'guide9');
ok('totals add up', Math.abs(all.by['9f'].A.trees - all.by['9f'].A.rows.reduce(function (s, c) { return s + c.value; }, 0)) < 0.01);
var t = R.compare(a);
ok('comparison table has a column for each ticked approach', t.head.length === 6 && t.head[3] === '9th ed. Trunk Formula' && t.head[5] === '10th ed. Replacement', t.head);
ok('one row per tree, with a total', t.rows.length === 3 && t.total[0] === 'Total' && t.total[3] === E.money(E.compare(a).by['9f'].A.trees), t.total);
ok('widths fill the page', t.widths.reduce(function (x, y) { return x + y; }, 0) === 9360, t.widths);
var t4 = R.compare(a, ['9f', '9r', '10f', '10r']);
ok('four columns still fill the page, and the capped value is marked', t4.widths.reduce(function (x, y) { return x + y; }, 0) === 9360 && t4.capped && /†$/.test(t4.rows[0][4]) && /†/.test(R.compareNote(t4)), t4.rows[0]);
var b = JSON.parse(before); b.trees[0].cond = null; b.defaults.cond = null;
ok('a missing rating shows as incomplete, not as a value', R.compare(b).rows[0][3] === 'incomplete' && R.compare(b).missing === true);
print(pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error('comparison tests failed');
