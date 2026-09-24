import React from "react";
import { renderToBuffer, Font } from "@react-pdf/renderer";
import { registerPdfFonts } from "./theme";
import { StayfulReport } from "./StayfulReport";
import { attachSetupCosts, deriveReportData, sanitiseAddressForFilename } from "./derive";
import type { PdfReportData, RawSetupInput } from "./derive";
import type { AnalysisResult } from "@/lib/types";

/**
 * The one place the report is rendered.
 *
 * Fonts are registered here, against the `Font` from the same
 * `@react-pdf/renderer` import that `renderToBuffer` comes from. That matters:
 * the package can be instantiated more than once in a process and each
 * instance has its own font store, so registering from a component or a
 * config module can silently target the wrong one and fail at layout with
 * "Font family not registered".
 *
 * Routing every caller through here also keeps the four render paths — the
 * lead's download, the Monday upload, the internal API and the bulk worker —
 * producing byte-for-byte the same document for the same input.
 */
export async function renderReportBuffer(data: PdfReportData): Promise<Buffer> {
  registerPdfFonts(Font);
  return (renderToBuffer as (e: unknown) => Promise<Buffer>)(
    <StayfulReport data={data} />,
  );
}

/**
 * Derive, attach setup costs and render in one step — what every caller that
 * starts from a raw `AnalysisResult` wants.
 *
 * @param preparedFor Lead email for the page-01 "PREPARED FOR" line.
 * @param setup Setup-calculator snapshot, when the lead filled one in.
 *   Without it the report falls back to typical figures for the property size
 *   and page 05 says so, so the document is six pages either way.
 */
export async function renderReportFromResult(
  result: AnalysisResult,
  opts: { preparedFor?: string; setup?: RawSetupInput | null } = {},
): Promise<{ buffer: Buffer; filename: string; data: PdfReportData }> {
  const data = attachSetupCosts(
    deriveReportData(result, opts.preparedFor),
    opts.setup,
  );
  const buffer = await renderReportBuffer(data);
  return {
    buffer,
    filename: `Stayful_Property_Analysis_${sanitiseAddressForFilename(result.property.address)}.pdf`,
    data,
  };
}
