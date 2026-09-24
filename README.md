# Guaranteed Rent Calculator

A landlord tells us the rent they want guaranteed. We tell them whether we can
meet it, what we will pay, and what the property could earn as a short-term let.

Forked from the Stayful STR estimate software: same Next.js app, same Airbtics
revenue engine, same six-page PDF. What changed is the question it answers.

## How it works

1. The landlord enters their property, their email, and the monthly rent they
   want guaranteed.
2. The analyser estimates short-term-let revenue from real Airbnb comparables
   (Airbtics), plus long-let rent and a sale valuation (PropertyData), local
   demand drivers (Google Places) and nearby events (Ticketmaster).
3. `src/lib/guaranteedRent.ts` prices the deal: what we can pay while still
   clearing £8,000 a year, and whether their ask fits inside it.
4. They see the offer and their short-let income potential on screen and in a
   PDF.
5. The offer, the monthly profit and the band are written to the Monday lead,
   and the PDF is attached to it.

The model, the Monday column map and the reasoning behind both are documented in
**[docs/GUARANTEED_RENT.md](docs/GUARANTEED_RENT.md)** — read that before
changing any figure.

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

Without API keys the analyser cannot run: `geocodePostcode` throws without
`GOOGLE_PLACES_API_KEY`. To work on anything else, use the dry-run flags:

```bash
PIPELINE_FAKE=1 MONDAY_DRY_RUN=1 npm run dev
```

`PIPELINE_FAKE=1` returns a deterministic analysis and calls no external API.
`MONDAY_DRY_RUN=1` logs the exact column payload instead of writing it, so you
can rehearse against the real board while mutating nothing.

## Checks

```bash
npm test                               # node --test, ~284 tests
npm run lint
npm run build
npx tsx scripts/render-pdf-sample.mts  # 19 PDF cases, all must be exactly 6 pages
```

The PDF sample's page count is the overflow canary — react-pdf pushes
overflowing content onto a new page, so a seventh page is a layout regression.

## Other docs

- [docs/GUARANTEED_RENT.md](docs/GUARANTEED_RENT.md) — the deal model and the CRM writes
- [docs/BULK_UPLOAD.md](docs/BULK_UPLOAD.md) — screening a spreadsheet of leads in one run
- [docs/INTERNAL_ANALYSE.md](docs/INTERNAL_ANALYSE.md) — the `/api/internal/analyse` contract
- [AGENTS.md](AGENTS.md) — this is Next.js 16; check `node_modules/next/dist/docs/` before assuming an API
