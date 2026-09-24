# The guaranteed rent model

What Stayful will pay a landlord per month to take their property on, and
whether that deal is worth doing.

The whole model lives in `src/lib/guaranteedRent.ts`. It is pure arithmetic —
no I/O, no dates, no randomness — and `src/lib/guaranteedRent.test.ts` is the
only thing standing between a bad constant and a commercial commitment sent to
a landlord, so treat a failure there as blocking.

## Where the numbers come from

Nothing here was invented. `src/lib/analysis.ts` already deducted

| | |
|---|---|
| Booking platform | 15% |
| Management | 15% |
| VAT on management | 3% |
| Cleaning and laundry | 18% |
| Maintenance | 5% |

leaving `TRUE_NET_PCT = 0.44`, and already carried `(£450 bills + £42 software)
× 12 = £5,904` a year of fixed costs. That £5,904 is the **4-bed** figure in the
table below. All this file adds is scaling the bills component by bedroom count
and leaving the software cost flat, so a 4-bed reconciles exactly with the
short-let recommendation the same report makes.

### Fixed costs, by bedrooms

| Beds | Bills/mo | Software/mo | Annual |
|---|---|---|---|
| 1 | £300 | £42 | £4,104 |
| 2 | £350 | £42 | £4,704 |
| 3 | £400 | £42 | £5,304 |
| 4 | £450 | £42 | £5,904 |
| 5+ | £500 | £42 | £6,504 |

A studio is charged at the 1-bed rate — it is a real, known, small property, not
an unknown. Anything above 5 beds is charged at the 5-bed rate. Unknown bedrooms
fall back to the 4-bed figure and the assessment carries `bedroomsAssumed: true`,
which reaches the CSV export and the one-line reason.

## The calculation

```
strNet               = grossSTR × 0.44
annualRent           = desiredRentMonthly × 12
annualProfit         = strNet − annualRent − fixedCosts
requiredGross        = (annualRent + fixedCosts + 8,000) ÷ 0.44
gap                  = grossSTR − requiredGross
revenueMultiple      = grossSTR ÷ annualRent
maxAffordableMonthly = ⌊(strNet − fixedCosts − 8,000) ÷ 12⌋
offerMonthly         = max(0, min(desiredRentMonthly, maxAffordableMonthly))
```

Bands, on `annualProfit`: **£8,000+** QUALIFIED · **£4,000–£7,999** MEDIUM ·
**under £4,000** UNQUALIFIED.

Money is rounded to whole pounds *before* banding, so a report never shows
£7,999 next to the word QUALIFIED. The offer is **floored**, not rounded:
rounding up could commit us to a rent we cannot cover, and being a pound under
target is cheaper than being a pound over.

### Why the band is computed on the ask, not on the offer

The offer is capped at whatever still leaves £8,000. So every property that
reaches the cap would report a profit of exactly £8,000 and read QUALIFIED —
the band would carry no information at all. Banding on the rent the landlord
*asked for* is the actual screening question: can we meet what they want and
still make money? It is also what makes the gap, and the shortfall the CRM
shows, mean anything.

### Insufficient data

When short-let revenue cannot be established the band is `INSUFFICIENT_DATA`,
no figures are computed and nothing is written to the deal columns. The test for
"can this revenue be trusted" is `hasUsableShortLetData` in
`src/lib/bulk/gate.ts` — the same predicate the bulk side-effect gate uses,
deliberately, so there is one definition of usable data rather than two
opinions. It rejects zero revenue, zero comparables (the tell-tale of the
synthetic `generateMarketEstimate` fallback) and a `low` quality grade.

Confidence is the analyser's own `dataQuality.level`, translated once in
`confidenceFromDataQuality` (the analyser says `moderate`, the deal model says
`medium`).

## What the landlord sees, and what stays internal

| | Landlord (screen + PDF) | Internal (Monday + bulk CSV) |
|---|---|---|
| Offer, annual equivalent | yes | yes |
| Their asking rent, and the gap to it | yes | yes |
| Short-let income potential | yes | yes |
| Band | **no** | yes |
| Required gross, gap, revenue multiple | **no** | yes |
| Confidence, estimated-vs-confirmed flags | **no** | yes |

`UNQUALIFIED` is a note to ourselves. A landlord reading it on their own report
is a lost lead, so the band never renders.

One related judgement, in `Page1Overview.tsx`: the report compares the **ask
against the offer**, never the offer against the managed short-let net. Those
two are not comparable — the short-let figure is gross less platform,
management and cleaning, with the landlord still carrying the bills, the voids,
the furnishing and the work — and drawing them side by side produces a large
negative number that argues against the offer the page exists to make. On the
Manchester fixture it read `-£17,909 / year`.

## Monday

Board **18396542480** ("Guaranteed rent leads"). Defaults are in
`src/lib/apis/monday.ts`; every id is env-overridable.

| Purpose | Column |
|---|---|
| Email (matching) | `text_mkztseha` |
| Address (matching, carries the postcode) | `text_mkzxhyv9` |
| Phone (matching; bulk only, the form does not ask) | `text_mkztq5xb` |
| PDF report | `file_mkzt6hf1` |
| Status | `status` |
| Desired rent | `text_mkztg3z9` |
| Rent offered | `text_mkzxkfns` |
| Profit after guaranteed rent (monthly) | `text_mkztftwn` |
| Analyser Uses | `numeric_mm7gg2hy` |

Five things worth knowing before changing any of it:

1. **Nothing creates items.** A separate workflow puts the lead on the board
   when they enquire. The calculator finds that item and writes to it; a lead it
   cannot find is logged and skipped. Because the analysis and that workflow are
   racing, `persistAndSync` retries the lookup twice (2s, 4s) before giving up —
   without it, losing the race silently discards the PDF.
2. **Status is written by label text**, not by numeric index. On this board a
   label's `id` and its `index` disagree — "Qualified" is id 1, index 2 — and
   Monday's status payload wants the id. Verified against the live board: writing
   `{"label": "Not qualified"}` stores `{"index": 2}`, which is the id. Writing
   the settings `index` of 1 would have set the lead to *Qualified*.
3. **Status is only overwritten when the lead is untriaged** (blank or "Yet to
   qualify"). Someone already at "Viewing" or "Secured / Sold" has been worked by
   a human and must not be dragged back down the pipeline by a re-run.
4. **The landlord's stated rent is never overwritten with an estimate.** Desired
   rent is only written when they told us themselves.
5. **Money is written as `£1200.00`**, matching the leads already on the board.
   The board has a formula column doing `{Desired rent} - {Rent offered}`, and
   Monday evaluates formula columns in the UI only — they always read back empty
   over the API, so whether it parses the `£` could not be verified from here. If
   it shows blank in the board view, dropping the prefix and the pence from
   `gbpColumnValue` is the whole fix.

## Bulk screening

The admin uploader (`/admin/bulk`) takes an optional **Desired rent** column —
`Asking Rent`, `Monthly Rent`, `Rent PCM` and `Guaranteed Rent` all match, and
`£1,200`, `1200 pcm` and `1,200.50` all parse. A blank cell is not an error: the
assessment falls back to the estimated long-let rent and marks it
`desired_rent_source: estimated`.

The results CSV carries the full screening — band, confidence, both
estimated-vs-confirmed flags, STR net, fixed costs, annual and monthly profit,
required gross, gap, revenue multiple, max affordable rent, rent offered and the
one-line reason — ranked qualified first by annual profit, then medium, then
unqualified, then rows that produced no figures. Failures are never dropped; a
near miss is only visible if the row that missed is still in the file.

Those columns are **recomputed** in the export rather than stored. The model is
pure and every input is already on the row, so this reproduces exactly what was
written to Monday without eight more database columns to keep in step.

## Verifying a change

```bash
npm test                                   # the model's own tests must pass
npx tsx scripts/render-pdf-sample.mts      # 19 cases, all must be exactly 6 pages
PIPELINE_FAKE=1 MONDAY_DRY_RUN=1 npm run dev
```

`PIPELINE_FAKE=1` also produces an assessment (see `src/lib/bulk/fake.ts`), so a
dry run exercises the guaranteed-rent write rather than skipping it. Pair it
with `MONDAY_DRY_RUN=1` to rehearse against the real board while mutating
nothing.

The sample renderer's page count is the overflow canary: react-pdf pushes
overflowing content onto a new page, so a case that reports 7 pages is a layout
regression even when it looks fine.
