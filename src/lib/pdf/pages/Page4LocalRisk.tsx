import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS as C, PDF_LAYOUT as L, PDF_TYPE as T, fontFamily } from "../theme";
import {
  ReportPage,
  Eyebrow,
  Heading,
  Lede,
  Badge,
  DotMeter,
  FactorBar,
  Chip,
} from "../components/Primitives";
import { RingGauge, RiskDial } from "../components/charts/Gauges";
import { clamp } from "../components/format";
import { PDF_COST_RATES as R } from "../theme";
import type { PdfReportData } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  cardRow: { flexDirection: "row", gap: L.gutter, marginBottom: 14 },
  card: {
    flex: 1,
    backgroundColor: C.SURFACE,
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    paddingHorizontal: 9,
    paddingTop: 8,
    paddingBottom: 10,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  cardLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
  },
  cardDist: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.figureSm,
    letterSpacing: T.trackTight,
    color: C.INK,
    marginBottom: 5,
  },
  cardName: { fontSize: T.body, color: C.INK, lineHeight: 1.3, marginBottom: 4 },
  cardCount: { fontFamily: mono, fontSize: T.micro, color: C.MUTED },

  dbPanel: {
    backgroundColor: C.INK,
    borderRadius: L.radius,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  dbText: { flex: 1, paddingLeft: 14 },
  dbLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
    marginBottom: 6,
  },
  dbHead: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 13,
    color: C.ON_DARK,
    lineHeight: 1.3,
    marginBottom: 5,
  },
  dbSub: { fontSize: T.body, color: C.ON_DARK_MUTED, lineHeight: 1.35 },

  lower: { flexDirection: "row", gap: 18 },
  lowerCol: { flex: 1 },
  colLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
    marginBottom: 12,
  },
  subLabel: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
    marginTop: 10,
    marginBottom: 4,
  },
  amRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingVertical: 5,
  },
  amName: { fontSize: T.body, color: C.INK, flex: 1 },
  amMeter: { flexDirection: "row", alignItems: "center" },
  amScore: { fontFamily: mono, fontSize: T.micro, color: C.MUTED, marginLeft: 6 },

  diffPanel: {
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    padding: 10,
    marginTop: 12,
  },
  diffHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  diffLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
  },
  diffRate: { fontSize: T.micro, color: C.MUTED },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  diffNote: { fontSize: T.micro, color: C.MUTED, lineHeight: 1.35 },
  riskFactors: { marginTop: 14 },
  emptyNote: { fontSize: T.body, color: C.MUTED },
});

function directBookingBand(score: number): string {
  if (score >= 75) return "EXCELLENT";
  if (score >= 50) return "GOOD";
  if (score >= 25) return "MODERATE";
  return "LIMITED";
}

/**
 * Page 04 — why guests book here, and what could go wrong.
 *
 * The demand cards and the direct-booking score make the upside case; the risk
 * dial and factor bars give the reader the other side of it.
 */
export function Page4LocalRisk({ data }: { data: PdfReportData }) {
  const { demandDrivers, directBookingScore, risk, amenities } = data;
  const band = directBookingBand(directBookingScore);

  return (
    <ReportPage meta={data.meta} page={4}>
      <Eyebrow>04 — LOCATION & RISK</Eyebrow>
      <Heading>Why guests will book here</Heading>
      <Lede>Demand drivers within reach of the property, and how steady that demand is.</Lede>

      {demandDrivers.length > 0 ? (
        <View style={s.cardRow}>
          {demandDrivers.map((d) => (
            <View key={d.type} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardLabel}>{d.type.toUpperCase()}</Text>
                <Badge tone={d.impact === "HIGH" ? "dark" : "muted"}>{d.impact}</Badge>
              </View>
              <Text style={s.cardDist}>{d.distance}</Text>
              <Text style={s.cardName}>{clamp(d.nearest, 34)}</Text>
              <Text style={s.cardCount}>{d.count}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[s.emptyNote, { marginBottom: 14 }]}>
          No major demand drivers were found within the search radius.
        </Text>
      )}

      <View style={s.dbPanel}>
        <RingGauge score={directBookingScore} />
        <View style={s.dbText}>
          <Text style={s.dbLabel}>DIRECT BOOKING POTENTIAL · {band}</Text>
          <Text style={s.dbHead}>
            By year 3, properties here typically take 30–50% of bookings direct.
          </Text>
          <Text style={s.dbSub}>
            That cuts the {Math.round(R.PLATFORM * 100)}% platform fee to near zero on
            those stays.
          </Text>
        </View>
      </View>

      <View style={s.lower}>
        <View style={s.lowerCol}>
          <Text style={s.colLabel}>RISK PROFILE</Text>
          <RiskDial score={risk.overall} label={risk.label} />
          <View style={s.riskFactors}>
            <FactorBar name="Revenue consistency" score={risk.factors.revenueConsistency} />
            <FactorBar name="Long-term comparison" score={risk.factors.longTermComparison} />
            <FactorBar name="Seasonal variance" score={risk.factors.seasonalVariance} />
            <FactorBar name="Market demand" score={risk.factors.marketDemand} />
          </View>
        </View>

        <View style={s.lowerCol}>
          <Text style={s.colLabel}>RECOMMENDED AMENITIES</Text>

          <Text style={s.subLabel}>ESSENTIAL</Text>
          {amenities.essential.map((a) => (
            <View key={a.name} style={s.amRow}>
              <Text style={s.amName}>{a.name}</Text>
              <View style={s.amMeter}>
                <DotMeter score={a.score} />
                <Text style={s.amScore}>{a.score}/5</Text>
              </View>
            </View>
          ))}

          <Text style={s.subLabel}>COMPETITIVE EDGE</Text>
          {amenities.competitiveEdge.map((a) => (
            <View key={a.name} style={s.amRow}>
              <Text style={s.amName}>{a.name}</Text>
              <View style={s.amMeter}>
                <DotMeter score={a.score} />
                <Text style={s.amScore}>{a.score}/5</Text>
              </View>
            </View>
          ))}

          {amenities.differentiators.length > 0 ? (
            <View style={s.diffPanel}>
              <View style={s.diffHead}>
                <Text style={s.diffLabel}>DIFFERENTIATORS</Text>
                <Text style={s.diffRate}>+15–30% rate</Text>
              </View>
              <View style={s.chipWrap}>
                {amenities.differentiators.map((d) => (
                  <Chip key={d}>{d.toUpperCase()}</Chip>
                ))}
              </View>
              <Text style={s.diffNote}>
                Listings with at least one of these command measurably higher nightly
                rates in this market.
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </ReportPage>
  );
}
