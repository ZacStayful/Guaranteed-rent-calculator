// ─── "Access your report" lookup ──────────────────────────────────
//
// Backs /report: a landlord gives their email and gets a link to the PDF the
// analyser already uploaded to their Monday item.
//
// Three things were fixed when this was forked from the STR analyser, where
// they were live bugs:
//   • it read the file from a different column than uploads are written to, so
//     it could never find a report the analyser had produced;
//   • it interpolated the submitted email straight into the GraphQL string, so
//     a quote in the input rewrote the query;
//   • it read process.env.MONDAY_API_KEY! at module scope, which asserts a
//     value that may not be there.
// It now shares the board and column configuration with the rest of the
// integration rather than keeping a second, drifting copy.

import { NextRequest, NextResponse } from "next/server";
import { reportLookupConfig } from "@/lib/apis/monday";

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

const LOOKUP_QUERY = `
  query ($boardId: ID!, $emailColumnId: ID!, $email: String!, $cols: [String!]) {
    boards(ids: [$boardId]) {
      items_page(
        limit: 10,
        query_params: {
          rules: [{ column_id: $emailColumnId, compare_value: [$email], operator: contains_text }]
        }
      ) {
        items {
          id
          name
          column_values(ids: $cols) { id value text }
        }
      }
    }
  }
`;

interface MondayColumnValue {
  id: string;
  value: string | null;
  text: string | null;
}

export async function POST(req: NextRequest) {
  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const cfg = reportLookupConfig();
  if (!cfg) {
    console.error("[get-report] Monday credential not configured");
    return NextResponse.json({ error: "Report lookup is unavailable right now." }, { status: 503 });
  }

  try {
    const mondayRes = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
        Authorization: cfg.token,
      },
      body: JSON.stringify({
        query: LOOKUP_QUERY,
        variables: {
          boardId: cfg.boardId,
          emailColumnId: cfg.emailColumnId,
          email: email.toLowerCase().trim(),
          cols: [cfg.fileColumnId, cfg.emailColumnId],
        },
      }),
      cache: "no-store",
    });

    const mondayData = await mondayRes.json();
    if (mondayData?.errors) {
      console.error("[get-report] Monday returned errors:", mondayData.errors);
      return NextResponse.json({ error: "Failed to fetch report. Please try again." }, { status: 502 });
    }

    const items = mondayData?.data?.boards?.[0]?.items_page?.items ?? [];
    if (items.length === 0) {
      return NextResponse.json({ error: "No lead found with that email address." }, { status: 404 });
    }

    const item = items[0];
    const fileColumn = (item.column_values as MondayColumnValue[]).find(
      (c) => c.id === cfg.fileColumnId,
    );

    if (!fileColumn?.value) {
      return NextResponse.json(
        { error: "No report has been generated for this lead yet. Please contact Stayful." },
        { status: 404 },
      );
    }

    let fileUrl: string | null = null;
    let fileName: string | null = null;
    try {
      const parsed = JSON.parse(fileColumn.value);
      const files = parsed?.files ?? [];
      if (files.length > 0) {
        // Newest upload wins — a re-run appends rather than replacing.
        fileUrl = files[files.length - 1]?.url ?? null;
        fileName = files[files.length - 1]?.name ?? "Stayful-Guaranteed-Rent-Report.pdf";
      }
    } catch {
      return NextResponse.json({ error: "Could not parse report file." }, { status: 500 });
    }

    if (!fileUrl) {
      return NextResponse.json({ error: "No report file found for this lead." }, { status: 404 });
    }

    return NextResponse.json({ success: true, leadName: item.name, fileUrl, fileName });
  } catch (err) {
    console.error("[get-report] Monday API error:", err);
    return NextResponse.json({ error: "Failed to fetch report. Please try again." }, { status: 500 });
  }
}
