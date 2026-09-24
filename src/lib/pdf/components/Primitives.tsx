import React from "react";
import { Page, View, Text, Svg, Path, StyleSheet } from "@react-pdf/renderer";
import {
  PDF_COLORS as C,
  PDF_LAYOUT as L,
  PDF_TYPE as T,
  PDF_RAMP,
  fontFamily,
} from "../theme";
import { CornerMarks, CoverHeader, RunningHeader, FooterBar } from "./Chrome";
import type { PdfMeta } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  page: {
    backgroundColor: C.PAPER,
    paddingTop: L.marginTop + L.headerHeight,
    paddingBottom: L.marginBottom + L.footerHeight,
    paddingHorizontal: L.marginX,
    fontFamily: sans,
    fontSize: T.body,
    color: C.INK,
  },
  pageFirst: { paddingTop: L.marginTop + L.headerHeightFirst },

  eyebrow: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
    marginBottom: 8,
  },
  heading: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.h2,
    letterSpacing: T.trackTight,
    color: C.INK,
    marginBottom: 4,
  },
  lede: { fontSize: T.lede, color: C.MUTED, marginBottom: 14, lineHeight: 1.35 },

  hairline: { height: L.hairline, backgroundColor: C.RULE },
  rowGap: { flexDirection: "row", gap: L.gutter },

  // ── Chips ──
  chip: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: L.radius,
  },
  chipOutline: {
    color: C.INK,
    borderWidth: L.hairline,
    borderColor: C.RULE,
    backgroundColor: C.SURFACE,
  },
  chipSolid: { color: C.ON_DARK, backgroundColor: C.INK },

  // ── Badges ──
  badge: {
    fontFamily: mono,
    fontSize: 6.5,
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
    color: C.ON_DARK,
    backgroundColor: C.INK,
  },

  // ── Cards / panels ──
  card: {
    flex: 1,
    backgroundColor: C.SURFACE,
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    paddingHorizontal: 10,
    paddingTop: 11,
    paddingBottom: 13,
  },
  cardLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
    marginBottom: 6,
  },
  cardValue: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.cardValue,
    letterSpacing: T.trackTight,
    color: C.INK,
  },
  cardSub: { fontSize: T.micro, color: C.MUTED, marginTop: 5, lineHeight: 1.3 },

  panel: { backgroundColor: C.INK, borderRadius: L.radius, padding: 14 },
  panelLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
  },
  panelFigure: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.panelFigure,
    letterSpacing: T.trackTight,
    color: C.ON_DARK,
  },

  // ── Meters ──
  dot: { width: 5, height: 5, borderRadius: 1, marginRight: 2 },
  track: { height: 4, backgroundColor: C.RULE, borderRadius: 2, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: C.GREEN, borderRadius: 2 },

  factorRow: { marginBottom: 9 },
  factorHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  factorName: { fontSize: T.body, color: C.INK },
  factorValue: { fontFamily: mono, fontSize: T.micro, color: C.MUTED },

  // ── Section nav (page 01) ──
  navRow: { flexDirection: "row", gap: L.gutter },
  navItem: { flex: 1 },
  navRule: { height: 1.2, backgroundColor: C.INK, marginBottom: 6 },
  navNum: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
    marginBottom: 3,
  },
  navName: { fontFamily: mono, fontSize: T.label, letterSpacing: 0.8, color: C.INK },

  // ── Tables ──
  thRow: {
    flexDirection: "row",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingBottom: 5,
    marginBottom: 2,
  },
  th: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
  },
  tdRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingVertical: 5,
  },
  td: { fontSize: T.body, color: C.INK },
  tdNum: { fontFamily: mono, fontSize: T.body, color: C.INK, textAlign: "right" },
});

export const pdfStyles = s;

/** Every page: sage background, corner marks, fixed header and footer. */
export function ReportPage({
  meta,
  page,
  children,
}: {
  meta: PdfMeta;
  page: number;
  children: React.ReactNode;
}) {
  const first = page === 1;
  return (
    <Page size="A4" style={[s.page, ...(first ? [s.pageFirst] : [])]}>
      <CornerMarks />
      {first ? <CoverHeader meta={meta} /> : <RunningHeader meta={meta} page={page} />}
      {children}
      <FooterBar meta={meta} />
    </Page>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}

export function Heading({ children, size }: { children: React.ReactNode; size?: number }) {
  return <Text style={[s.heading, ...(size ? [{ fontSize: size }] : [])]}>{children}</Text>;
}

export function Lede({ children }: { children: React.ReactNode }) {
  return <Text style={s.lede}>{children}</Text>;
}

export function Hairline({ spacing = 0 }: { spacing?: number }) {
  return <View style={[s.hairline, { marginVertical: spacing }]} />;
}

export function Chip({ children, solid }: { children: React.ReactNode; solid?: boolean }) {
  return <Text style={[s.chip, solid ? s.chipSolid : s.chipOutline]}>{children}</Text>;
}

export function Badge({
  children,
  tone = "dark",
}: {
  children: React.ReactNode;
  tone?: "dark" | "muted";
}) {
  const toneStyle =
    tone === "muted" ? { backgroundColor: C.RULE, color: C.INK } : undefined;
  return <Text style={[s.badge, ...(toneStyle ? [toneStyle] : [])]}>{children}</Text>;
}

/** A small filled square used to tie a table row or legend item to a bar segment. */
export function Swatch({ color, size = 5 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 1,
        backgroundColor: color,
        marginRight: 5,
      }}
    />
  );
}

/**
 * A tick. Neither report font carries U+2713, so it's drawn rather than typed.
 */
export function Check({ size = 7, color = C.GREEN }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" style={{ marginRight: 5 }}>
      <Path
        d="M2 6.4 L4.7 9 L10 3.2"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function StatCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label.toUpperCase()}</Text>
      <Text style={s.cardValue}>{value}</Text>
      {children}
      {sub ? <Text style={s.cardSub}>{sub}</Text> : null}
    </View>
  );
}

/** 0–5 importance, as filled and empty dots. */
export function DotMeter({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {Array.from({ length: max }, (_, i) => (
        <View
          key={i}
          style={[s.dot, { backgroundColor: i < score ? C.GREEN : C.RULE }]}
        />
      ))}
    </View>
  );
}

/** A labelled 0–100 bar, used for the risk factors. */
export function FactorBar({
  name,
  score,
  outOf = 100,
}: {
  name: string;
  score: number;
  outOf?: number;
}) {
  const pct = Math.max(0, Math.min(100, (score / outOf) * 100));
  return (
    <View style={s.factorRow}>
      <View style={s.factorHead}>
        <Text style={s.factorName}>{name}</Text>
        <Text style={s.factorValue}>
          {Math.round(score)}/{outOf}
        </Text>
      </View>
      <View style={s.track}>
        <View style={[s.trackFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

/** A plain progress track, e.g. occupancy against the market average. */
export function MiniTrack({ pct, marker }: { pct: number; marker?: number }) {
  const clampPct = Math.max(0, Math.min(100, pct));
  return (
    <View style={[s.track, { marginTop: 7, position: "relative" }]}>
      <View style={[s.trackFill, { width: `${clampPct}%` }]} />
      {marker !== undefined ? (
        <View
          style={{
            position: "absolute",
            left: `${Math.max(0, Math.min(100, marker))}%`,
            top: -2,
            width: 0.8,
            height: 8,
            backgroundColor: C.INK,
          }}
        />
      ) : null}
    </View>
  );
}

export interface BarSegment {
  /** Value in the same unit as every other segment on the shared scale. */
  value: number;
  color: string;
}

/**
 * A segmented bar drawn against a shared maximum, so two bars on the same page
 * are directly comparable — the whole point of the page-02 comparison.
 */
export function SharedScaleBar({
  segments,
  scaleMax,
  height = 22,
}: {
  segments: BarSegment[];
  scaleMax: number;
  height?: number;
}) {
  const max = scaleMax > 0 ? scaleMax : 1;
  return (
    <View style={{ flexDirection: "row", height, borderRadius: 2, overflow: "hidden" }}>
      {segments.map((seg, i) => {
        const pct = Math.max(0, (seg.value / max) * 100);
        if (pct <= 0) return null;
        return <View key={i} style={{ width: `${pct}%`, backgroundColor: seg.color }} />;
      })}
      {/* Remainder of the scale stays empty so the gap between bars is literal. */}
      <View style={{ flex: 1 }} />
    </View>
  );
}

/** A full-width stacked bar that always fills its track (page-05 categories). */
export function StackedBar({
  values,
  height = 16,
}: {
  values: number[];
  height?: number;
}) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return (
    <View style={{ flexDirection: "row", height, borderRadius: 2, overflow: "hidden" }}>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            width: `${(v / total) * 100}%`,
            backgroundColor: PDF_RAMP[i % PDF_RAMP.length],
          }}
        />
      ))}
    </View>
  );
}

/** The page-01 strip pointing at the rest of the report. */
export function SectionNav({ from = 2 }: { from?: number }) {
  const items = [
    { n: "02", name: "THE NUMBERS" },
    { n: "03", name: "THE MARKET" },
    { n: "04", name: "LOCATION & RISK" },
    { n: "05", name: "SETUP COSTS" },
    { n: "06", name: "THE PLAN" },
  ].filter((it) => Number(it.n) >= from);
  return (
    <View style={s.navRow}>
      {items.map((it) => (
        <View key={it.n} style={s.navItem}>
          <View style={s.navRule} />
          <Text style={s.navNum}>{it.n}</Text>
          <Text style={s.navName}>{it.name}</Text>
        </View>
      ))}
    </View>
  );
}
