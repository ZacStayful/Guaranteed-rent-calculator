# `POST /api/internal/analyse`

Runs one property through the analyser and returns the figures **and** the
rendered PDF as JSON. Built for the Stayful lead database, which calls it once
per customer-owned lead when the customer has paid to have their own imported
leads analysed.

```bash
curl -X POST https://<host>/api/internal/analyse \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  -d '{"address":"12 Bourneside Road, Bristol BS4 3AA","postcode":"BS4 3AA","bedrooms":3}'
```

## Why it exists rather than reusing the bulk upload

`/api/admin/bulk` (see `BULK_UPLOAD.md`) matches every row against an existing
item on the Monday leads board and its purpose is writing results **back** to
that board. The leads this endpoint serves are private to one customer, have no
Monday item, and must never reach the board. `runAnalysis()` underneath the bulk
worker is a plain function taking exactly the knobs needed, so this wraps that
instead of bending the batch machinery around a different job.

## How the Monday write is prevented

Not by a flag — by omission. `persistAndSync()` returns early at

```ts
const hasSignal = Boolean(opts.mondayItemId || opts.email || opts.phone);
if (!hasSignal) return outcome;
```

This route accepts **no email and no phone**, and passes `mondayItemId: null`,
so that branch is unreachable. The request body is rebuilt field by field rather
than forwarded, so a caller cannot reintroduce a signal by sending one.

That omission is also the privacy decision: the landlord's name, email and phone
never leave the lead database. Only the property does.

The `analyser_reports` insert happens **before** that early return, so the run is
still persisted and attributable — `source: 'lead_db'`.

## Why no `sideEffectGate`

A gate exists to veto a CRM write, and there is none here. The same verdict is
still computed — `bulkSideEffectGate()` is called by the response shaper — but it
is **reported** as `quality_ok` rather than used to suppress anything. The caller
needs to know, because it is about to charge somebody for these figures, and it
refunds a row that comes back `quality_ok: false`.

## Request

| Field | Required | Notes |
|---|---|---|
| `address` | yes | Full property address |
| `postcode` | yes | ≥3 chars; upper-cased by the validator |
| `bedrooms` | yes | 0–10 |
| `guests` | no | Defaults to `defaultGuests(bedrooms)` = `bedrooms*2+2`, clamped 1–16 |
| `bathrooms`, `propertyType` | no | Passed through to the same validator the public form uses |
| `request_id` | no | Echoed back; log correlation only |
| `include_pdf` | no | Default true |

Validation is `normaliseAnalysisInput()` — the same function the public form and
the bulk worker use, so a lead analysed this way is analysed identically.

## Response

```jsonc
{
  "ok": true,
  "request_id": "…",
  "quality_ok": true,          // false ⇒ the figures are synthetic; do not publish
  "quality_reason": null,
  "figures": {
    "gross_annual_income": 40710,
    "net_annual_income": 21169,
    "long_let_annual_income": 16104,
    "avg_nightly_rate": 178,
    "occupancy_rate": 63,      // WHOLE PERCENT — see below
    "platform_fee_pct": 15,
    "cleaning_fee_pct": 18,
    "management_fee_annual": 6107,
    "monthly_revenue_profile": [ /* exactly 12, January first, net at our fee */ ]
  },
  "pdf": { "base64": "JVBERi0…", "bytes": 20432, "filename": "Stayful_Property_Analysis_….pdf" },
  "diagnostics": { "comparables_found": 12, "data_quality_level": "high", "report_id": null, "duration_ms": 999 }
}
```

Every figure comes from `deriveReportData(result)` — the same derivation the PDF
renders from — so the JSON and the PDF in one response can never state different
numbers.

### ⚠️ `occupancy_rate` is a whole percent

This codebase carries occupancy as a **fraction** (`ShortLetData.occupancyRate`
is 0–1). The lead database stores it as a **whole percent**, and its CHECK
constraint is `>= 0 and <= 100` — which `0.63` passes silently. A missed
multiplication would write a plausible wrong number that no constraint catches
and nobody would see.

The conversion therefore lives in exactly one place, `toOccupancyPercent()` in
`src/lib/internal/analyseResponse.ts`, with unit tests that assert both
directions: `0.63 → 63`, and `63 → null` (a value already in percent is refused
rather than passed through, because tolerating both units is how a column ends
up holding both — as `analyser_reports.occupancy` already does).

`avg_nightly_rate` and `occupancy_rate` are stored **as a pair or not at all**: a
nightly rate with no occupancy is a number the reader cannot check.

`management_fee_annual` is **informational**. The lead database derives its own
fee as `gross / 6.667` and must keep doing so; the two differ by up to £1 because
one divides where the other multiplies, and each app words its report its own
way. It is sent so a seam test can assert they still agree within £1 — the
tripwire for "the analyser changed what it means by gross".

## Errors

| Status | `error_code` | Retry? |
|---|---|---|
| 400 | `invalid_input` | No — the message is the validator's verbatim wording, safe to show a customer |
| 401 | `unauthorized` | No — alert |
| 404 | — | No — `INTERNAL_API_SECRET` is unset on the analyser; the endpoint is disabled, not missing |
| 429 | `busy` | Yes |
| 500 | `internal` | Yes |

A **row-level** failure is a `200` with `ok: false` and a `stage` / `error_code`,
mirroring `runAnalysis()`, which never throws. That distinction matters to the
caller: "this property failed" is terminal, "the call failed" is retryable.

A PDF render failure returns `ok: true` with `pdf: null` and `pdf_error` set. The
figures are the half being paid for and they publish regardless — the same
"they fail alone" rule the rest of the pipeline follows.

## Verification performed

Against a dev server with `PIPELINE_FAKE=1` and `MONDAY_DRY_RUN=1`:

- no header → **401**; wrong secret → **401**; `INTERNAL_API_SECRET` unset →
  **404** with `{"error":"Not found"}`; missing postcode → **400** with
  `"A valid UK postcode is required."`
- a good request → 200, 27,832 bytes of JSON, `occupancy_rate: 63` (an integer),
  twelve monthly values, `gross 40710`
- the base64 PDF decoded to **20,432 bytes, byte-identical to the reported
  length**, beginning `%PDF-1.3` and opening as a valid 5-page document
- `gross / 6.667` = 6106 against `management_fee_annual` 6107 — within £1
- `rate × 365 × occupancy/100` = 40,931 against gross 40,710 — 0.54% drift, well
  inside the 2% the receiving app uses to decide its wording
- **nothing was written to Monday**: not one Monday line in the server log
