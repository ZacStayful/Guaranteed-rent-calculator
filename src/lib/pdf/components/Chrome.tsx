/* eslint-disable jsx-a11y/alt-text --
 * `Image` here is @react-pdf/renderer's PDF drawing primitive, not an <img>.
 * It has no `alt` prop, and a PDF has no accessibility tree for one to land in.
 */
import React from "react";
import path from "node:path";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import {
  PDF_COLORS as C,
  PDF_LAYOUT as L,
  PDF_TYPE as T,
  fontFamily,
} from "../theme";
import { formatIssueDate, formatIssueDateNumeric } from "./format";
import type { PdfMeta } from "../derive";

// Re-exported so the page components keep a single import for formatters.
export * from "./format";

/** Total pages in the report. Fixed — a setup page always renders. */
export const TOTAL_PAGES = 6;

/** The section names, indexed by page number. */
export const SECTIONS = [
  "THE VERDICT",
  "THE NUMBERS",
  "THE MARKET",
  "LOCATION & RISK",
  "SETUP COSTS",
  "THE PLAN",
] as const;

/** "02 / 06" */
export const pageRef = (page: number): string =>
  `${String(page).padStart(2, "0")} / ${String(TOTAL_PAGES).padStart(2, "0")}`;

/** "02 — THE NUMBERS" */
export const sectionRef = (page: number): string =>
  `${String(page).padStart(2, "0")} — ${SECTIONS[page - 1]}`;

// ─── Assets ──────────────────────────────────────────────────────
// Statically-written paths, for the same reason as the fonts in theme.ts: any
// filesystem probing here makes the bundler trace the whole project into every
// route that renders a report. Both files are committed and declared in
// next.config.ts's `outputFileTracingIncludes`, and `assets.test.ts` checks
// they exist.
//
// The wordmark PNG carries an opaque PAPER-coloured background, so it only
// ever sits on the page background — never on a dark panel.
export const LOGO_PATH = path.join(process.cwd(), "public/images/stayful-logo.png");
export const QR_PATH = path.join(process.cwd(), "public/images/qr-book-call.png");

const s = StyleSheet.create({
  // ── Corner registration marks ──
  corner: { position: "absolute", width: 7, height: 7 },
  cornerH: {
    position: "absolute",
    top: 3,
    left: 0,
    width: 7,
    height: 0.5,
    backgroundColor: C.RULE,
  },
  cornerV: {
    position: "absolute",
    left: 3,
    top: 0,
    width: 0.5,
    height: 7,
    backgroundColor: C.RULE,
  },

  // ── Header ──
  header: { position: "absolute", top: L.marginTop, left: L.marginX, right: L.marginX },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  logoFirst: { width: 122, height: 72 },
  logoRunning: { width: 62, height: 37 },
  metaBlock: { alignItems: "flex-end", paddingTop: 6 },
  metaLine: {
    fontFamily: fontFamily("MONO"),
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.INK,
    marginBottom: 3,
  },
  metaLineMuted: {
    fontFamily: fontFamily("MONO"),
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
    marginBottom: 3,
  },
  runningMeta: {
    fontFamily: fontFamily("MONO"),
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.INK,
    paddingTop: 14,
  },
  headerRule: { height: L.hairline, backgroundColor: C.RULE, marginTop: 8 },

  // ── Footer ──
  footer: { position: "absolute", bottom: L.marginBottom, left: L.marginX, right: L.marginX },
  footerRule: { height: L.hairline, backgroundColor: C.RULE, marginBottom: 6 },
  footerRow: { flexDirection: "row", alignItems: "center" },
  footerText: {
    fontFamily: fontFamily("MONO"),
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
  },
  footerLeft: { flex: 1.4 },
  footerCentre: { flex: 1.5, textAlign: "center" },
  footerRight: { width: 46, textAlign: "right" },
});

/** Thin crosshairs in each corner — a print-registration cue from the design. */
export function CornerMarks() {
  const inset = 14;
  const positions = [
    { top: inset, left: inset },
    { top: inset, right: inset },
    { bottom: inset, left: inset },
    { bottom: inset, right: inset },
  ];
  return (
    <>
      {positions.map((pos, i) => (
        <View key={i} fixed style={[s.corner, pos]}>
          <View style={s.cornerH} />
          <View style={s.cornerV} />
        </View>
      ))}
    </>
  );
}

/**
 * Page-01 header: the full wordmark, then what this document is, when it was
 * issued and who it's for.
 */
export function CoverHeader({ meta }: { meta: PdfMeta }) {
  const issued = formatIssueDate(meta.issuedAt);
  return (
    <View fixed style={s.header}>
      <View style={s.headerRow}>
        <Image src={LOGO_PATH} style={s.logoFirst} />
        <View style={s.metaBlock}>
          <Text style={s.metaLine}>PROPERTY INCOME ANALYSIS</Text>
          {issued ? <Text style={s.metaLineMuted}>ISSUED {issued}</Text> : null}
          {meta.preparedFor ? (
            <Text style={s.metaLineMuted}>PREPARED FOR [{meta.preparedFor}]</Text>
          ) : null}
        </View>
      </View>
      <View style={s.headerRule} />
    </View>
  );
}

/**
 * Pages 02–06: a small wordmark and a single line locating the reader —
 * which property, which page, which section.
 */
export function RunningHeader({ meta, page }: { meta: PdfMeta; page: number }) {
  const where = [meta.street, meta.city].filter(Boolean).join(" · ").toUpperCase();
  return (
    <View fixed style={s.header}>
      <View style={s.headerRow}>
        <Image src={LOGO_PATH} style={s.logoRunning} />
        <Text style={s.runningMeta}>
          {where ? `${where}    ` : ""}
          {sectionRef(page)}
        </Text>
      </View>
      <View style={s.headerRule} />
    </View>
  );
}

/** Footer on every page. Page numbers come from react-pdf, not the caller. */
export function FooterBar({ meta }: { meta: PdfMeta }) {
  const issued = formatIssueDateNumeric(meta.issuedAt);
  return (
    <View fixed style={s.footer}>
      <View style={s.footerRule} />
      <View style={s.footerRow}>
        <Text style={[s.footerText, s.footerLeft]}>
          STAYFUL.CO.UK · info@stayful.co.uk
        </Text>
        <Text style={[s.footerText, s.footerCentre]}>
          CONFIDENTIAL{issued ? ` · ISSUED ${issued}` : ""}
        </Text>
        <Text
          style={[s.footerText, s.footerRight]}
          render={({ pageNumber, totalPages }) =>
            `${String(pageNumber).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`
          }
        />
      </View>
    </View>
  );
}
