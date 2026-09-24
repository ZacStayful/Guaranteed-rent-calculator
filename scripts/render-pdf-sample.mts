/**
 * Render the report from fixtures so it can be eyeballed against the design
 * spec, and assert the invariants that only show up at layout time.
 *
 * Run with:  npx tsx scripts/render-pdf-sample.mts [outDir]
 *
 * Uses `tsx`, not the repo's test resolver — that one only handles `.ts` and
 * the report is `.tsx`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderReportFromResult } from "@/lib/pdf/render";
import { type RawSetupInput } from "@/lib/pdf/derive";
import { DEMO_MANCHESTER, DEMO_RESULT } from "@/lib/demo-data";
import { assessRisk } from "@/lib/analysis";
import { buildDefaultLineItems } from "@/components/SetupCalculator/lineItemDefaults";
import type { AnalysisResult } from "@/lib/types";

const outDir = process.argv[2] ?? path.join(process.cwd(), ".pdf-preview");
mkdirSync(outDir, { recursive: true });

/** Count pages without a PDF parser: every page is one /Type /Page object. */
function countPages(buf: Buffer): number {
  const matches = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

/**
 * The demo fixtures hardcode `overallScore` on a 0–100 scale, but the engine
 * emits 1–10. Re-run the real assessor so the risk gauge is exercised with the
 * values production actually produces.
 */
function withEngineRisk(r: AnalysisResult): AnalysisResult {
  return { ...r, risk: assessRisk(r.shortLet, r.longLet, r.demandDrivers, r.nearbyEvents) };
}

interface Case {
  name: string;
  result: AnalysisResult;
  setup?: RawSetupInput;
  email?: string;
}

const base = withEngineRisk(DEMO_MANCHESTER);

const cases: Case[] = [
  { name: "01-manchester-default-setup", result: base, email: "lead@email.com" },
  {
    name: "02-manchester-lead-setup-fully",
    result: base,
    email: "lead@email.com",
    setup: { furnishing: "fully", bedrooms: 2, items: buildDefaultLineItems("fully", 2) },
  },
  {
    name: "03-part-furnished-16-rows",
    result: base,
    setup: { furnishing: "part", bedrooms: 2, items: buildDefaultLineItems("part", 2) },
  },
  {
    name: "04-unfurnished-4bed-20-rows",
    result: { ...base, property: { ...base.property, bedrooms: 4, guests: 8 } },
    setup: { furnishing: "unfurnished", bedrooms: 4, items: buildDefaultLineItems("unfurnished", 4) },
  },
  { name: "05-demo-result", result: withEngineRisk(DEMO_RESULT), email: "second@email.com" },
  // ── Degenerate inputs ──
  {
    name: "06-no-comparables",
    result: { ...base, shortLet: { ...base.shortLet, comparables: [] } },
  },
  { name: "07-no-valuation", result: { ...base, propertyValuation: null } },
  {
    name: "08-no-city-in-address",
    result: { ...base, property: { ...base.property, address: "803 Eastbank Tower" } },
  },
  {
    name: "09-very-long-address",
    result: {
      ...base,
      property: {
        ...base.property,
        address: "Flat 12, The Old Biscuit Factory, 221 Great Ancoats Street, Manchester",
      },
    },
  },
  {
    name: "10-long-let-recommended",
    result: {
      ...base,
      financials: { ...base.financials, shortLetNetAnnual: 7000, annualDifference: -5000, monthlyDifference: -417 },
      // The fixtures carry no recommendation, so set the whole block — this
      // case exists to exercise the long-let variants of pages 01 and 06.
      recommendation: {
        recommendation: "LONG_LET" as const,
        upliftPct: -0.35,
        trueSTRNet: 7000,
        trueLLNet: 12452,
        longLetMonthly: 1281,
        longLetSource: "propertydata_fallback" as const,
      },
    },
  },
  {
    name: "11-many-comparables",
    result: {
      ...base,
      shortLet: {
        ...base.shortLet,
        // 20 comps — more than the table's 12 rows.
        comparables: Array.from({ length: 20 }, (_, i) => ({
          ...base.shortLet.comparables[i % base.shortLet.comparables.length],
          title: `Comparable listing number ${i + 1} with a deliberately long title`,
          distance: 0.1 + i * 0.07,
        })),
      },
    },
  },
  {
    name: "12-stress-everything",
    result: {
      ...base,
      property: {
        ...base.property,
        address: "Penthouse Apartment 1204, The Old Biscuit Factory, 221 Great Ancoats Street, Manchester",
        bedrooms: 5,
        guests: 12,
      },
      shortLet: {
        ...base.shortLet,
        comparables: Array.from({ length: 30 }, (_, i) => ({
          ...base.shortLet.comparables[i % base.shortLet.comparables.length],
          title: `A deliberately enormous listing title number ${i + 1} that goes on and on past any sane column width`,
          distance: 0.05 + i * 0.05,
        })),
      },
    },
    email: "a.very.long.lead.email.address@somewhat-long-domain-name.co.uk",
    setup: { furnishing: "unfurnished", bedrooms: 5, items: buildDefaultLineItems("unfurnished", 5) },
  },
  {
    name: "13-zero-revenue",
    result: {
      ...base,
      shortLet: {
        ...base.shortLet,
        annualRevenue: 0,
        monthlyRevenue: Array.from({ length: 12 }, () => 0) as typeof base.shortLet.monthlyRevenue,
        averageDailyRate: 0,
      },
      financials: { ...base.financials, shortLetGrossAnnual: 0, shortLetNetAnnual: 0 },
    },
  },
];

const GLYPHS = ["£", "·", "—", "≈", "÷", "→", "−", "–"];

let failures = 0;

for (const c of cases) {
  const started = Date.now();
  const { buffer } = await renderReportFromResult(c.result, {
    preparedFor: c.email,
    setup: c.setup,
  });
  const ms = Date.now() - started;
  const pages = countPages(buffer);
  const file = path.join(outDir, `${c.name}.pdf`);
  writeFileSync(file, buffer);

  const ok = pages === 6;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.name.padEnd(32)} ${String(pages).padStart(2)} pages  ` +
      `${String(ms).padStart(4)}ms  ${(buffer.length / 1024).toFixed(0).padStart(4)} KB` +
      (ok ? "" : "   ← expected exactly 6 pages"),
  );
}

console.log("\nfonts: registered (a missing file would have thrown above)");
console.log(`glyphs to verify in the text layer: ${GLYPHS.join(" ")}`);
console.log(`output: ${outDir}`);

if (failures > 0) {
  console.error(`\n${failures} case(s) did not render exactly 6 pages.`);
  process.exit(1);
}
