#!/usr/bin/env node
/**
 * PMI V4 algorithm spot-check.
 *
 * Reimplements the core aggregation math from src/lib/apis/airbtics.ts
 * (buildDataFromReportComps V4 pipeline, Stage 3) as pure JS and runs
 * it against 8 hand-transcribed PMI reports. Prints per-case error
 * and an overall summary.
 *
 * Why duplicate the math instead of importing the TS code? The
 * project has no tsx/ts-node, so running TS directly from a .mjs
 * script is not supported. The duplication is acceptable because:
 *  (a) this script is a one-shot validation tool, not production
 *      code, and (b) the rule constants below mirror pmi-rules.ts
 *      exactly — drift will show up as per-case errors.
 *
 * RUN:   node scripts/pmi-spot-check.mjs
 * EXIT:  0 if ≥6/8 within ±10%, 1 otherwise
 */

// ─── Constants (MUST MATCH src/lib/apis/pmi-rules.ts) ──────────────
const BED_GAP_BOOST_PER_BED = 0.15;
const GUEST_GAP_SHRINK_THRESHOLD = -1;
const GUEST_GAP_SHRINK_DAMP = 0.5;
const COASTAL_SMALL_BED_THRESHOLD = 2;
const OUTLIER_ADR_MULTIPLIER = 3.0;
const OUTLIER_REVENUE_MULTIPLIER = 2.0;
const OUTLIER_DISTANCE_MULTIPLIER = 5.0;
const MIN_COMPS_FOR_AGGREGATION = 6;
const TOP_N_FOR_COMPRESSED_PREMIUM = 8;
const COMPRESSED_PREMIUM = new Set(['EH1', 'EH2', 'OX1', 'BA1']);
const COASTAL_OCC = { 0: 0.68, 1: 0.78, 2: 0.62, 3: 0.53, 4: 0.56, 5: 0.52 };
const RURAL_LEISURE_OCC = { 0: 0.65, 1: 0.71, 2: 0.65, 3: 0.60, 4: 0.56, 5: 0.54 };

// ─── Helpers ───────────────────────────────────────────────────────
const median = (xs) => {
  const s = [...xs].filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const outward = (pc) => (pc || '').trim().toUpperCase().split(/\s+/)[0] || '';
const isPremium = (pc) => COMPRESSED_PREMIUM.has(outward(pc));
const typicalOcc = (locClass) => {
  if (locClass === 'coastal') return COASTAL_OCC;
  if (locClass === 'rural_village' || locClass === 'rural_isolated') return RURAL_LEISURE_OCC;
  return null;
};
const clampBeds = (b) => Math.max(0, Math.min(5, Math.round(b)));

// ─── V4 pipeline (mirrors airbtics.ts Step 5a-5g) ──────────────────
function predictV4(subject, comps) {
  // 5a: pool medians
  const adrs = comps.map(c => c.adr);
  const revs = comps.map(c => c.revenue);
  const dists = comps.map(c => c.distanceMi);
  const mAdr = median(adrs), mRev = median(revs), mDist = median(dists);

  // 5b: outlier filter
  const filtered = comps.filter(c => {
    const adrOut = mAdr > 0 && c.adr > OUTLIER_ADR_MULTIPLIER * mAdr && mRev > 0 && c.revenue > OUTLIER_REVENUE_MULTIPLIER * mRev;
    const distOut = mDist > 0 && c.distanceMi > OUTLIER_DISTANCE_MULTIPLIER * mDist;
    return !adrOut && !distOut;
  });
  const effective = filtered.length >= MIN_COMPS_FOR_AGGREGATION ? filtered : comps;

  // 5c: per-comp RevPAR
  const revpars = effective.map(c => c.adr * (c.occ / 100)).filter(v => v > 0);

  // 5d: aggregate (top-8 if compressed premium, mean if coastal-small, else median)
  let target, method;
  if (isPremium(subject.postcode)) {
    const topN = [...revpars].sort((a, b) => b - a).slice(0, TOP_N_FOR_COMPRESSED_PREMIUM);
    target = topN.length ? topN.reduce((s, v) => s + v, 0) / topN.length : 0;
    method = `top${TOP_N_FOR_COMPRESSED_PREMIUM}mean`;
  } else if (subject.locationClass === 'coastal' && subject.bedrooms <= COASTAL_SMALL_BED_THRESHOLD) {
    target = revpars.length ? revpars.reduce((s, v) => s + v, 0) / revpars.length : 0;
    method = 'coastalSmallMean';
  } else {
    target = median(revpars);
    method = 'median';
  }

  // 5e: subject-vs-pool adjustments
  const mBeds = median(effective.map(c => c.bedrooms));
  const mGuests = median(effective.map(c => c.guests));
  const bedGap = subject.bedrooms - mBeds;
  const guestGap = subject.guests - mGuests;
  let factor = 1, reason = 'none';
  if (bedGap >= 1 && guestGap >= 0) {
    factor = 1 + BED_GAP_BOOST_PER_BED * bedGap;
    reason = `bed+${bedGap}`;
  } else if (guestGap <= GUEST_GAP_SHRINK_THRESHOLD && mGuests > 0 && !isPremium(subject.postcode)) {
    // Damped shrink: 1 - DAMP × (1 - ratio). Pulls half-way back toward 1.0.
    const rawRatio = subject.guests / mGuests;
    factor = 1 - GUEST_GAP_SHRINK_DAMP * (1 - rawRatio);
    reason = `guest${guestGap}_damped`;
  } else if (guestGap <= GUEST_GAP_SHRINK_THRESHOLD && isPremium(subject.postcode)) {
    reason = `guest${guestGap}_skipped(premium)`;
  }
  const adjusted = target * factor;

  // 5f: derive occupancy
  const table = typicalOcc(subject.locationClass);
  let occ, occSrc;
  if (table) {
    occ = table[clampBeds(subject.bedrooms)] ?? 0.60;
    occSrc = `table:${subject.locationClass}`;
  } else {
    occ = median(effective.map(c => c.occ / 100));
    if (!(occ > 0)) occ = 0.60;
    occSrc = 'compmedian';
  }

  // 5g: split
  const adr = occ > 0 ? adjusted / occ : 0;
  const predRev = adjusted * 365;

  return { target, adjusted, occ, adr, predRev, method, reason, occSrc, bedGap, guestGap, mBeds, mGuests, droppedByFilter: comps.length - filtered.length };
}

// ─── Test cases (8 most diagnostic of 33 PMI samples) ──────────────
// Comp order: [bedrooms, guests, distanceMi, availDays (unused), occ%, ADR, revenue]
const make = (arr) => arr.map(([b, g, d, a, o, adr, rev]) => ({ bedrooms: b, guests: g, distanceMi: d, availDays: a, occ: o, adr, revenue: rev }));

const CASES = [
  { name: 'Sheffield S1 4LG (1b/3g) - baseline median',
    subject: { bedrooms: 1, guests: 3, postcode: 'S1 4LG', locationClass: 'urban' },
    pmi: { rev: 24421, adr: 87, occ: 77 },
    comps: make([
      [1,3,0.27,182,74,71,9549],[1,3,0.27,126,82,74,7635],[1,3,0.27,308,70,140,30250],
      [1,3,0.27,259,80,77,15949],[1,3,0.27,336,67,80,18242],[1,3,0.27,126,55,135,9230],
      [1,3,0.27,238,77,146,26809],[1,3,0.27,126,45,157,8704],[1,3,0.27,161,47,151,11205],
      [1,3,0.27,98,24,143,3443],[1,3,0.27,252,62,103,15949],[1,3,0.27,147,50,108,7807],
    ]) },
  { name: 'Edinburgh EH1 1BS (4b/9g) - COMPRESSED PREMIUM',
    subject: { bedrooms: 4, guests: 9, postcode: 'EH1 1BS', locationClass: 'urban' },
    pmi: { rev: 181793, adr: 671, occ: 73 },
    comps: make([
      [4,10,0.03,329,60,672,136880],[4,10,0.03,336,55,722,134884],[4,8,0.03,301,73,678,148605],
      [4,8,0.02,357,78,682,185439],[5,10,0.01,308,73,725,164604],[4,10,0.09,308,65,583,117577],
      [4,8,0.05,336,77,724,178289],[4,10,0.12,259,56,578,80533],[4,8,0.15,210,56,1025,123367],
      [3,10,0.15,182,54,531,52813],[3,10,0.12,91,54,267,12876],[3,8,0.11,308,59,526,93732],
    ]) },
  { name: 'Derby DE1 (5b/10g) - standard median',
    subject: { bedrooms: 5, guests: 10, postcode: 'DE1', locationClass: 'urban' },
    pmi: { rev: 41566, adr: 174, occ: 66 },
    comps: make([
      [5,10,0.30,98,37,840,30179],[5,10,0.35,161,55,220,19916],[5,9,0.65,189,69,155,19968],
      [5,10,1.83,91,90,386,31731],[4,9,0.50,154,59,187,16849],[4,9,0.51,175,61,171,18427],
      [4,10,1.28,245,44,179,19024],[5,8,0.79,252,69,134,23196],[4,8,0.18,280,75,141,29330],
      [4,8,0.35,273,73,147,29396],[4,8,0.45,224,71,181,28762],[3,10,1.29,196,53,174,18282],
    ]) },
  { name: 'Broadstairs CT10 (4b/9g) - COASTAL LARGE',
    subject: { bedrooms: 4, guests: 9, postcode: 'CT10 2PU', locationClass: 'coastal' },
    pmi: { rev: 55808, adr: 273, occ: 56 },
    comps: make([
      [4,12,0.09,196,44,798,69827],[4,8,0.87,133,53,289,20448],[4,8,0.87,189,51,463,45247],
      [4,10,1.00,287,66,279,50569],[4,8,0.99,140,88,312,39192],[4,8,1.00,329,47,256,40948],
      [4,9,1.09,245,44,262,27795],[4,8,1.04,245,54,280,37672],[4,8,1.09,189,48,342,28147],
      [4,8,1.06,147,68,368,37166],[4,8,1.03,343,50,303,54008],[4,8,1.08,336,48,271,42910],
    ]) },
  { name: 'Broadstairs CT10 (1b/2g) - COASTAL SMALL',
    subject: { bedrooms: 1, guests: 2, postcode: 'CT10 2PU', locationClass: 'coastal' },
    pmi: { rev: 28488, adr: 98, occ: 80 },
    comps: make([
      [1,2,0.73,350,89,74,22583],[1,2,0.83,329,78,85,22092],[1,2,0.80,266,73,94,18191],
      [1,2,0.84,140,51,106,7426],[1,2,0.88,126,94,131,15483],[1,2,0.84,350,91,126,40326],
      [1,2,0.95,357,57,118,23877],[1,2,0.92,203,64,88,11365],[1,2,0.96,266,54,200,29433],
      [1,2,1.01,217,54,96,10934],[1,2,1.02,259,59,138,20075],[1,2,1.01,259,58,133,19963],
    ]) },
  { name: 'Glasgow G12 8RF (3b/3g) - GUEST-GAP SHRINK',
    subject: { bedrooms: 3, guests: 3, postcode: 'G12 8RF', locationClass: 'urban' },
    pmi: { rev: 46591, adr: 203, occ: 63 },
    comps: make([
      [2,3,0.11,252,54,226,31091],[3,4,0.54,224,66,219,32049],[2,3,0.36,161,84,136,18328],
      [3,5,0.09,210,63,345,45534],[3,5,0.20,308,66,257,52646],[3,5,0.32,210,81,266,45554],
      [2,4,0.09,308,71,197,41387],[2,4,0.03,210,68,207,28109],[2,4,0.07,98,65,248,16122],
      [2,4,0.07,175,78,138,19015],[2,4,0.06,315,74,199,46157],[2,4,0.09,189,63,228,26922],
    ]) },
  { name: 'Nottingham NG1 1GL (4b/10g) - BED-GAP BOOST',
    subject: { bedrooms: 4, guests: 10, postcode: 'NG1 1GL', locationClass: 'urban' },
    pmi: { rev: 61600, adr: 263, occ: 64 },
    comps: make([
      [4,10,0.12,189,30,490,27526],[3,10,0.19,133,32,134,5765],[5,10,0.27,329,48,269,40456],
      [3,10,0.24,161,74,281,33105],[4,10,0.32,126,70,265,23703],[4,10,0.33,343,70,274,64177],
      [3,10,0.33,357,66,225,52939],[4,9,0.33,147,56,138,11315],[4,9,0.29,315,53,141,23482],
      [4,9,0.38,294,81,156,37086],[4,8,0.35,112,38,180,7622],[3,9,0.38,329,69,204,45440],
    ]) },
  { name: 'Oxford OX1 (4b/10g) - COMPRESSED PREMIUM #2',
    subject: { bedrooms: 4, guests: 10, postcode: 'OX1 4UT', locationClass: 'urban' },
    pmi: { rev: 106358, adr: 416, occ: 70 },
    comps: make([
      [5,10,0.46,154,79,659,81025],[3,10,0.47,154,63,236,22435],[3,9,0.44,224,85,400,74894],
      [4,8,0.46,161,73,240,27934],[4,8,0.52,210,50,440,46500],[5,10,0.57,287,48,560,73780],
      [5,9,0.56,175,54,385,36493],[4,8,0.54,217,71,405,61787],[6,10,0.60,266,56,512,75741],
      [4,8,0.59,126,42,258,13551],[4,8,0.60,315,71,355,79270],[4,10,0.73,133,39,384,19502],
    ]) },
  // ─── Batch 2 (heterogeneous / over-spec / low-demand cases) ──────
  { name: 'Bradford BD1 2PF (3b/6g) - heterogeneous + bed-gap',
    subject: { bedrooms: 3, guests: 6, postcode: 'BD1 2PF', locationClass: 'urban' },
    pmi: { rev: 35437, adr: 155, occ: 63 },
    comps: make([
      [3,6,0.15,182,57,362,38615],[3,6,0.15,168,81,325,44667],[3,6,0.44,217,45,212,21304],
      [2,6,0.03,280,71,134,26927],[2,6,0.15,182,73,172,22555],[2,6,0.29,203,46,136,12853],
      [2,6,0.38,252,43,145,15538],[2,6,0.36,294,65,132,25305],[2,6,0.36,266,70,199,37534],
      [2,6,0.36,287,56,135,21456],[3,6,1.12,259,63,147,23874],[2,6,0.42,182,38,106,7348],
    ]) },
  { name: 'Leicester LE1 6TE (4b/8g) - over-spec subject',
    subject: { bedrooms: 4, guests: 8, postcode: 'LE1 6TE', locationClass: 'urban' },
    pmi: { rev: 43229, adr: 180, occ: 66 },
    comps: make([
      [3,8,0.06,266,76,167,33927],[4,10,0.18,287,70,179,36406],[4,6,0.21,231,76,169,29829],
      [3,8,0.22,168,72,148,18025],[4,8,0.50,105,70,191,14314],[4,8,0.50,147,51,251,18791],
      [3,8,0.50,140,69,210,20299],[4,10,0.53,343,71,194,47195],[4,10,0.53,189,29,226,12220],
      [5,9,0.61,350,83,341,99273],[4,8,0.72,252,79,163,33202],[3,8,0.73,266,62,143,23580],
    ]) },
  { name: 'Buxton SK17 6UQ (3b/6g) - heterogeneous rural',
    subject: { bedrooms: 3, guests: 6, postcode: 'SK17 6UQ', locationClass: 'rural_village' },
    pmi: { rev: 42129, adr: 174, occ: 66 },
    comps: make([
      [4,6,0.08,308,68,171,36626],[3,5,0.30,203,71,107,15385],[3,6,0.35,224,81,270,49291],
      [2,6,0.45,329,58,212,40277],[3,5,0.61,343,65,145,32083],[3,6,0.77,315,64,133,26895],
      [3,6,0.74,196,64,290,37318],[3,6,0.75,266,74,248,51357],[3,6,0.75,252,42,164,16893],
      [3,6,0.80,154,60,246,22592],[3,6,0.84,343,73,159,39837],[3,6,0.87,168,45,160,12227],
    ]) },
  { name: 'Plymouth PL4 0NQ (4b/8g) - coastal city large',
    subject: { bedrooms: 4, guests: 8, postcode: 'PL4 0NQ', locationClass: 'coastal' },
    pmi: { rev: 52719, adr: 219, occ: 66 },
    comps: make([
      [4,9,0.03,252,56,293,42408],[4,10,0.09,273,84,187,43253],[4,8,0.17,343,69,181,43403],
      [3,8,0.18,210,56,250,28285],[3,8,0.18,182,52,229,21939],[3,8,0.18,168,68,169,19338],
      [3,8,0.17,336,58,162,29994],[4,10,0.21,203,67,250,32666],[4,7,0.24,259,57,165,24537],
      [3,7,0.27,336,72,129,31457],[3,7,0.32,308,81,192,47788],[5,9,0.34,224,53,346,40859],
    ]) },
  { name: 'Stoke ST1 1PS (2b/5g) - low-demand city',
    subject: { bedrooms: 2, guests: 5, postcode: 'ST1 1PS', locationClass: 'rural_village' },
    pmi: { rev: 35448, adr: 147, occ: 66 },
    comps: make([
      [2,6,0.08,329,71,141,33299],[2,5,0.14,315,71,143,32839],[3,5,0.21,161,58,177,16930],
      [3,6,0.19,322,77,140,35052],[2,5,0.33,140,76,160,17286],[2,6,0.29,259,68,129,23241],
      [2,6,0.31,273,68,134,25713],[2,6,0.34,133,75,148,15045],[2,5,0.39,140,62,86,7485],
      [2,6,0.36,287,68,141,28243],[2,6,0.36,308,71,161,35693],[2,5,0.44,203,61,88,10786],
    ]) },
  // ─── Batch 2 part 2 (rural+studio+premium-studio) ──────
  { name: 'Stoke ST4 2QA (3b/6g) - very high-occ low-ADR market',
    subject: { bedrooms: 3, guests: 6, postcode: 'ST4 2QA', locationClass: 'rural_village' },
    pmi: { rev: 32313, adr: 107, occ: 83 },
    comps: make([
      [2,6,0.43,308,79,106,25959],[3,6,0.52,315,84,122,32345],[3,7,0.47,161,63,115,11650],
      [3,6,0.57,112,79,113,9852],[3,6,0.58,126,82,95,9860],[3,6,0.56,168,90,95,14189],
      [3,6,0.58,154,81,115,14510],[3,6,0.55,252,94,125,29503],[3,6,0.53,133,79,122,13009],
      [3,6,0.63,287,67,139,26380],[3,6,0.63,273,51,180,25018],[4,6,0.63,91,86,89,7049],
    ]) },
  { name: 'Newquay TR7 1EN (studio/2g) - coastal studio',
    subject: { bedrooms: 0, guests: 2, postcode: 'TR7 1EN', locationClass: 'coastal' },
    pmi: { rev: 31936, adr: 112, occ: 77 },
    comps: make([
      [1,2,0.05,350,77,142,39518],[1,2,0.06,189,68,149,18347],[1,2,0.04,266,56,128,18971],
      [1,2,0.12,294,74,98,21114],[1,2,0.15,224,72,81,12808],[1,2,0.16,168,79,82,10800],
      [1,2,0.18,119,51,124,7769],[1,2,0.21,273,77,151,31197],[1,2,0.20,112,66,64,4928],
      [1,2,0.21,175,76,102,13805],[1,2,0.21,273,82,91,20631],[1,2,0.26,287,90,115,29952],
    ]) },
  { name: 'London SW1V 2PW (studio/2g) - PIMLICO premium studio',
    subject: { bedrooms: 0, guests: 2, postcode: 'SW1V 2PW', locationClass: 'urban' },
    pmi: { rev: 58853, adr: 201, occ: 80 },
    comps: make([
      [1,2,0.02,287,72,172,35502],[1,2,0.09,203,59,247,28879],[1,2,0.09,245,82,212,42031],
      [1,2,0.09,154,92,145,20674],[1,2,0.04,357,91,165,53581],[1,2,0.09,357,92,164,53510],
      [1,2,0.06,175,80,223,30851],[1,2,0.05,217,67,208,30470],[1,2,0.09,112,50,238,12963],
      [1,2,0.07,140,73,215,22386],[1,2,0.09,147,76,237,25957],[1,2,0.06,175,80,214,30266],
    ]) },
  { name: 'Mere BA12 6DG (2b/4g) - rural Wiltshire',
    subject: { bedrooms: 2, guests: 4, postcode: 'BA12 6DG', locationClass: 'rural_village' },
    pmi: { rev: 43311, adr: 158, occ: 75 },
    comps: make([
      [2,4,0.24,224,58,127,16066],[2,4,0.80,259,78,150,30538],[2,4,0.80,189,84,156,24618],
      [1,4,0.16,280,66,107,19872],[2,5,0.40,336,60,163,32466],[2,4,1.26,119,58,159,11311],
      [2,4,1.35,336,87,171,49986],[2,4,1.40,273,70,161,31211],[2,4,1.62,154,94,156,22368],
      [2,4,1.72,280,61,166,28146],[2,4,1.72,238,60,170,24214],[2,4,1.73,294,72,123,25957],
    ]) },
];

// ─── Runner ────────────────────────────────────────────────────────
console.log(`PMI V4 spot-check — ${CASES.length} diagnostic cases\n`);
const pad = (s, n) => String(s).padEnd(n);
const fmt = (v) => new Intl.NumberFormat('en-GB').format(Math.round(v));

let withinFive = 0, withinTen = 0, withinFifteen = 0;
console.log(pad('Case', 46), pad('PMI', 10), pad('Pred', 10), pad('Err%', 8), pad('Method', 14), 'Notes');
console.log('─'.repeat(120));
for (const c of CASES) {
  const r = predictV4(c.subject, c.comps);
  const errPct = ((r.predRev - c.pmi.rev) / c.pmi.rev) * 100;
  const abs = Math.abs(errPct);
  if (abs <= 5) withinFive++;
  if (abs <= 10) withinTen++;
  if (abs <= 15) withinFifteen++;
  const mark = abs <= 5 ? '✓' : abs <= 10 ? '·' : abs <= 15 ? '!' : 'X';
  const notes = `${mark} droppedBy=${r.droppedByFilter} reason=${r.reason} occ=${r.occSrc}`;
  console.log(
    pad(c.name.slice(0, 44), 46),
    pad('£' + fmt(c.pmi.rev), 10),
    pad('£' + fmt(r.predRev), 10),
    pad((errPct >= 0 ? '+' : '') + errPct.toFixed(1) + '%', 8),
    pad(r.method, 14),
    notes
  );
}
console.log('─'.repeat(120));
const total = CASES.length;
const pct = (n) => `(${((n / total) * 100).toFixed(0)}%)`;
console.log(`Within ±5%:  ${withinFive}/${total} ${pct(withinFive)}`);
console.log(`Within ±10%: ${withinTen}/${total} ${pct(withinTen)}`);
console.log(`Within ±15%: ${withinFifteen}/${total} ${pct(withinFifteen)}`);
const passThreshold = Math.ceil(total * 0.75); // 75% within ±10%
const passed = withinTen >= passThreshold;
console.log(`\n${passed ? 'PASS' : 'FAIL'} (pass criterion: ≥${passThreshold}/${total} within ±10%, i.e. 75%)`);
process.exit(passed ? 0 : 1);
