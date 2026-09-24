import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import {
  PDF_COLORS as C,
  PDF_LAYOUT as L,
  PDF_TYPE as T,
  PDF_RAMP,
  PDF_COST_RATES as R,
  fontFamily,
} from "../theme";
import {
  ReportPage,
  Eyebrow,
  Heading,
  Lede,
  Swatch,
  SharedScaleBar,
} from "../components/Primitives";
import { MonthlyNetChart, MonthlyNetLegend } from "../components/charts/MonthlyNetChart";
import {
  formatGbp,
  formatGbpSigned,
  formatGbpNegative,
  formatRate,
} from "../components/format";
import type { PdfReportData } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  barBlock: { marginBottom: 14 },
  barHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  barLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.INK,
  },

  cols: { flexDirection: "row", gap: 16, marginBottom: 16 },
  col: { flex: 1 },

  tableHead: {
    flexDirection: "row",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingBottom: 5,
    marginBottom: 1,
  },
  th: { fontFamily: mono, fontSize: T.micro, letterSpacing: 0.8, color: C.MUTED },
  thName: { flex: 1 },
  thRate: { width: 26, textAlign: "right" },
  thNum: { width: 46, textAlign: "right" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingVertical: 5,
  },
  rowName: { flex: 1, flexDirection: "row", alignItems: "center" },
  name: { fontSize: T.body, color: C.INK },
  nameStrong: { fontSize: T.body, color: C.INK, fontFamily: sans, fontWeight: 700 },
  rate: { width: 26, fontFamily: mono, fontSize: T.micro, color: C.MUTED, textAlign: "right" },
  num: { width: 46, fontFamily: mono, fontSize: T.body, color: C.INK, textAlign: "right" },
  numStrong: {
    width: 46,
    fontFamily: mono,
    fontSize: T.body,
    fontWeight: 700,
    color: C.INK,
    textAlign: "right",
  },

  diffPanel: {
    backgroundColor: C.INK,
    borderRadius: L.radius,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  diffLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
    marginBottom: 4,
  },
  diffValue: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 21,
    letterSpacing: T.trackTight,
    color: C.ACCENT,
  },

  chartHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  chartLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.INK,
  },

  footRow: {
    flexDirection: "row",
    borderTopWidth: L.hairline,
    borderTopColor: C.RULE,
    paddingTop: 7,
    marginTop: "auto",
  },
  foot: {
    flex: 1,
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
  },
});

/**
 * Page 02 — where the money goes.
 *
 * Both lets are drawn on one shared scale so the difference is visual, then
 * itemised so the reader can check the arithmetic, then spread across the year
 * so they can see the seasonality behind the annual figure.
 */
export function Page2Revenue({ data }: { data: PdfReportData }) {
  const { shortLetAnnual: str, longLetAnnual: ltl, strVsLtl, monthly } = data;

  const scaleMax = Math.max(str.gross, ltl.gross, 1);
  const perMonth = (annual: number) => Math.round(annual / 12);
  const ltlNetMonthly = perMonth(ltl.net);

  // Segments are built from the same rounded figures the table prints, so the
  // bar can't disagree with the numbers beside it.
  const strSegments = [
    { value: str.net, color: PDF_RAMP[0] },
    { value: str.platformFee, color: PDF_RAMP[1] },
    { value: str.managementFee, color: PDF_RAMP[2] },
    { value: str.cleaning, color: PDF_RAMP[3] },
  ];
  const ltlSegments = [
    { value: ltl.net, color: C.MUTED },
    { value: ltl.agentFee, color: PDF_RAMP[3] },
  ];

  const netPct = str.gross > 0 ? Math.round((str.net / str.gross) * 100) : 0;
  const ltlNetPct = ltl.gross > 0 ? Math.round((ltl.net / ltl.gross) * 100) : 0;

  const withNet = monthly.filter((m) => Number.isFinite(m.net));
  const peak = withNet.length
    ? withNet.reduce((a, b) => (b.net > a.net ? b : a))
    : null;
  const quietest = withNet.length
    ? withNet.reduce((a, b) => (b.net < a.net ? b : a))
    : null;
  const lowestGain = withNet.length
    ? withNet.reduce((a, b) => (b.vsLtl < a.vsLtl ? b : a))
    : null;

  return (
    <ReportPage meta={data.meta} page={2}>
      <Eyebrow>02 — THE NUMBERS</Eyebrow>
      <Heading>Where every pound goes</Heading>
      <Lede>Both options drawn on the same scale, so the gap is exactly as big as it looks.</Lede>

      <View style={s.barBlock}>
        <View style={s.barHead}>
          <Text style={s.barLabel}>SHORT-TERM LET · GROSS {formatGbp(str.gross)}</Text>
          <Text style={s.barLabel}>YOU KEEP {formatGbp(str.net)}</Text>
        </View>
        <SharedScaleBar segments={strSegments} scaleMax={scaleMax} />
      </View>

      <View style={s.barBlock}>
        <View style={s.barHead}>
          <Text style={s.barLabel}>LONG-TERM LET · GROSS {formatGbp(ltl.gross)}</Text>
          <Text style={s.barLabel}>YOU KEEP {formatGbp(ltl.net)}</Text>
        </View>
        <SharedScaleBar segments={ltlSegments} scaleMax={scaleMax} />
      </View>

      <View style={s.cols}>
        <View style={s.col}>
          <View style={s.tableHead}>
            <Text style={[s.th, s.thName]}>SHORT-TERM LET</Text>
            <Text style={[s.th, s.thRate]} />
            <Text style={[s.th, s.thNum]}>ANNUAL</Text>
            <Text style={[s.th, s.thNum]}>MONTH</Text>
          </View>

          <View style={s.row}>
            <View style={s.rowName}>
              <Text style={s.name}>Gross revenue</Text>
            </View>
            <Text style={s.rate} />
            <Text style={s.num}>{formatGbp(str.gross)}</Text>
            <Text style={s.num}>{formatGbp(perMonth(str.gross))}</Text>
          </View>

          {[
            { name: "Platform fees", rate: R.PLATFORM, value: str.platformFee, ramp: 1 },
            { name: "Management", rate: R.MANAGEMENT, value: str.managementFee, ramp: 2 },
            { name: "Cleaning & laundry", rate: R.CLEANING, value: str.cleaning, ramp: 3 },
          ].map((r) => (
            <View key={r.name} style={s.row}>
              <View style={s.rowName}>
                <Swatch color={PDF_RAMP[r.ramp]} />
                <Text style={s.name}>{r.name}</Text>
              </View>
              <Text style={s.rate}>{formatRate(r.rate)}</Text>
              <Text style={s.num}>{formatGbpNegative(r.value)}</Text>
              <Text style={s.num}>{formatGbpNegative(perMonth(r.value))}</Text>
            </View>
          ))}

          <View style={s.row}>
            <View style={s.rowName}>
              <Swatch color={PDF_RAMP[0]} />
              <Text style={s.nameStrong}>Net income</Text>
            </View>
            <Text style={s.rate}>{netPct}%</Text>
            <Text style={s.numStrong}>{formatGbp(str.net)}</Text>
            <Text style={s.numStrong}>{formatGbp(perMonth(str.net))}</Text>
          </View>
        </View>

        <View style={s.col}>
          <View style={s.tableHead}>
            <Text style={[s.th, s.thName]}>LONG-TERM LET</Text>
            <Text style={[s.th, s.thRate]} />
            <Text style={[s.th, s.thNum]}>ANNUAL</Text>
            <Text style={[s.th, s.thNum]}>MONTH</Text>
          </View>

          <View style={s.row}>
            <View style={s.rowName}>
              <Text style={s.name}>Gross rent</Text>
            </View>
            <Text style={s.rate} />
            <Text style={s.num}>{formatGbp(ltl.gross)}</Text>
            <Text style={s.num}>{formatGbp(perMonth(ltl.gross))}</Text>
          </View>

          <View style={s.row}>
            <View style={s.rowName}>
              <Swatch color={PDF_RAMP[3]} />
              <Text style={s.name}>Letting agent</Text>
            </View>
            <Text style={s.rate}>{formatRate(R.LTL_AGENT)}</Text>
            <Text style={s.num}>{formatGbpNegative(ltl.agentFee)}</Text>
            <Text style={s.num}>{formatGbpNegative(perMonth(ltl.agentFee))}</Text>
          </View>

          <View style={s.row}>
            <View style={s.rowName}>
              <Swatch color={C.MUTED} />
              <Text style={s.nameStrong}>Net income</Text>
            </View>
            <Text style={s.rate}>{ltlNetPct}%</Text>
            <Text style={s.numStrong}>{formatGbp(ltl.net)}</Text>
            <Text style={s.numStrong}>{formatGbp(ltlNetMonthly)}</Text>
          </View>

          <View style={s.diffPanel}>
            <Text style={s.diffLabel}>DIFFERENCE</Text>
            <Text style={s.diffValue}>{formatGbpSigned(strVsLtl.annualDiff)} / yr</Text>
          </View>
        </View>
      </View>

      <View style={s.chartHead}>
        <Text style={s.chartLabel}>12-MONTH NET INCOME FORECAST</Text>
        <MonthlyNetLegend longLetMonthlyNet={ltlNetMonthly} />
      </View>
      <MonthlyNetChart months={monthly} longLetMonthlyNet={ltlNetMonthly} />

      {peak && quietest && lowestGain ? (
        <View style={s.footRow}>
          <Text style={s.foot}>
            PEAK · {peak.short} {formatGbp(peak.net)}
          </Text>
          <Text style={s.foot}>
            QUIETEST · {quietest.short} {formatGbp(quietest.net)}
          </Text>
          <Text style={s.foot}>
            LOWEST GAIN VS LONG-LET · {formatGbpSigned(lowestGain.vsLtl)}
          </Text>
        </View>
      ) : null}
    </ReportPage>
  );
}
