import type { AnalysisResult } from "@/lib/types";
import type { RawSetupInput } from "@/lib/pdf/derive";
import { renderReportFromResult } from "@/lib/pdf/render";

export const runtime = "nodejs";

interface PdfRequestBody extends AnalysisResult {
  setup?: RawSetupInput;
  /** Lead email, printed as "PREPARED FOR" on page 01. */
  email?: string;
}

export async function POST(request: Request) {
  let body: PdfRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!body?.property?.address || !body?.financials) {
    return new Response("Missing required analysis data", { status: 400 });
  }

  const { buffer, filename } = await renderReportFromResult(body, {
    preparedFor: body.email,
    setup: body.setup,
  });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
