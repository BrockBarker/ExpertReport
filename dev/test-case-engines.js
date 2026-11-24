// Run with:  jsc app/js/risk.js app/js/zones.js dev/test-case-engines.js
var pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL  ' + name + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); } }
function near(name, got, want, tol) { ok(name + ' = ' + want, got !== null && got !== undefined && Math.abs(got - want) <= (tol === undefined ? 0.01 : tol), got); }

// ---------- risk matrices ----------
var R = Risk;
ok('imminent + high impact', R.like('Imminent', 'High') === 'Very likely');
ok('imminent + very low impact', R.like('Imminent', 'Very low') === 'Unlikely');
ok('probable + medium impact', R.like('Probable', 'Medium') === 'Somewhat likely');
ok('probable + high impact', R.like('Probable', 'High') === 'Likely');
ok('possible + high impact', R.like('Possible', 'High') === 'Somewhat likely');
ok('possible + medium impact', R.like('Possible', 'Medium') === 'Unlikely');
ok('improbable is always unlikely', R.IMPACT.every(function (i) { return R.like('Improbable', i) === 'Unlikely'; }));
ok('very likely + severe', R.rate('Very likely', 'Severe') === 'Extreme');
ok('very likely + significant', R.rate('Very likely', 'Significant') === 'High');
ok('likely + severe', R.rate('Likely', 'Severe') === 'High');
ok('likely + minor', R.rate('Likely', 'Minor') === 'Moderate');
ok('somewhat likely + significant', R.rate('Somewhat likely', 'Significant') === 'Moderate');
ok('somewhat likely + minor', R.rate('Somewhat likely', 'Minor') === 'Low');
ok('unlikely is always low', R.CONSEQ.every(function (c) { return R.rate('Unlikely', c) === 'Low'; }));
ok('negligible is always low', R.LIKE.every(function (l) { return R.rate(l, 'Negligible') === 'Low'; }));
ok('unfinished row gives no rating', R.calcRow({ lof: 'Probable', loi: '', cons: 'Severe' }).risk === null);
var tree = { label: 'T1', rows: [{ part: 'Branch', concern: 'dead', target: 'walk', lof: 'Probable', loi: 'High', cons: 'Significant' }, { part: 'Trunk', lof: 'Possible', loi: 'Low', cons: 'Severe' }, { part: '', concern: '' }, { part: 'Roots', lof: 'Possible' }] };
var c = R.calcTree(tree);
ok('row ratings', c.rows[0].like === 'Likely' && c.rows[0].risk === 'High' && c.rows[1].risk === 'Low', c.rows);
ok('tree takes its highest rating', c.overall === 'High');
ok('blank row ignored, unfinished row counted', c.n === 3 && c.missing === 1, c);
ok('report table has one row per used part', R.table(tree).rows.length === 3);
ok('risk table widths fill the page', R.table(tree).widths.reduce(function (a, b) { return a + b; }, 0) === 9360 && R.summary({ trees: [tree] }).widths.reduce(function (a, b) { return a + b; }, 0) === 9360);

// ---------- protection zones ----------
var Z = Zones;
near('trunk diameter method, good tolerance, mature, 24 in', Z.radius({ dbh: 24, tol: 'good', age: 'mature' }, { method: 'bmp' }).r, 18);
near('trunk diameter method, poor tolerance, overmature, 30 in', Z.radius({ dbh: 30, tol: 'poor', age: 'over' }, { method: 'bmp' }).r, 45);
near('trunk diameter method, moderate, young, 10 in', Z.radius({ dbh: 10, tol: 'moderate', age: 'young' }, { method: 'bmp' }).r, 7.5);
ok('trunk diameter method asks for tolerance', Z.radius({ dbh: 24, age: 'mature' }, { method: 'bmp' }).missing === 'species tolerance');
ok('trunk diameter method asks for age', Z.radius({ dbh: 24, tol: 'good' }, { method: 'bmp' }).missing === 'tree age');
ok('no diameter, no zone', Z.radius({ dbh: '' }, { method: 'ft1' }).r === null);
near('1 ft per inch', Z.radius({ dbh: 24 }, { method: 'ft1' }).r, 24);
near('1.5 ft per inch', Z.radius({ dbh: 24 }, { method: 'ft15' }).r, 36);
near('own figure 1.25', Z.radius({ dbh: 20 }, { method: 'custom', mult: '1.25' }).r, 25);
near('BS 5837 capped at 15 m', Z.radius({ dbh: 60 }, { method: 'bs5837' }).r, 49.2126, 0.001);
near('BS 5837, 30 in', Z.radius({ dbh: 30 }, { method: 'bs5837' }).r, 30);
near('AS 4970 minimum 2 m', Z.radius({ dbh: 1 }, { method: 'as4970' }).r, 6.5617, 0.001);
near('AS 4970 maximum 15 m', Z.radius({ dbh: 70 }, { method: 'as4970' }).r, 49.2126, 0.001);
near('structural root zone, 24 in trunk, in metres', Z.srz(24) / Z.FT, 2.688, 0.005);
near('structural root zone, 30 in trunk, in metres', Z.srz(30) / Z.FT, 2.952, 0.005);
near('structural root zone minimum 1.5 m', Z.srz(2) / Z.FT, 1.5, 0.001);
near('edge through the trunk takes half the zone', Z.segment(10, 0), 0.5, 1e-9);
near('edge at the rim takes nothing', Z.segment(10, 10), 0);
near('edge at half the radius', Z.segment(10, 5), 0.19550, 0.0001);
near('edge beyond the zone', Z.segment(10, 12), 0);
var k = Z.calcTree({ dbh: 24, tol: 'moderate', age: 'mature', encs: [{ kind: 'line', value: '12' }, { kind: 'pct', value: '5' }, { kind: 'area', value: '181' }] }, { method: 'bmp' });
near('zone radius', k.r, 24); near('zone area', k.area, Math.PI * 576, 0.01);
near('straight edge at half the radius', k.encs[0].pct, 19.55, 0.01); near('area share', k.encs[2].pct, 181 / (Math.PI * 576) * 100, 0.001); near('total disturbed', k.total, 19.55 + 5 + 10.0, 0.02);
ok('nearest edge in trunk diameters', Math.abs(k.closestX - 6) < 1e-9, k.closestX);
ok('12 ft is outside the structural root zone of a 24 in tree', k.inSrz === false);
ok('5 ft is inside it', Z.calcTree({ dbh: 24, tol: 'good', age: 'young', encs: [{ kind: 'line', value: '5' }] }, { method: 'bmp' }).inSrz === true);
// The ISA table is in trunk diameters and differs from Matheny and Clark in two cells (good/mature and moderate/young: 8, not 9).
near('ISA table, good tolerance, mature, 30 in: 8 diameters', Z.radius({ dbh: 30, tol: 'good', age: 'mature' }, { method: 'isa' }).r, 20);
near('ISA table, moderate, young, 12 in: 8 diameters', Z.radius({ dbh: 12, tol: 'moderate', age: 'young' }, { method: 'isa' }).r, 8);
near('ISA table, poor, overmature, 24 in: 18 diameters', Z.radius({ dbh: 24, tol: 'poor', age: 'over' }, { method: 'isa' }).r, 36);
near('ISA table, good, young, 24 in: 6 diameters', Z.radius({ dbh: 24, tol: 'good', age: 'young' }, { method: 'isa' }).r, 12);
ok('the two tables agree everywhere else', ['good', 'moderate', 'poor'].every(function (t) { return ['young', 'mature', 'over'].every(function (a) { var same = Math.abs(Z.ISA[t][a] / 12 - Z.MC[t][a]) < 1e-9, odd = (t === 'good' && a === 'mature') || (t === 'moderate' && a === 'young'); return same !== odd; }); }));
near('1.25 ft per inch', Z.radius({ dbh: 24 }, { method: 'ft125' }).r, 30);
ok('a case with no method keeps the older table', Z.methodOf({}) === 'bmp' && Z.methodOf({ method: 'isa' }) === 'isa');
near('two stems combine as the root of the sum of squares', Z.diameter('21+24').d, Math.sqrt(21 * 21 + 24 * 24), 1e-9);
near('zone for two stems, 1 ft per inch', Z.radius({ dbh: '21 + 24' }, { method: 'ft1' }).r, 31.89, 0.01);
ok('tunnel distances by trunk diameter', [5, 8, 9, 10, 14, 15, 19, 20, 40].map(function (d) { return Z.tunnel(d).dist; }).join() === '5,5,5,10,10,12,12,15,15', [5, 8, 9, 10, 14, 15, 19, 20, 40].map(function (d) { return Z.tunnel(d).dist; }));
ok('tunnel depth 24 in under 12 in, 36 in from 12 in', Z.tunnel(11).depth === 24 && Z.tunnel(12).depth === 36);
ok('small trees are flagged as disputed', Z.tunnel(4).small === true && Z.tunnel(6).small === false);
function tier(dist) { return Z.calcTree({ dbh: 30, encs: [{ kind: 'line', value: String(dist) }] }, { method: 'ft1' }).tier; }
ok('AS 4970:2025 tiers: minor, moderate, major', tier(24) === 'minor' && tier(18) === 'moderate' && tier(12) === 'major', [tier(24), tier(18), tier(12)]);
ok('anything inside the structural root zone is major', Z.calcTree({ dbh: 30, encs: [{ kind: 'pct', value: '2' }, { kind: 'line', value: '9' }] }, { method: 'ft15' }).tier === 'major');
ok('no disturbance, no tier', Z.calcTree({ dbh: 30, encs: [] }, { method: 'ft1' }).tier === null);
ok('zone table widths fill the page', Z.table({ method: 'bmp', trees: [] }).widths.reduce(function (a, b) { return a + b; }, 0) === 9360 && Z.table({ method: 'ft1', trees: [] }).widths.reduce(function (a, b) { return a + b; }, 0) === 9360);

print(pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error('case engine tests failed');
