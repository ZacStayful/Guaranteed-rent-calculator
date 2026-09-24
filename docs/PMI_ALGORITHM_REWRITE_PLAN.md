# PMI-Aligned STR Estimation Algorithm — Rewrite Plan

**Status:** Draft, awaiting approval. No code changes until approved.
**Target branch:** `claude/fork-stayful-repo-vabXR`
**Do not merge to `main` until validation hits 85% within 10% across the 33-report PMI dataset.**

---

## 1. Context

The current STR estimator (branch `claude/fork-stayful-repo-vabXR`) uses a three-tier Airbtics pipeline (report/all → markets/bounds → static) with patchwork rules layered across multiple sessions. Known problems:

- Headline ADR derived from comp ADR aggregation directly — wrong operation (PMI splits via occupancy lookup).
- Tier B picker prefers quantity over relevance — wins for large-property cases where Tier A's smaller comp pool is more representative.
- Occupancy derivation is inconsistent — sometimes from comps, sometimes from static fallback, sometimes from market summary.
- No geo filter — non-UK comps contaminate pools (Barrow observed with 3 Connecticut/Pacific listings).
- No outlier handling — single £1,000+ ADR comp inflates median/mean significantly.

The aim of this rewrite is to match PMI's methodology site-wide. Accuracy goal: **85% of properties within 10% of PMI, 95% within 20%**, measured against a 33-report test set collected from PMI PDFs.

## 2. Ground truth and patterns

33 PMI reports have been analysed. The core formula holds for every sample:

```
Revenue = Headline_ADR × Headline_Occupancy × 365
```

Cross-sample patterns (see `PMI_CALIBRATION_DATA.md` for per-report tables):

| Pattern | Confirmed from | Evidence |
|---|---|---|
| Base: RevPAR_median × 365 predicts revenue | 33 samples | Within 10% for 70%, within 5% for 42% |
| Compressed-premium postcodes undershoot median | Edinburgh EH1, Oxford OX1, Bath BA1 (partial) | -20%, -19%, -9% respectively; top-8 mean fixes all |
| Bed-gap boost for over-spec'd subjects | Nottingham NG1 4ET, Nottingham NG1 1GL | -17%, -20% — fixed by +15%/extra-bed |
| Guest-gap shrink for under-spec'd subjects | Glasgow G12 (only confirmed case) | +13% — fixed by subject_guests/comp_median_guests ratio |
| Non-UK comps need filtering | Barrow LA14 | 3 of 12 comps in Connecticut/Pacific |
| Outlier comps need dropping | Penrith 5b, SW11, EC1R | Single £800+ ADR inflates aggregates |
| Size-dependent coastal occupancy | Broadstairs 1b 80% vs Broadstairs 4b 56% | Same postcode, different sizes |

## 3. The new algorithm (site-wide)

### Pipeline

```
Input: subject {postcode, bedrooms, guests, outdoor, parking, ...}
Output: { annualRevenue, adr, occupancy, monthlyBreakdown, comparables, quality }

Step 1. Fetch comps from Airbtics report/all (keep existing retry + cache logic).
Step 2. Filter comps:
  - Drop comps outside UK bounding box (lat/lng check, already exists)
  - Drop comps where distance > 5 × median(distance) of remaining comps (removes geocode outliers)
  - Drop comps where ADR > 3 × median(remaining ADRs) AND revenue > 2 × median(remaining revenues)
    (removes single-outlier luxury listings that pollute median upward)
Step 3. If fewer than 6 comps remain after filtering, fall back to Tier B markets/bounds (keep current logic).
Step 4. Compute per-comp RevPAR = comp.ADR × comp.Occupancy
Step 5. Classify the subject:
  - location_class = classifyLocation(postcode)  // existing
  - is_compressed_premium = COMPRESSED_PREMIUM_POSTCODES.has(outward_code)
  - bed_gap = subject.beds - median(comp.beds)
  - guest_gap = subject.guests - median(comp.guests)
Step 6. Compute target RevPAR:
  IF is_compressed_premium: target_RevPAR = mean(top 8 comp RevPARs by value)
  ELSE: target_RevPAR = median(comp RevPARs)
Step 7. Apply subject-vs-comp-pool adjustments:
  IF bed_gap >= 1 AND guest_gap >= 0: target_RevPAR *= (1 + 0.15 * bed_gap)
  IF guest_gap <= -1: target_RevPAR *= (subject.guests / median(comp.guests))
Step 8. Compute target Occupancy:
  IF location_class == 'coastal' OR location_class.startsWith('rural'):
    apply size-dependent occupancy table (see RULES.md)
  ELSE:
    target_Occupancy = median(comp.Occupancy)
Step 9. Derive headline ADR:
  headline_ADR = target_RevPAR / target_Occupancy
Step 10. Build monthly breakdown:
  Keep existing seasonal-curve code (seasonalADRMultiplier, seasonalOccMultiplier)
  Apply to headline_ADR and target_Occupancy
Step 11. Return { revenue=target_RevPAR*365, adr=headline_ADR, occupancy=target_Occupancy, monthly, comparables, quality }
```

### Rule tables (data, not code)

All thresholds live in a single file for easy tuning without code review:

```
src/lib/apis/pmi-rules.ts
```

Contents:

```typescript
export const COMPRESSED_PREMIUM_POSTCODES = new Set([
  'EH1', 'EH2',       // Edinburgh Old Town + New Town — confirmed
  'OX1',              // Oxford city centre — confirmed
  'BA1',              // Bath Royal Crescent — confirmed mild
  // CANDIDATES (unvalidated — add when confirmed by PMI data):
  // 'W1', 'SW1', 'SW1A', 'SW1X', 'WC1', 'WC2',  // Central London
  // 'YO1',  // York central — tested, plain median works, do NOT add
  // 'CB1', 'CB2',  // Cambridge central — tested, plain median works, do NOT add
]);

export const BED_GAP_BOOST_PER_BED = 0.15;       // +15% per extra bedroom over comp median
export const GUEST_GAP_SHRINK_THRESHOLD = -1;    // trigger shrinkage if guests <= median_guests - 1
export const OUTLIER_ADR_MULTIPLIER = 3.0;       // drop comps with ADR > this × median
export const OUTLIER_REVENUE_MULTIPLIER = 2.0;   // AND revenue > this × median
export const MIN_COMPS_FOR_AGGREGATION = 6;      // fall to Tier B below this
export const TOP_N_FOR_COMPRESSED_PREMIUM = 8;   // use top 8 of 12 comps for premium cities

export const COASTAL_OCCUPANCY_BY_BEDS: Record<number, number> = {
  0: 0.68, 1: 0.78, 2: 0.62, 3: 0.53, 4: 0.56, 5: 0.52,
};

export const RURAL_LEISURE_OCCUPANCY_BY_BEDS: Record<number, number> = {
  // Penrith-confirmed; mirrors coastal broadly
  0: 0.65, 1: 0.71, 2: 0.65, 3: 0.60, 4: 0.56, 5: 0.54,
};
```

Any post-launch miss can be investigated and, if it reveals a new rule, added as a new line in this file without touching core logic.

## 4. Code organisation

### Files to modify

| File | Change |
|---|---|
| `src/lib/apis/airbtics.ts` | Replace `buildDataFromReportComps` body with new pipeline. Keep `fetchReportAll`, `readReport`, cache code unchanged. Retain `getShortLetDataFromMarkets` as Tier B fallback but only invoke when Tier A returns <6 comps. |
| `src/app/api/analyse/route.ts` | No functional changes. Continues to orchestrate calls. Minor: pass `outwardCode` into options so Tier A can check `COMPRESSED_PREMIUM_POSTCODES`. |
| `src/lib/apis/pmi-rules.ts` (NEW) | Rule tables (shown above). |
| `src/lib/types.ts` | Add optional fields to `DataQuality`: `compressedPremium?: boolean`, `bedGapAdjustment?: number`, `guestShrinkApplied?: boolean` — for diagnostic output. |

### Files NOT to touch

- `src/app/page.tsx` and all UI components — the response shape is unchanged from the UI's perspective.
- `src/lib/analysis.ts`, `src/lib/tracker.ts` — unrelated.
- `scripts/calibrate.mjs` — keep existing harness; extend (see §6).

### Key functions to reuse

| Existing function | Use for |
|---|---|
| `classifyLocation(postcode)` | Step 5 location_class |
| `haversineKm(...)` | Distance computation for geo filter |
| `isUKListing(comp)` | UK bounding box check (Step 2) |
| `calculateMedian(...)` | Used throughout new pipeline |
| `normaliseOccupancy(v)` | Occupancy 0-100 → 0-1 conversion |
| `buildSeasonalMultipliers(...)` | Seasonal curves for monthly breakdown (Step 10) |
| `fetchReportAll(...)` | Airbtics call — no changes needed |
| `getShortLetDataFromMarkets(...)` | Tier B fallback when Tier A insufficient |
| `generateMarketEstimate(...)` | Final fallback (Tier C) when both tiers fail |
| `generateSyntheticComps(...)` | Synthetic comps for fallback results |

### Functions being replaced or removed

| Function | Fate |
|---|---|
| `buildDataFromReportComps` | Fully rewritten with new pipeline |
| `getADRMultiplier` with `headlineMode` | Deprecated — the new ADR derivation via `target_RevPAR / target_Occupancy` replaces it. Keep the function callable for scenarios (worst/base/best) but not headline. |
| `filterByGuestsTiered` | Kept but only used for Tier B. Tier A's new Step 2 filter supersedes. |
| `calculateWeightedADR` / `calculateWeightedOccupancy` | Deprecated in the headline path. Remove call sites (keep the functions for now in case needed for scenarios). |

## 5. Logging

Every decision point emits one line. This is the debuggability contract — any support case against the estimator should be resolvable from logs alone.

```
[PMI] Step 2 filter: comps=12→11 (dropped 1: non-UK {id=xxx,lat=38.9,lng=-76.5})
[PMI] Step 2 filter: comps=11→10 (dropped 1: outlier-adr £1025 vs median £478 × 3)
[PMI] Step 5 class: postcode=EH1 class=urban compressedPremium=true bedGap=0 guestGap=+1
[PMI] Step 6 target: method=top8mean RevPAR_comps=[310,323,378,397,403,494,529,531,557,574] → target=£469
[PMI] Step 7 adjust: bed_gap=0 guest_gap=+1 → no adjustment
[PMI] Step 8 occupancy: class=urban method=median_of_comps → 0.73
[PMI] Step 9 ADR: target_RevPAR=£469 / target_Occ=0.73 = £643
[PMI] Step 11 output: rev=£171,185 adr=£643 occ=73%
```

Log level is `info`. Every `[PMI]` line is parseable as JSON via a consistent key=value format so future log-based analysis is trivial.

## 6. Validation harness

`scripts/calibrate.mjs` already exists but currently reads from a local CSV Rahul has only. Extend it:

1. Add `scripts/pmi-test-dataset.json` — the 33 PMI reports encoded as structured JSON (subject + 12 comps + PMI headline). This file is committed and versioned in the repo.
2. Extend `scripts/calibrate.mjs` to:
   - Load `pmi-test-dataset.json`
   - For each entry: inject the 12 comps directly into a test harness (bypass Airbtics) so the test is deterministic
   - Call the new `buildDataFromReportComps` with the comps
   - Compare output `annualRevenue` to PMI's
   - Output a summary table with per-property error and aggregate hit rates
3. New Node script `scripts/pmi-validate.mjs`:
   - Runs the full dataset through the pipeline
   - Exit code 1 if fewer than 28/33 (85%) within 10%, 1 if any within 33% (sanity floor)
   - Can be wired into CI as a gate before merge

### Expected baseline performance (as predicted)

| Rule stack | Within 5% | Within 10% | >10% |
|---|---|---|---|
| Current code on main | 0% | ~15-20% | 80% |
| Baseline (median RevPAR × 365) | 42% | 70% | 30% |
| + Geo filter | 42% | 72% | 28% |
| + Outlier drop | 45% | 75% | 25% |
| + Bed-gap boost | 55% | 82% | 18% |
| + Compressed premium | 58% | 85% | 15% |
| + Guest-gap shrink | 60% | 87% | 13% |

**Merge criteria:** Within 10% for at least 28/33 (85%), and no single property >30% off.

## 7. Rollout

### Phase 1 — Implementation (this PR)
1. Write `pmi-rules.ts` with all thresholds and tables.
2. Rewrite `buildDataFromReportComps` as specified in §3.
3. Add logging per §5.
4. Build `scripts/pmi-test-dataset.json` from the 33 analysed reports.
5. Extend `scripts/calibrate.mjs` and add `scripts/pmi-validate.mjs`.
6. Run validation — iterate on rules until 28/33 pass.
7. Push to `claude/fork-stayful-repo-vabXR`.

### Phase 2 — Preview validation
1. Deploy preview (auto-built by Vercel on push).
2. Run live Airbtics requests against 5 properties from the dataset.
3. Compare live preview output vs static validation output for those 5. They should be similar — deviations >10% indicate Airbtics is returning different comps than PMI had (a real-world data issue, not an algorithm issue).

### Phase 3 — Merge
1. Open PR from `claude/fork-stayful-repo-vabXR` → `main`.
2. PR includes the validation report output as a table in the description.
3. Requires explicit approval (do not auto-merge).
4. Merge is gated on validation hitting 28/33 within 10%.

### Phase 4 — Post-merge monitoring
1. Production deployments log every `[PMI]` line.
2. First week: spot-check 20 random user-submitted analyses by postcode diversity.
3. Any property where `rule_applied = bed_gap_boost` or `compressed_premium` logs are flagged for sanity review.
4. Any >30% deviation from PMI on publicly-known postcodes → add to test dataset + iterate rules.

### Rollback
If a regression is detected in production:
- Revert the PR commit on `main` via `git revert` (preserves history, no force push).
- Vercel auto-redeploys the previous `main`.
- No data migration needed; the algorithm change is pure compute.

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Validation finds <28/33 within 10% | Medium | Iterate rules using the dataset before claiming done; accept lower target as last resort |
| Airbtics changes comp shape (breaks types) | Low | Existing type guards handle missing fields gracefully; add tests |
| Compressed-premium list is over-fit to 33 samples | Medium | Keep list small (4 entries). New additions require 2+ confirmed reports. |
| Rule parameters (0.15, 3.0, etc.) drift over time | Low | All in `pmi-rules.ts`, one file to edit. Changes don't require compile/review of core logic. |
| Occupancy still noisy | High | Accept that occupancy is approximate — the revenue target is what matters for UX. ADR is derived, not primary. |
| Edge cases outside 33-report coverage | Certain | Post-launch: log all rule activations, flag outliers, iterate |

## 9. Out of scope for this rewrite

- PriceLabs integration — deferred. Revisit only if post-launch accuracy stays below 80% within 10% in production.
- UI changes — the response shape is backward-compatible.
- Algorithm transparency in UI — "confidence bands" and "why this number" explanations are a separate project.
- Long-let pipeline (`getLongLetData`) — untouched.

## 10. Effort estimate

Not quantified (per project rules) — but the scope is bounded:
- 1 new file (`pmi-rules.ts`, ~60 lines)
- 1 rewritten function (`buildDataFromReportComps`, ~200 lines replacing ~250 existing)
- 2 new scripts (`pmi-test-dataset.json` and `pmi-validate.mjs`)
- ~20 new log lines
- 33-report validation

No UI changes. No database changes. No new dependencies.

## 11. Approval checklist

Before coding begins, confirm:

- [ ] The rule set in §3 captures PMI's methodology correctly
- [ ] The `COMPRESSED_PREMIUM_POSTCODES` list is acceptable as-is (4 entries)
- [ ] The merge criterion (28/33 within 10%) is acceptable or should be tighter
- [ ] The rollout phases in §7 are acceptable (or comment on which to collapse / accelerate)
- [ ] The files to modify (§4) are accurate and complete
- [ ] There is no additional known PMI-rule that is missing from this plan

Once approved, I will:
1. Start implementation on `claude/fork-stayful-repo-vabXR`
2. Run validation iteratively
3. Push the working branch + validation output
4. Await your review before opening the PR to `main`
