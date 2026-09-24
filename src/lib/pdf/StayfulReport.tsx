import React from "react";
import { Document } from "@react-pdf/renderer";
import { Page1Overview } from "./pages/Page1Overview";
import { Page2Revenue } from "./pages/Page2Revenue";
import { Page3Comparables } from "./pages/Page3Comparables";
import { Page4LocalRisk } from "./pages/Page4LocalRisk";
import { Page5SetupCosts } from "./pages/Page5SetupCosts";
import { Page6Plan } from "./pages/Page6Plan";
import type { PdfReportData } from "./derive";

/**
 * The property income analysis report — always six pages, in this order:
 *
 *   01 the verdict · 02 the numbers · 03 the market
 *   04 location & risk · 05 setup costs · 06 the plan
 *
 * Page 05 renders unconditionally. When the lead never used the setup
 * calculator, `attachSetupCosts` fills it with typical figures for a property
 * of that size and the page flags itself as indicative — so the page count and
 * the "NN / 06" footers are the same on every copy, whether it was downloaded
 * by the lead, uploaded to Monday or returned by the internal API.
 */
export function StayfulReport({ data }: { data: PdfReportData }) {
  return (
    <Document
      title={`Stayful Property Analysis — ${data.property.address}`}
      author="Stayful"
      subject="Property Income Analysis"
    >
      <Page1Overview data={data} />
      <Page2Revenue data={data} />
      <Page3Comparables data={data} />
      <Page4LocalRisk data={data} />
      <Page5SetupCosts data={data} />
      <Page6Plan data={data} />
    </Document>
  );
}
