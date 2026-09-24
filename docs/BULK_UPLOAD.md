# Bulk property upload

Run a spreadsheet of properties through the analyser, one row at a time, using
the exact same pipeline a lead uses on the public site — and land each PDF on
the matching Monday item.

---

## The spreadsheet

Four columns. Header names are matched loosely (case, spacing and punctuation
are ignored), so `Contact Number` and `Phone` both work.

| Column | Accepted headers | Notes |
|---|---|---|
| Email | `Email`, `Email Address`, `Lead Email` | Used to match the Monday lead |
| Phone | `Phone`, `Contact Number`, `Mobile`, `Telephone` | Also used to match |
| Address | `Address`, `Property Address`, `Full Address` | **Must contain the postcode** |
| Bedrooms | `Bedrooms`, `Beds`, `No. of Bedrooms` | 0–10. `"3 bed"` and `"Studio"` are understood |

`.csv` and `.xlsx` both work. A title row above the header is fine.

**The spreadsheet is the only source of the analysis inputs.** Nothing is read
back off the Monday board — it is used purely to find the item to write to.

Guests are derived as `bedrooms × 2 + 2` (the same rule the public form uses).
Long-let rent is deliberately left blank so PropertyData estimates it, exactly
as when a lead ticks "Not sure".

### Rows that get skipped

Skipped rows cost nothing and are listed in the results CSV so you can fix and
re-upload just those.

- No address, or no postcode in the address (e.g. `"Sharrow Vale"`)
- Two *different* postcodes in one address — ambiguous, never guessed
- Bedrooms missing or outside 0–10
- **No matching Monday lead** — nothing is ever created on the board
- Two rows resolving to the same lead — the second would overwrite the first

---

## Running a batch

1. **Upload** at `/admin/bulk`. This parses the sheet and matches every row
   against Monday. **It spends nothing.**
2. **Review the preview**: which lead each row matched, how it matched, and the
   estimated cost. Anything skipped says why.
3. **Confirm.** Only now does it start spending.
4. **Watch, or don't.** The job runs server-side; closing the tab is fine.
5. **Download the results CSV** when it finishes.

100 rows takes roughly 10–25 minutes.

### Batch size

Cap is 100 rows per upload (`BULK_MAX_ROWS`). A larger backlog runs as several
sequential batches — that is the intended shape, not a workaround. Each batch
keeps its own preview and its own ~£50 spend decision rather than one ~£700
commit, and a bad batch costs a tenth as much to discover and redo. Queued
batches drain oldest-first.

---

## What gets written to Monday

Exactly what a live single-property run writes:

| Column | Value |
|---|---|
| Deal Analyser (`files__1`) | The generated PDF |
| Stayful Net Analyser | Short-let net annual |
| Long term let | Long-let annual (from the PropertyData estimate) |
| STR Profit | True uplift |
| Recommendation | Short-Let / Long-Let |
| Qualified | Qualification band |
| Status | Set to **Abandoned** when the lead is unqualified |

Two things worth being deliberate about:

- **Long term let gets overwritten** on every matched lead, including rows where
  someone previously typed a real figure by hand. That follows from leaving the
  rent blank so PropertyData estimates it.
- **Unqualified leads are moved to Abandoned**, same as a live run.

Each row's prior column values are snapshotted into
`bulk_job_rows.monday_prev_values` before writing, so a bad run can be rolled
back by script. Monday itself has no undo.

---

## Safety

### The gate

A failed upstream call does **not** surface as an error. `getShortLetData`
swallows everything — a 429, exhausted credit, a 500 — and returns either zero
or `generateMarketEstimate()`, a synthetic figure that looks entirely plausible.
The analysis then "succeeds", and a zero or synthetic revenue drives the lead to
`unqualified` → **Abandoned**.

For one lead that is unfortunate. For a 100-row batch during an outage it
silently abandons 100 real leads on fabricated data, every row reporting
success.

So bulk refuses to write to the CRM unless the data is demonstrably real:
revenue above zero, comparables actually found, and quality above `low`. Gated
rows land as `failed` with `no_str_data` and can be re-run. **Three consecutive
gated rows pause the whole job.**

The live single-property path passes no gate and is unaffected.

### Spend controls

- Preview spends nothing and shows the estimate before you commit.
- `BULK_MAX_JOB_COST_GBP` refuses an over-budget job at preview *and* at start.
- `BULK_MAX_INFLIGHT` caps rows running at once across all workers — a
  spend-rate throttle, not just a concurrency limit.
- A row is claimed with `FOR UPDATE SKIP LOCKED`, so it can never be processed
  (or paid for) twice.
- `attempts` increments at claim, so a row that kills its worker burns
  `max_attempts` and stops rather than looping on credit.
- Bulk never increments a lead's free-analysis counter.

---

## Testing without spending anything

Unsetting the API keys does **not** give a free run: `geocodePostcode` throws
without `GOOGLE_PLACES_API_KEY`, so every row dies at the first step and none of
the job machinery is exercised. Use the flags instead:

```
PIPELINE_FAKE=1     # deterministic analysis, no external calls
MONDAY_DRY_RUN=1    # log the exact column payload, write nothing
```

Together they rehearse a whole job against the **real** Monday board — matching
included, the part most worth testing on real data — while mutating nothing.

Also useful:

```
npm test                        # 173 unit tests
./scripts/verify-claim-rpc.sh   # proves the claim RPC under real concurrency
```

`verify-claim-rpc.sh` stands up a throwaway Postgres and asserts that 8
concurrent workers claiming 40 rows produce zero double-claims, that stale
claims are reclaimed, that exhausted attempts are not, and that queued batches
drain oldest-first.

---

## Rolling it out

Do it in stages. `BULK_MAX_ROWS` exists so you can.

| Stage | What | Cost |
|---|---|---|
| 0 | 1 row, real APIs, `MONDAY_DRY_RUN=1`. Diff the logged payload against a live single-property run of the same property. | ~£0.50 |
| 1 | 1 row, real write, pointed at a **dummy lead** you create (or a duplicate board via `MONDAY_BOARD_ID`). | ~£0.50 |
| 2 | 5 real rows, watched live. Check the Abandoned transitions are ones you actually want. | ~£2.50 |
| 3 | Full 100. | ~£50 |

Reconcile after each: succeeded row count vs `analyser_reports` where
`source = 'bulk'`, and spot-check a few Monday items for a PDF dated today.

---

## Setup

1. Apply the migrations in `supabase/migrations/` (creates `bulk_jobs`,
   `bulk_job_rows`, the claim function, `admin_users`, `admin_password_resets`,
   and enables RLS).
2. Set `ADMIN_EMAILS`, `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASHES`
   (`node scripts/hash-admin-password.mjs <email>`), `CRON_SECRET` and
   `INTERNAL_API_SECRET`. Without the first two, the whole admin area 404s.
3. Optionally set `RESEND_API_KEY` and `ADMIN_EMAIL_FROM` to enable
   "Forgot password?". Everything else works without them.
4. Deploy. `vercel.json` registers the worker cron (production only).

### Running on Vercel Hobby

Hobby imposes two limits: cron can only run **daily**, and functions are cut off
at **60 seconds**. The build is designed around both, so no upgrade is required.

**Why 60s was a problem, and why it isn't now.** A single row is typically
20–30s. What pushed an invocation past 60s was running three rows concurrently
inside one function — they contend for CPU, especially the PDF render. A row
killed at the ceiling has *already paid* for its Airbtics report, so the retry
used to buy a second one: ~£1 for a row that might still fail.

Four things address it:

1. **One row per invocation.** `BULK_ROW_CONCURRENCY` defaults to `1`, which
   keeps every invocation well inside the ceiling.
2. **Chain-ahead.** The worker kicks its successor *immediately after claiming*,
   before doing the work — so an invocation killed mid-row cannot take the chain
   down with it. Overlap is safe: claiming is atomic and the inflight cap holds.
3. **Resume on view.** The progress page polls every 5s; if a job is running with
   work left and nothing in flight, the chain has dropped and is restarted.
4. **Durable Airbtics report cache.** Report ids now persist in Postgres rather
   than in a Map that dies with the invocation. A retried row re-reads the report
   it already paid for and finishes in seconds.

Together, the worst case stops being "£1 spent, row failed" and becomes "row
took two attempts, cost 50p, succeeded". The daily cron remains the final
backstop.

The report cache is worth having on any plan — repeated postcode + bedroom
combinations stop re-buying reports, which is real money on a large backlog.

**If you later move to Pro**, two changes get the higher-throughput shape:

- `vercel.json` → `"schedule": "* * * * *"`
- `src/app/api/admin/bulk/worker/route.ts` → `export const maxDuration = 300`,
  then set `BULK_WORKER_BUDGET_MS=280000` and `BULK_ROW_CONCURRENCY=3`

You can also point an external scheduler (n8n, say) at
`GET /api/admin/bulk/worker` with the `x-internal-secret` header for a
minute-by-minute heartbeat without upgrading.

---

## Known issue, out of scope

`/api/get-report` reads the report PDF from column `file_mm1daxvv`, which is
**"Call recordings"** — not `files__1` ("Deal Analyser") where the PDF is
actually written. The `/report` page therefore returns the wrong file. Not
touched here; worth a separate fix.

---

## Signing in

The admin area lives at `/admin/bulk`, reachable from the **Staff login** link in
the footer of the main calculator page. There is no other link to it, and it is
`noindex`'d and disallowed in `robots.txt`.

Sign in with your `@stayful.co.uk` address and your password. **Show** next to
the password box reveals what you're typing, for when a long password won't go
in right.

### Forgot password

Click **Forgot password?** on the sign-in page with your email filled in. A
one-time link arrives by email; it lasts an hour, works once, and signs you in
as soon as you've set the new password.

A few deliberate behaviours worth knowing, so they don't look like faults:

- **The confirmation message is always the same** — "If that address has an
  admin account, a reset link is on its way" — whether or not the address is an
  admin. Otherwise the page would tell a stranger who has access. So a typo'd
  address looks exactly like a successful request; if no email arrives, check
  the spelling first.
- **Requesting a new link kills the previous one.** If you click twice, use the
  newest email.
- **Five requests per 15 minutes**, after which they're quietly ignored (same
  message, no email). Wait it out.

Nothing sends unless `RESEND_API_KEY` and `ADMIN_EMAIL_FROM` are set — see
`.env.example`. If they're missing, the request is still accepted and the server
logs `reset requested but email is not configured`, so **check the Vercel logs
before assuming the link is lost in a spam folder.**

The first reset also migrates you off the env var: from then on your hash lives
in the `admin_users` table, and `ADMIN_PASSWORD_HASHES` is ignored for your
address.

### Setting a password without email

Still available, and the way to bootstrap a new admin before they have a
password at all:

```bash
node scripts/hash-admin-password.mjs zac@stayful.co.uk
```

It prompts twice (hidden), then prints a line like:

```
zac@stayful.co.uk:<long hash>:<salt>
```

Paste that as the whole value of `ADMIN_PASSWORD_HASHES` in Vercel and redeploy.
To give someone else access, add their address to `ADMIN_EMAILS` and append
their entry to `ADMIN_PASSWORD_HASHES`, comma-separated:

```
zac@stayful.co.uk:<hash>:<salt>,someone@stayful.co.uk:<hash>:<salt>
```

Note this only works for an address that has **not** reset its password since —
once a row exists in `admin_users`, that hash wins and the env var is ignored
for that address. Use **Forgot password?** instead, or clear the row.

Removing an address from `ADMIN_EMAILS` revokes it immediately, including any
session already signed in and any unredeemed reset link — the allowlist is
re-checked on every request and again when a reset link is redeemed.
