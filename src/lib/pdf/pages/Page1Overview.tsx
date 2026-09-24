import React from "react";
import { View, Text, StyleSheet, Svg, Line } from "@react-pdf/renderer";
import {
  PDF_COLORS as C,
  PDF_LAYOUT as L,
  PDF_TYPE as T,
  pickH1Size,
  fontFamily,
} from "../theme";
import {
  ReportPage,
  Eyebrow,
  Chip,
  StatCard,
  MiniTrack,
  SectionNav,
} from "../components/Primitives";
import {
  formatGbp,
  formatGbpSigned,
  formatPercent,
  formatPaybackMonths,
} from "../components/format";
import type { PdfReportData } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  h1: {
    fontFamily: sans,
    fontWeight: 700,
    letterSpacing: T.trackTight,
    color: C.INK,
    lineHeight: 1.08,
    marginBottom: 10,
  },
  chipRow: { flexDirection: "row", gap: 6, marginBottom: 16 },

  hero: { backgroundColor: C.INK, borderRadius: L.radius, padding: 18, flexDirection: "row" },
  heroLeft: { flex: 1.05, paddingRight: 16 },
  heroDivider: { width: L.hairline, backgroundColor: C.ON_DARK_MUTED, opacity: 0.4 },
  heroRight: { flex: 1, paddingLeft: 16 },

  heroLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
    marginBottom: 8,
  },
  heroFigure: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.heroFigure,
    letterSpacing: T.trackTight,
    color: C.ON_DARK,
    marginBottom: 6,
  },
  heroPer: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ACCENT,
    marginBottom: 10,
  },
  heroBody: { fontSize: T.body, color: C.ON_DARK_MUTED, lineHeight: 1.4 },

  cmpHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  cmpLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK,
  },
  cmpValue: { fontFamily: mono, fontSize: T.label, color: C.ON_DARK },
  cmpLabelMuted: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
  },
  cmpTrack: { height: 9, borderRadius: 1.5, marginBottom: 14 },
  cmpRule: {
    height: L.hairline,
    backgroundColor: C.ON_DARK_MUTED,
    opacity: 0.4,
    marginBottom: 12,
  },
  upliftRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 4 },
  uplift: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 26,
    letterSpacing: T.trackTight,
    color: C.ACCENT,
  },
  upliftUnit: { fontSize: T.body, color: C.ON_DARK, marginLeft: 4, marginBottom: 3 },
  upliftSub: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.ON_DARK_MUTED,
    lineHeight: 1.4,
  },

  cardRow: { flexDirection: "row", gap: L.gutter, marginTop: 16 },

  valueStrip: {
    backgroundColor: C.SURFACE,
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    paddingHorizontal: 14,
    paddingVertical: 15,
    marginTop: 16,
  },
  stripHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  stripLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
  },
  stripSource: { fontSize: T.micro, color: C.MUTED },
  stripBody: { flexDirection: "row", alignItems: "center" },
  stripFigure: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 17,
    letterSpacing: T.trackTight,
    color: C.INK,
  },
  stripAxis: { flex: 1, alignItems: "center", paddingHorizontal: 12 },
  stripFootRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  stripFoot: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
  },

  navWrap: { marginTop: "auto", paddingTop: 14 },
});

const AXIS_W = 300;
const AXIS_H = 10;
const AXIS_TICKS = 30;

/**
 * The ruled span between the conservative and upper valuations: a capped line
 * with evenly spaced ticks, so the range reads as a measured interval rather
 * than two loose numbers.
 */
function ValueAxis() {
  const mid = AXIS_H / 2;
  return (
    <Svg width={AXIS_W} height={AXIS_H}>
      <Line x1={0} y1={mid} x2={AXIS_W} y2={mid} stroke={C.RULE} strokeWidth={0.5} />
      {Array.from({ length: AXIS_TICKS + 1 }, (_, i) => {
        const x = (i / AXIS_TICKS) * (AXIS_W - 1) + 0.5;
        const end = i === 0 || i === AXIS_TICKS;
        return (
          <Line
            key={i}
            x1={x}
            y1={end ? 0 : mid - 2.5}
            x2={x}
            y2={end ? AXIS_H : mid + 2.5}
            stroke={end ? C.INK : C.RULE}
            strokeWidth={end ? 0.8 : 0.5}
          />
        );
      })}
    </Svg>
  );
}

/**
 * Page 01 — the verdict.
 *
 * Leads with the one number that matters (net income), sets it against a
 * long-let on a shared scale, then the four supporting figures.
 */
export function Page1Overview({ data }: { data: PdfReportData }) {
  const { overview, strVsLtl, shortLetAnnual, longLetAnnual, property, setup } = data;

  // Both bars are drawn against the larger gross, so the gap is to scale.
  const scaleMax = Math.max(shortLetAnnual.gross, longLetAnnual.gross, 1);
  const strPct = (shortLetAnnual.net / scaleMax) * 100;
  const ltlPct = (longLetAnnual.net / scaleMax) * 100;

  const isLongLet = data.recommendation === "LONG_LET";
  const verdictChip = isLongLet ? "LONG-TERM LET ANALYSIS" : "SHORT-TERM LET ANALYSIS";

  // ── The guaranteed-rent offer ──
  // The band, the gap and the revenue multiple travel on this object too, and
  // are deliberately not printed: they are our screening notes, not something
  // to hand a landlord. Only the offer and the income comparison appear here.
  const gr = data.guaranteedRent;
  const offerMonthly = gr?.hasOffer ? gr.offerRentMonthly ?? 0 : 0;
  const offerAnnual = offerMonthly * 12;
  const hasOffer = offerMonthly > 0;

  // What they asked for, against what we can offer.
  //
  // Deliberately NOT the offer against the short-let net. Those are not
  // comparable: the short-let figure is what the property grosses less
  // platform, management and cleaning, with the landlord still carrying the
  // bills, the voids, the furnishing and the work. Drawing a guaranteed rent
  // next to it produces a large negative number that argues against the very
  // offer the page is making, and compares certainty to a best case.
  //
  // Ask against offer is the comparison the landlord is actually weighing, and
  // it is the one the call has to start from. The short-let income potential is
  // still on this page in the stat cards, and in full on page 02.
  const askMonthly = gr?.desiredRentMonthly ?? 0;
  const askAnnual = askMonthly * 12;
  const offerScaleMax = Math.max(offerAnnual, askAnnual, 1);
  const offerPct = (offerAnnual / offerScaleMax) * 100;
  const askPct = (askAnnual / offerScaleMax) * 100;
  const offerVsAsk = offerAnnual - askAnnual;

  const hasValuation =
    overview.valueConservative !== null && overview.valueUpper !== null;

  const payback =
    data.setupPaybackMonths !== null
      ? `Indicative · recovered in ${formatPaybackMonths(data.setupPaybackMonths)} of extra income vs long-term let`
      : "Indicative estimate for a property of this size";

  return (
    <ReportPage meta={data.meta} page={1}>
      <Eyebrow>01 — YOUR OFFER</Eyebrow>
      <Text style={[s.h1, { fontSize: pickH1Size(property.address) }]}>
        {property.address}
      </Text>

      <View style={s.chipRow}>
        <Chip>
          {property.bedrooms} {property.bedrooms === 1 ? "BEDROOM" : "BEDROOMS"}
        </Chip>
        {property.sleeps > 0 ? <Chip>SLEEPS {property.sleeps}</Chip> : null}
        <Chip solid>{hasOffer ? "GUARANTEED RENT OFFER" : verdictChip}</Chip>
      </View>

      <View style={s.hero}>
        <View style={s.heroLeft}>
          {hasOffer ? (
            <>
              <Text style={s.heroLabel}>GUARANTEED RENT · OUR OFFER</Text>
              <Text style={s.heroFigure}>{formatGbp(offerMonthly)}</Text>
              <Text style={s.heroPer}>
                PER MONTH · {formatGbp(offerAnnual)} / YEAR
              </Text>
              <Text style={s.heroBody}>
                {gr?.offerMeetsAsk
                  ? "This matches the rent you asked for. Paid every month, whether the property is booked or not."
                  : "The most we can guarantee on this property. Paid every month, whether the property is booked or not."}
              </Text>
            </>
          ) : (
            <>
              <Text style={s.heroLabel}>ESTIMATED NET INCOME · SHORT-TERM LET</Text>
              <Text style={s.heroFigure}>{formatGbp(overview.netRevenue)}</Text>
              <Text style={s.heroPer}>
                PER YEAR · {formatGbp(overview.netMonthly)} / MONTH
              </Text>
              <Text style={s.heroBody}>
                What you keep after platform, management, cleaning and laundry costs.
              </Text>
            </>
          )}
        </View>

        <View style={s.heroDivider} />

        <View style={s.heroRight}>
          {hasOffer ? (
            <>
              <View style={s.cmpHead}>
                <Text style={s.cmpLabel}>OUR OFFER</Text>
                <Text style={s.cmpValue}>{formatGbp(offerAnnual)}</Text>
              </View>
              <View style={[s.cmpTrack, { width: `${offerPct}%`, backgroundColor: C.ACCENT }]} />

              <View style={s.cmpHead}>
                <Text style={s.cmpLabelMuted}>YOU ASKED FOR</Text>
                <Text style={s.cmpValue}>{formatGbp(askAnnual)}</Text>
              </View>
              <View style={[s.cmpTrack, { width: `${askPct}%`, backgroundColor: C.MUTED }]} />

              <View style={s.cmpRule} />

              {gr?.offerMeetsAsk ? (
                <>
                  <View style={s.upliftRow}>
                    <Text style={s.uplift}>{formatGbp(offerMonthly)}</Text>
                    <Text style={s.upliftUnit}>/ month</Text>
                  </View>
                  <Text style={s.upliftSub}>YOUR ASKING RENT, MATCHED IN FULL</Text>
                </>
              ) : (
                <>
                  <View style={s.upliftRow}>
                    <Text style={s.uplift}>{formatGbpSigned(offerVsAsk)}</Text>
                    <Text style={s.upliftUnit}>/ year</Text>
                  </View>
                  <Text style={s.upliftSub}>
                    AGAINST YOUR ASK ·{" "}
                    {formatGbpSigned(Math.round(offerVsAsk / 12))} / MONTH
                  </Text>
                </>
              )}
            </>
          ) : (
            <>
              <View style={s.cmpHead}>
                <Text style={s.cmpLabel}>SHORT-TERM LET</Text>
                <Text style={s.cmpValue}>{formatGbp(shortLetAnnual.net)}</Text>
              </View>
              <View style={[s.cmpTrack, { width: `${strPct}%`, backgroundColor: C.ACCENT }]} />

              <View style={s.cmpHead}>
                <Text style={s.cmpLabelMuted}>LONG-TERM LET</Text>
                <Text style={s.cmpValue}>{formatGbp(longLetAnnual.net)}</Text>
              </View>
              <View style={[s.cmpTrack, { width: `${ltlPct}%`, backgroundColor: C.MUTED }]} />

              <View style={s.cmpRule} />

              <View style={s.upliftRow}>
                <Text style={s.uplift}>{formatGbpSigned(strVsLtl.annualDiff)}</Text>
                <Text style={s.upliftUnit}>/ year</Text>
              </View>
              <Text style={s.upliftSub}>
                {strVsLtl.percentUplift >= 0 ? "+" : ""}
                {strVsLtl.percentUplift}% VS LONG-TERM LET ·{" "}
                {formatGbpSigned(strVsLtl.monthlyDiff)} / MONTH
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={s.cardRow}>
        <StatCard
          label="Gross revenue"
          value={formatGbp(overview.grossRevenue)}
          sub={`${formatGbp(overview.grossMonthly)} a month before costs`}
        />
        <StatCard
          label="Nightly rate"
          value={formatGbp(overview.adr)}
          sub="Average across the comp set"
        />
        <StatCard
          label="Occupancy"
          value={formatPercent(overview.occupancy)}
          sub={`Market average ${formatPercent(overview.marketOccupancy)}`}
        >
          <MiniTrack
            pct={overview.occupancy * 100}
            marker={overview.marketOccupancy * 100}
          />
        </StatCard>
        {hasOffer ? (
          <StatCard
            label="Guaranteed rent"
            value={formatGbp(offerMonthly)}
            sub={`${formatGbp(offerAnnual)} a year, paid monthly`}
          />
        ) : (
          <StatCard
            label="Setup cost"
            value={setup ? formatGbp(setup.grandTotal) : "—"}
            sub={setup ? payback : "Not provided"}
          />
        )}
      </View>

      {hasValuation ? (
        <View style={s.valueStrip}>
          <View style={s.stripHead}>
            <Text style={s.stripLabel}>ESTIMATED PROPERTY VALUE</Text>
            <Text style={s.stripSource}>Source: PropertyData</Text>
          </View>
          <View style={s.stripBody}>
            <Text style={s.stripFigure}>{formatGbp(overview.valueConservative!)}</Text>
            <View style={s.stripAxis}>
              <ValueAxis />
            </View>
            <Text style={s.stripFigure}>{formatGbp(overview.valueUpper!)}</Text>
          </View>
          <View style={s.stripFootRow}>
            <Text style={s.stripFoot}>CONSERVATIVE</Text>
            <Text style={s.stripFoot}>UPPER ESTIMATE</Text>
          </View>
        </View>
      ) : null}

      <View style={s.navWrap}>
        <SectionNav />
      </View>
    </ReportPage>
  );
}
