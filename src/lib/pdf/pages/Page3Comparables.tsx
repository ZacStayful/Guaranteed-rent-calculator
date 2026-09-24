import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS as C, PDF_LAYOUT as L, PDF_TYPE as T, fontFamily } from "../theme";
import { ReportPage, Eyebrow, Heading, Lede, Badge } from "../components/Primitives";
import { CompsScatter } from "../components/charts/CompsScatter";
import {
  formatGbp,
  formatPercent,
  formatRating,
  clamp,
} from "../components/format";
import { MAX_COMPARABLE_ROWS } from "../derive";
import type { PdfReportData } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  strip: {
    flexDirection: "row",
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    backgroundColor: C.SURFACE,
    marginBottom: 14,
  },
  stripCell: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRightWidth: L.hairline,
    borderRightColor: C.RULE,
  },
  stripCellLast: { borderRightWidth: 0 },
  stripLabel: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
    marginBottom: 4,
  },
  stripValue: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.figureSm,
    letterSpacing: T.trackTight,
    color: C.INK,
  },

  tableHead: {
    flexDirection: "row",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingBottom: 5,
    marginTop: 12,
  },
  th: { fontFamily: mono, fontSize: T.micro, letterSpacing: 0.8, color: C.MUTED },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingVertical: 3.2,
  },
  cName: { flex: 1, paddingRight: 6 },
  cDist: { width: 44, textAlign: "right" },
  cNight: { width: 38, textAlign: "right" },
  cOcc: { width: 32, textAlign: "right" },
  cAnnual: { width: 50, textAlign: "right" },
  cRtg: { width: 28, textAlign: "right" },
  cTier: { width: 28, alignItems: "flex-end" },
  name: { fontSize: T.body, color: C.INK },
  num: { fontFamily: mono, fontSize: T.body, color: C.INK },
  dash: { fontFamily: mono, fontSize: T.body, color: C.RULE, textAlign: "right" },

  truncNote: { fontFamily: mono, fontSize: T.micro, color: C.MUTED, marginTop: 6 },
  emptyNote: {
    fontSize: T.body,
    color: C.MUTED,
    paddingVertical: 14,
    textAlign: "center",
  },

  panels: { flexDirection: "row", gap: L.gutter, marginTop: "auto", paddingTop: 14 },
  panel: {
    flex: 1,
    borderRadius: L.radius,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  panelLight: {
    backgroundColor: C.SURFACE,
    borderWidth: L.hairline,
    borderColor: C.RULE,
  },
  panelDark: { backgroundColor: C.INK },
  panelLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    marginBottom: 8,
  },
  pRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    borderTopWidth: L.hairline,
  },
  pName: { fontSize: T.body },
  pValue: { fontFamily: sans, fontWeight: 700, fontSize: T.body },
});

/**
 * Page 03 — the local market.
 *
 * Benchmarks first, then the scatter so the reader can place themselves, then
 * the listings the numbers came from, then what "matching" and "beating" the
 * market would actually take.
 */
export function Page3Comparables({ data }: { data: PdfReportData }) {
  const { comparables, comparablesTotal, compsBenchmark: b, marketTargets: m, overview } = data;

  const truncated = comparablesTotal > comparables.length;
  const dash = "—";

  const strip = [
    { label: "NIGHTLY", value: b.count > 0 ? formatGbp(b.avgNightly) : dash },
    { label: "OCCUPANCY", value: b.count > 0 ? formatPercent(b.avgOccupancy) : dash },
    { label: "ANNUAL", value: b.count > 0 ? formatGbp(b.avgAnnual) : dash },
    { label: "RATING", value: b.avgRating > 0 ? formatRating(b.avgRating) : dash },
    { label: "REVIEWS", value: b.avgReviews > 0 ? String(b.avgReviews) : dash },
  ];

  return (
    <ReportPage meta={data.meta} page={3}>
      <Eyebrow>03 — THE MARKET</Eyebrow>
      <Heading>How it stacks up against the neighbours</Heading>
      <Lede>
        {comparablesTotal > 0
          ? `${comparablesTotal} active Airbnb ${comparablesTotal === 1 ? "listing" : "listings"} within ${b.radiusKm.toFixed(2)} km · mean-aggregated · data from Airbnb via Airbtics`
          : "No active Airbnb listings were found close enough to benchmark against."}
      </Lede>

      <View style={s.strip}>
        {strip.map((cell, i) => (
          <View
            key={cell.label}
            style={[s.stripCell, ...(i === strip.length - 1 ? [s.stripCellLast] : [])]}
          >
            <Text style={s.stripLabel}>{cell.label}</Text>
            <Text style={s.stripValue}>{cell.value}</Text>
          </View>
        ))}
      </View>

      <CompsScatter
        comparables={comparables}
        yourNightly={overview.adr}
        yourOccupancy={overview.occupancy}
      />

      {comparables.length > 0 ? (
        <>
          <View style={s.tableHead}>
            <Text style={[s.th, s.cName]}>LISTING</Text>
            <Text style={[s.th, s.cDist]}>DIST</Text>
            <Text style={[s.th, s.cNight]}>NIGHT</Text>
            <Text style={[s.th, s.cOcc]}>OCC</Text>
            <Text style={[s.th, s.cAnnual]}>ANNUAL</Text>
            <Text style={[s.th, s.cRtg]}>RTG</Text>
            <Text style={[s.th, s.cTier, { textAlign: "right" }]}>TIER</Text>
          </View>
          {comparables.map((c, i) => (
            <View key={`${c.name}-${i}`} style={s.row}>
              <Text style={[s.name, s.cName]}>{clamp(c.name, 42)}</Text>
              <Text style={[s.num, s.cDist]}>{c.distance}</Text>
              <Text style={[s.num, s.cNight]}>{formatGbp(c.nightly)}</Text>
              <Text style={[s.num, s.cOcc]}>{formatPercent(c.occupancy)}</Text>
              <Text style={[s.num, s.cAnnual]}>{formatGbp(c.annual)}</Text>
              <Text style={[s.num, s.cRtg]}>{formatRating(c.rating)}</Text>
              <View style={s.cTier}>
                {c.top ? <Badge>TOP</Badge> : <Text style={s.dash}>—</Text>}
              </View>
            </View>
          ))}
          {truncated ? (
            <Text style={s.truncNote}>
              Showing the {MAX_COMPARABLE_ROWS} nearest of {comparablesTotal} listings found.
              Every figure above is aggregated across all {comparablesTotal}.
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={s.emptyNote}>
          No comparable listings to show. The figures on this page fall back to
          regional estimates.
        </Text>
      )}

      <View style={s.panels}>
        <View style={[s.panel, s.panelLight]}>
          <Text style={[s.panelLabel, { color: C.MUTED }]}>TO MATCH THE MARKET</Text>
          {[
            { name: "Nightly rate", value: formatGbp(m.matchNightly) },
            { name: "Occupancy", value: formatPercent(m.matchOccupancy) },
            { name: "Guest rating", value: formatRating(b.avgRating) },
            { name: "Annual revenue", value: formatGbp(m.matchRevenue) },
          ].map((r) => (
            <View key={r.name} style={[s.pRow, { borderTopColor: C.RULE }]}>
              <Text style={[s.pName, { color: C.INK }]}>{r.name}</Text>
              <Text style={[s.pValue, { color: C.INK }]}>{r.value}</Text>
            </View>
          ))}
        </View>

        <View style={[s.panel, s.panelDark]}>
          <Text style={[s.panelLabel, { color: C.ON_DARK_MUTED }]}>TO BEAT IT · TOP 25%</Text>
          {[
            { name: "Nightly rate", value: formatGbp(m.beatNightly) },
            { name: "Occupancy", value: formatPercent(m.beatOccupancy) },
            { name: "Annual revenue", value: formatGbp(m.beatRevenue) },
          ].map((r) => (
            <View
              key={r.name}
              style={[s.pRow, { borderTopColor: C.ON_DARK_MUTED, opacity: 1 }]}
            >
              <Text style={[s.pName, { color: C.ON_DARK_MUTED }]}>{r.name}</Text>
              <Text style={[s.pValue, { color: C.ON_DARK }]}>{r.value}</Text>
            </View>
          ))}
        </View>
      </View>
    </ReportPage>
  );
}
