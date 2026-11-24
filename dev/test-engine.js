// Run with:  jsc app/js/engine.js dev/fixtures/vestal-prelim-table.js dev/test-engine.js
var E = Engine, pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) pass++; else { fail++; print('FAIL  ' + name + (detail !== undefined ? '   got: ' + JSON.stringify(detail) : '')); } }
function near(name, got, want, tol) { ok(name + ' = ' + want, got !== null && got !== undefined && Math.abs(got - want) <= (tol === undefined ? 0.01 : tol), got); }
var uid = 0; function id() { return 'x' + (++uid); }
function appraisal(o) { var a = { edition: '9', sizeMode: 'dbh', defaults: {}, species: [], trees: [], lines: [] }; for (var k in o) a[k] = o[k]; return a; }
function sp(o) { var s = { id: id(), common: 'Test', rating: { pct: 100 }, repl: [], install: null, unitMode: 'tree' }; for (var k in o) s[k] = o[k]; return s; }
function tree(s, size, o) { var t = { id: id(), sp: s.id, size: String(size) }; for (var k in (o || {})) t[k] = o[k]; return t; }

// --- trunk area
near('TA(1.75)', E.TA(1.75), 2.4053, 0.0005);
near('TA(30)', E.TA(30), 706.86, 0.01);
near('ATA9(40)', E.ATA9(40), 1149, 0.01);
near('ATA9(60)', E.ATA9(60), 1865, 0.01);

// --- parsing
near('size 7 1/2', E.parseSize('7 1/2', 'dbh').d, 7.5);
near('size 21+24 equivalent diameter', E.parseSize('21+24', 'dbh').d, Math.sqrt(21 * 21 + 24 * 24), 1e-9);
near('size 21+24 area', E.parseSize('21 + 24', 'dbh').area, 0.7854 * (441 + 576), 1e-6);
near('circumference 29 -> diameter', E.parseSize('29', 'circ').d, 29 / Math.PI, 1e-9);
near('area 76 -> area', E.parseSize('76', 'area').area, 76);
ok('bad size flagged', E.parseSize('abc', 'dbh').bad === true);
ok('empty size flagged', E.parseSize('', 'dbh').empty === true);
var r = E.parseRange('2 1/2 - 3'); near('range min', r.min, 2.5); near('range max', r.max, 3); near('range mid', r.mid, 2.75);
r = E.parseRange('9-10'); near('range 9-10 mid', r.mid, 9.5);
r = E.parseRange('1 ½ - 2”'); near('range with typographic half', r.min, 1.5); near('range typographic max', r.max, 2);
near('range single', E.parseRange('4').mid, 4);

// --- rounding
near('guide9 4,999 -> 5,000', E.roundValue(4999, 'guide9'), 5000);
near('guide9 4,994 -> 4,990', E.roundValue(4994, 'guide9'), 4990);
near('guide9 5,049 -> 5,000', E.roundValue(5049, 'guide9'), 5000);
near('guide9 5,376 -> 5,400', E.roundValue(5376, 'guide9'), 5400);
near('round 100', E.roundValue(7875, 100), 7900);
near('round none', E.roundValue(7875.126, 0), 7875.13);

// --- 9th edition Trunk Formula Method, worked by hand:
// 20 in tree; replacement 4 in at $500, installation $300. TA_A 314.16, TA_R 12.5664, unit 39.789, increase 301.594,
// basic = 301.594 x 39.789 + 800 = 12,800.1; x .80 x .70 x .75 = 5,376.0 -> $5,400
var s1 = sp({ rating: { pct: 80 }, repl: [{ size: '4', cost: 500 }], install: 300 });
var a1 = appraisal({ species: [s1], trees: [tree(s1, 20, { cond: 70, site: 80, contrib: 70, place: 75 })] });
var c = E.calcTree(a1.trees[0], a1);
ok('9 TFM method chosen', c.methodName === 'Trunk Formula Method', c.methodName);
near('9 TFM unit cost', c.unit, 500 / (0.7854 * 16), 1e-6);
near('9 TFM increase', c.incr, 0.7854 * 400 - 0.7854 * 16, 1e-6);
near('9 TFM basic tree cost', c.basic, (0.7854 * 400 - 0.7854 * 16) * (500 / (0.7854 * 16)) + 800, 1e-6);
near('9 TFM location average', c.L, 75);
near('9 TFM raw value', c.raw, 12800 * 0.8 * 0.7 * 0.75, 0.5);
near('9 TFM rounded', c.value, 5400);
// unit cost on the installed cost instead
s1.unitMode = 'installed'; c = E.calcTree(a1.trees[0], a1);
near('9 TFM unit cost, installed basis', c.unit, 800 / (0.7854 * 16), 1e-6);
s1.unitMode = 'manual'; s1.unitManual = 45; c = E.calcTree(a1.trees[0], a1);
near('9 TFM unit cost, entered', c.unit, 45);
s1.unitMode = 'tree';

// --- 9th edition adjusted trunk area above 30 in
var a2 = appraisal({ species: [s1], trees: [tree(s1, 40, { cond: 100, site: 100, contrib: 100, place: 100 })] });
c = E.calcTree(a2.trees[0], a2);
ok('9 TFM uses adjusted trunk area over 30 in', c.adjusted === true); near('9 TFM adjusted area', c.areaUsed, 1149, 0.01);
a2.ata = false; c = E.calcTree(a2.trees[0], a2);
ok('adjusted area can be switched off', c.adjusted === false); near('unadjusted area', c.areaUsed, 0.7854 * 1600, 0.01);

// --- 9th edition Replacement Cost Method: 3 in tree, same species basis -> (500 + 300) x .8 x .7 x .75 = 336 -> $340
var a3 = appraisal({ species: [s1], trees: [tree(s1, 3, { cond: 70, site: 80, contrib: 70, place: 75 })] });
c = E.calcTree(a3.trees[0], a3);
ok('9 RCM method chosen for replaceable size', c.methodName === 'Replacement Cost Method', c.methodName);
near('9 RCM raw', c.raw, 336, 0.001); near('9 RCM rounded', c.value, 340);

// --- single location percentage and defaults that trees inherit
var a4 = appraisal({ locationMode: 'single', defaults: { cond: 80, loc: 50 }, species: [s1], trees: [tree(s1, 20), tree(s1, 20, { cond: 60 })] });
c = E.calcTree(a4.trees[0], a4); near('defaults inherited', c.raw, 12800 * 0.8 * 0.8 * 0.5, 0.5);
c = E.calcTree(a4.trees[1], a4); near('tree overrides default', c.raw, 12800 * 0.8 * 0.6 * 0.5, 0.5);

// --- missing data is reported, not guessed
var a5 = appraisal({ species: [sp({ rating: {}, repl: [] })], trees: [] }); a5.trees.push(tree(a5.species[0], '')); c = E.calcTree(a5.trees[0], a5);
ok('missing size reported', c.missing.indexOf('trunk size') >= 0, c.missing); ok('no value when data is missing', c.value === null);
a5.trees[0].size = '12'; c = E.calcTree(a5.trees[0], a5);
ok('missing species rating reported', c.missing.join().indexOf('species rating') >= 0, c.missing);
ok('missing replacement cost reported', c.missing.join().indexOf('replacement tree cost') >= 0, c.missing);
ok('missing condition reported', c.missing.indexOf('condition rating') >= 0, c.missing);

// --- 10th edition Trunk Formula Technique: 20 in; 4 in at $500 -> unit 39.789; basic 12,500; x .70 x .90 x 1.00 = 7,875
var s6 = sp({ repl: [{ size: '4', cost: 500 }] });
var a6 = appraisal({ edition: '10', rounding: 0, species: [s6], trees: [tree(s6, 20, { cond: 70, func: 90 })] });
c = E.calcTree(a6.trees[0], a6);
ok('10 TFT method chosen', c.methodName === 'Trunk Formula Technique', c.methodName);
near('10 TFT basic cost', c.basic, 12500, 0.001); near('10 TFT value', c.value, 7875, 0.001);
ok('10 TFT has no area adjustment', (function () { a6.trees[0].size = '40'; var x = E.calcTree(a6.trees[0], a6); a6.trees[0].size = '20'; return x.adjusted === false && Math.abs(x.basic - 0.7854 * 1600 * (500 / (0.7854 * 16))) < 1e-6; })());
ok('10th default rounding is $100', E.roundRule({ edition: '10' }) === 100); ok('9th default rounding is the Guide rule', E.roundRule({ edition: '9' }) === 'guide9');

// --- a wrongful-cutting replacement appraisal worked the way the 2025 report did it:
// price ladder by size, trees larger than the list valued at the largest listed tree, no depreciation.
var ladder = [['4', 900], ['4.5', 1250], ['5', 1500], ['5.5', 1750], ['6', 2000], ['6.5', 2500], ['7', 3500], ['7.5', 4000], ['8', 5000], ['9-10', 7500]].map(function (x) { return { size: x[0], cost: x[1], source: 'field-grown price list' }; });
var s7 = sp({ common: 'Shade tree', repl: ladder });
var sizes = ['17', '24', '10', '7', '8', '9', '21+24', '7', '10', '8'], want = [7500, 7500, 7500, 3500, 5000, 7500, 7500, 3500, 7500, 5000];
var a7 = appraisal({ edition: '10', rounding: 0, oversize: 'largest', depreciateReplacement: false, species: [s7], trees: sizes.map(function (z) { return tree(s7, z); }),
  lines: [{ id: id(), desc: 'Removal and replacement of 4 trees', qty: 4, each: 11500 }, { id: id(), desc: 'Corrective pruning', amt: 3000 }, { id: id(), desc: 'Stump grinding', amt: 5000 }, { id: id(), desc: 'Re-sodding', amt: 1000 }, { id: id(), desc: 'Shrubs', qty: 5, each: 100 }] });
var A = E.calcAppraisal(a7);
ok('ladder picks each tree price', A.rows.map(function (x) { return x.value; }).join() === want.join(), A.rows.map(function (x) { return x.value; }));
near('ladder trees total', A.trees, 62000); near('other costs total', A.lines, 55500); near('grand total', A.total, 117500);
ok('trees larger than the list are flagged as capped (17, 24 and 21+24)', A.capped === 3, A.capped);
a7.oversize = 'formula'; A = E.calcAppraisal(a7);
ok('same trees switch to the trunk formula when asked', A.rows[0].methodName === 'Trunk Formula Technique' && A.rows[3].methodName === 'Direct replacement cost');
near('17 in by trunk formula', A.rows[0].basic, 0.7854 * 289 * (7500 / (0.7854 * 9.5 * 9.5)), 0.01);

// --- a real 143-row hand-worked table: 9th-style formula, area entered directly, 90/80/50, $160 for a 1.5-2 in tree
var s8 = sp({ common: 'Bald cypress', rating: { pct: 90 }, repl: [{ size: '1.5-2', cost: 160 }] });
var a8 = appraisal({ sizeMode: 'area', locationMode: 'single', rounding: 0, ata: false, defaults: { cond: 80, loc: 50 }, species: [s8],
  trees: VESTAL_TABLE.map(function (rw) { return { id: id(), tag: String(rw[0]), sp: s8.id, size: String(rw[1]), stated: rw[3] }; }) });
A = E.calcAppraisal(a8);
near('unit cost matches the report ($66.52)', A.rows[0].unit, 66.52, 0.005);
near('tree 1 value', A.rows[0].value, 76 * 66.5201 * 0.36, 0.02);
ok('all 143 rows valued', A.done === 143, A.done);
var off = A.rows.filter(function (x) { return Math.abs(x.diff) > 5; }).map(function (x) { return +a8.trees[A.rows.indexOf(x)].tag; });
ok('finds exactly the six rows that do not multiply out', off.join() === '4,29,65,93,124,141', off);
near('sum of stated values', VESTAL_TABLE.reduce(function (s, rw) { return s + rw[3]; }, 0), 372804);
a8.ata = true; A = E.calcAppraisal(a8);
ok('with the 9th-edition adjustment on, trees over 30 in equivalent are adjusted', A.adjusted === VESTAL_TABLE.filter(function (rw) { return Math.sqrt(rw[1] / 0.7854) > 30; }).length && A.adjusted > 0, A.adjusted);

// --- stated-value comparison
var a9 = appraisal({ species: [s1], trees: [tree(s1, 20, { cond: 70, site: 80, contrib: 70, place: 75, stated: 5400 }), tree(s1, 20, { cond: 70, site: 80, contrib: 70, place: 75, stated: 5000 })] });
A = E.calcAppraisal(a9); ok('stated value mismatch counted', A.mismatches === 1, A.mismatches);

// --- one location rating in place of site, contribution and placement: no value may change
var a10 = appraisal({ rounding: 0, defaults: { cond: 70, site: 80, contrib: 65, place: 70 }, species: [s1], trees: [
  tree(s1, 20), tree(s1, 22, { site: 55 }), tree(s1, 24, { site: 90, contrib: 85, place: 41, loc: 5 }), tree(s1, 26, { loc: 12 }), tree(s1, 18, { cond: 50, place: 33.3 })] });
var before10 = E.calcAppraisal(a10).rows.map(function (x) { return x.raw; });
E.oneLocation(a10, true);
var after10 = E.calcAppraisal(a10).rows.map(function (x) { return x.raw; });
ok('one location rating: mode switched', a10.locationMode === 'single');
ok('one location rating: every value identical to the last digit', before10.length === 5 && before10.every(function (v, i) { return v !== null && v === after10[i]; }), [before10, after10]);
ok('one location rating: a tree with no parts of its own stays blank and uses the default', a10.trees[0].loc === null && a10.trees[3].loc === null && a10.defaults.loc === (80 + 65 + 70) / 3, [a10.trees[0].loc, a10.trees[3].loc, a10.defaults.loc]);
ok('one location rating: the three parts are kept in the file', a10.trees[2].site === 90 && a10.defaults.contrib === 65);
var a11 = appraisal({ defaults: { cond: 70, site: 80 }, species: [s1], trees: [tree(s1, 20, { contrib: 60 }), tree(s1, 20, { site: 80, contrib: 70, place: 75 })] });
E.oneLocation(a11, true);
ok('one location rating: incomplete parts stay incomplete', a11.trees[0].loc === null && a11.defaults.loc === null && E.calcAppraisal(a11).rows[0].value === null && a11.trees[1].loc === 75, [a11.trees[0].loc, a11.defaults.loc, a11.trees[1].loc]);
var a12 = appraisal({ locationMode: 'parts', defaults: { cond: 70, site: 80, contrib: 70, place: 75, loc: 40 }, species: [s1], trees: [tree(s1, 20, { loc: 55, site: 10, contrib: 10, place: 10 }), tree(s1, 20, { site: 90 })] });
E.oneLocation(a12, false);
ok('switching back by hand keeps a location rating already typed in', a12.trees[0].loc === 55 && a12.defaults.loc === 40 && a12.trees[1].loc === (90 + 70 + 75) / 3, [a12.trees[0].loc, a12.defaults.loc, a12.trees[1].loc]);

// --- the ways a species can be valued, each from the same trees
var so = sp({ rating: { pct: 80 }, install: 300, repl: [{ size: '2', cost: 200 }, { size: '4', cost: 500 }, { size: '', cost: 90 }, { size: '6', cost: 2000, ltd: true }] });
var ao = appraisal({ locationMode: 'single', rounding: 0, defaults: { cond: 70, loc: 75 }, species: [so], trees: [tree(so, 20), tree(so, 3), tree(so, 5, { method: 'formula' })] });
var O = E.options(ao, so.id), byKey = {}; O.list.forEach(function (o) { byKey[o.key] = o; });
ok('options: one replacement and one trunk formula choice for each priced size, plus mixed and nearest size', O.list.map(function (o) { return o.key; }).join() === 'auto,near,r0,f0,r1,f1,r3,f3', O.list.map(function (o) { return o.key; }));
ok('options: the species starts on the mixed choice, and one tree has its own method', O.current === 'auto' && O.n === 3 && O.own === 1, [O.current, O.n, O.own]);
near('options: price per square inch of the 4 in row', byKey.f1.perSqIn, 500 / (0.7854 * 16), 1e-6);
// trunk formula, 4 in base, 20 in tree: (314.16 - 12.5664) x 39.789 + 800 = 12,800.1 x .8 x .7 x .75 = 5,376.04
near('options: trunk formula from the 4 in base, 20 in tree', byKey.f1.values[0], 5376.04, 0.05);
// trunk formula, 2 in base: unit 200 / 3.1416 = 63.662; (314.16 - 3.1416) x 63.662 + 500 = 20,300.0 x .42 = 8,526.0
near('options: trunk formula from the 2 in base, 20 in tree', byKey.f0.values[0], 8526.0, 0.05);
// replacement cost at the 4 in size: (500 + 300) x .42 = 336 for every tree left on Auto; the tree set to trunk formula keeps it
near('options: replacement cost at the 4 in size', byKey.r1.values[0], 336, 0.005);
near('options: replacement cost at the 4 in size, small tree', byKey.r1.values[1], 336, 0.005);
ok('options: a tree with its own method keeps it', Math.abs(byKey.r1.values[2] - byKey.f1.values[2]) > 1 && byKey.r0.values[2] !== byKey.r0.values[0], [byKey.r1.values[2], byKey.f1.values[2]]);
// nearest size: 20 in tree -> largest listed (6 in, $2,000 + 300) x .42 = 966, capped; 3 in tree -> 4 in row = 336
near('options: nearest listed size, large tree', byKey.near.values[0], 966, 0.005);
near('options: nearest listed size, small tree', byKey.near.values[1], 336, 0.005);
near('options: totals add up', byKey.r1.total, byKey.r1.values[0] + byKey.r1.values[1] + byKey.r1.values[2], 0.005);
var snapO = JSON.stringify(ao); E.options(ao, so.id); ok('options: working them out changes nothing', JSON.stringify(ao) === snapO);
E.choose(so, 'r1'); ok('choose replacement at one size', so.method === 'replace' && so.repl[1].fixed === true && E.choiceOf(so) === 'r1' && E.calcAppraisal(ao).rows[0].value === byKey.r1.values[0]);
E.choose(so, 'f0'); ok('choose a base price', so.method === 'formula' && so.repl[0].base === true && !so.repl[1].fixed && E.baseAt(so) === 0 && E.choiceOf(so) === 'f0' && Math.abs(E.calcAppraisal(ao).trees - byKey.f0.total) < 1e-9, [E.calcAppraisal(ao).trees, byKey.f0.total]);
// (the third tree has its own trunk formula, which follows the base price just chosen, so only the first two are compared)
E.choose(so, 'near'); var An = E.calcAppraisal(ao).rows; ok('choose nearest size', E.choiceOf(so) === 'near' && An[0].value === byKey.near.values[0] && An[1].value === byKey.near.values[1], [An[0].value, An[1].value]);
so.unitManual = 50; E.choose(so, 'fm'); ok('choose a typed-in unit cost', E.choiceOf(so) === 'fm' && E.unitCost(so).unit === 50);
ok('options: a typed-in unit cost is offered once there is one', E.options(ao, so.id).list.some(function (o) { return o.key === 'fm'; }));
E.choose(so, 'f3'); ok('choosing a base price replaces the typed-in unit cost', so.unitMode === 'tree' && E.choiceOf(so) === 'f3');
E.choose(so, 'auto'); so.repl.forEach(function (r) { r.base = false; }); ok('back to mixed; the largest row is the base again', E.choiceOf(so) === 'auto' && E.baseAt(so) === 3);
var small = appraisal({ locationMode: 'single', defaults: { cond: 70, loc: 75 }, species: [so], trees: [tree(so, 1)] }); E.choose(so, 'r3');
ok('a chosen replacement larger than the tree is pointed out', E.calcAppraisal(small).rows[0].warn.some(function (w) { return /larger than this tree/.test(w); })); E.choose(so, 'auto');

print(pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error('engine tests failed');
