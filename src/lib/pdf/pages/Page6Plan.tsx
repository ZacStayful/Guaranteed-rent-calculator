/* eslint-disable jsx-a11y/alt-text --
 * `Image` here is @react-pdf/renderer's PDF drawing primitive, not an <img>.
 * It has no `alt` prop, and a PDF has no accessibility tree for one to land in.
 */
import React from "react";
import { View, Text, Image, Link, StyleSheet } from "@react-pdf/renderer";
import {
  PDF_COLORS as C,
  PDF_LAYOUT as L,
  PDF_TYPE as T,
  fontFamily,
} from "../theme";
import { ReportPage, Eyebrow, Heading, Lede, Check } from "../components/Primitives";
import { QR_PATH } from "../components/Chrome";
import { formatGbp, formatGbpSigned } from "../components/format";
import type { PdfReportData } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const BOOKING_URL = "https://calendly.com/zac-stayful/call";
const BOOKING_LABEL = "calendly.com/zac-stayful/call";

const STEPS = [
  {
    n: "STEP 01",
    title: "Platform launch",
    body: "Go live on Airbnb and Booking.com. Build early demand, bookings and reviews.",
  },
  {
    n: "STEP 02",
    title: "Data collection",
    body: "Track which guest types, stay lengths and price points perform best.",
  },
  {
    n: "STEP 03",
    title: "Direct bookings",
    body: "Convert repeat guests to lower-cost direct bookings, removing platform fees.",
  },
  {
    n: "STEP 04",
    title: "The result",
    body: "More profitable, repeat, low-friction bookings. Less admin, more income.",
  },
] as const;

const HANDLED = [
  "Listing setup",
  "Guest management",
  "Cleaning coordination",
  "Pricing optimisation",
  "Direct booking growth",
] as const;

const CTA_POINTS = [
  "How we get direct bookings for your property",
  "How we rank in the top 20% of listings on the platforms",
  "How we protect your property from guests",
  "What our service looks like from your side",
] as const;

// ── Guaranteed-rent variants ──
// Shown instead of the management-service copy above when the report carries an
// offer. The landlord is not choosing a management service here; they are
// choosing a fixed rent, so the steps, the list and the call agenda change.
const GUARANTEED_STEPS = [
  {
    n: "STEP 01",
    title: "Agree the rent",
    body: "We confirm the monthly figure and the term, and put it in writing.",
  },
  {
    n: "STEP 02",
    title: "We get it ready",
    body: "Furnishing, photography and the listing — arranged and paid for by us.",
  },
  {
    n: "STEP 03",
    title: "We take the risk",
    body: "Bookings, guests, cleaning and quiet months are ours to manage, not yours.",
  },
  {
    n: "STEP 04",
    title: "You get paid",
    body: "The same rent lands every month, whether the property is booked or empty.",
  },
] as const;

const GUARANTEED_HANDLED = [
  "Void periods",
  "Setup and furnishing",
  "Guest management",
  "Cleaning coordination",
  "Listing and pricing",
] as const;

const GUARANTEED_CTA_POINTS = [
  "The term, the notice period and how the agreement works",
  "When your first payment lands and how it is paid",
  "How we look after the property and handle guests",
  "What happens at the end of the term",
] as const;

const s = StyleSheet.create({
  timeline: { marginBottom: 14 },
  dotRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  dotCell: { flex: 1, flexDirection: "row", alignItems: "center" },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.2,
    borderColor: C.INK,
    backgroundColor: C.PAPER,
  },
  dotFilled: { backgroundColor: C.INK },
  connector: { flex: 1, height: 1, backgroundColor: C.INK },

  stepRow: { flexDirection: "row", gap: L.gutter },
  step: { flex: 1, paddingRight: 8 },
  stepNum: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.MUTED,
    marginBottom: 4,
  },
  stepTitle: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 10.5,
    color: C.INK,
    marginBottom: 4,
  },
  stepBody: { fontSize: T.micro, color: C.MUTED, lineHeight: 1.4 },

  sectionLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.MUTED,
    marginTop: 14,
    marginBottom: 8,
  },

  metricRow: { flexDirection: "row", gap: L.gutter },
  metric: {
    flex: 1,
    backgroundColor: C.SURFACE,
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    paddingHorizontal: 9,
    paddingTop: 9,
    paddingBottom: 10,
  },
  metricValue: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 19,
    letterSpacing: T.trackTight,
    color: C.GREEN,
    marginBottom: 5,
  },
  metricName: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.body,
    color: C.INK,
    marginBottom: 3,
  },
  metricSub: { fontSize: T.micro, color: C.MUTED, lineHeight: 1.35 },

  handledGrid: { flexDirection: "row", flexWrap: "wrap" },
  handledItem: {
    width: "33.33%",
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: L.hairline,
    borderTopColor: C.RULE,
    paddingVertical: 6,
    paddingRight: 10,
  },
  handledText: { fontSize: T.body, color: C.INK },

  cta: {
    backgroundColor: C.INK,
    borderRadius: L.radius,
    flexDirection: "row",
    padding: 16,
    marginTop: "auto",
  },
  ctaLeft: { flex: 1.5, paddingRight: 16 },
  ctaDivider: { width: L.hairline, backgroundColor: C.ON_DARK_MUTED, opacity: 0.4 },
  ctaRight: { flex: 1, paddingLeft: 16, alignItems: "center" },
  ctaLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
    marginBottom: 8,
  },
  ctaHead: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: T.trackTight,
    color: C.ON_DARK,
    lineHeight: 1.2,
    marginBottom: 10,
  },
  ctaPoint: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  ctaPointText: { fontSize: T.body, color: C.ON_DARK_MUTED, flex: 1, lineHeight: 1.4 },
  ctaBody: { fontSize: T.body, color: C.ON_DARK_MUTED, lineHeight: 1.4 },
  ctaActions: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  ctaButton: {
    backgroundColor: C.ACCENT,
    borderRadius: L.radius,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 12,
  },
  ctaButtonText: { fontFamily: sans, fontWeight: 700, fontSize: T.body, color: C.INK },
  ctaEmail: { fontSize: T.body, color: C.ON_DARK, textDecoration: "underline" },
  qr: { width: 86, height: 86, borderRadius: 2 },
  qrCaption: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.ON_DARK_MUTED,
    marginTop: 8,
    marginBottom: 3,
  },
  qrLink: {
    fontSize: T.micro,
    color: C.ACCENT,
    textAlign: "center",
    textDecoration: "underline",
  },
});

/**
 * Page 06 — the plan, and the ask.
 *
 * On a long-let recommendation the booking CTA is dropped: the product routes
 * those leads straight to the figures rather than a sales call, so the report
 * shouldn't argue the other way.
 */
export function Page6Plan({ data }: { data: PdfReportData }) {
  const { growth } = data;
  const isLongLet = data.recommendation === "LONG_LET";

  const gr = data.guaranteedRent;
  const hasOffer = Boolean(gr?.hasOffer && gr.offerRentMonthly);
  const offerMonthly = gr?.offerRentMonthly ?? 0;
  const offerAnnual = offerMonthly * 12;
  const askAnnual = (gr?.desiredRentMonthly ?? 0) * 12;
  const offerVsAsk = offerAnnual - askAnnual;

  const steps = hasOffer ? GUARANTEED_STEPS : STEPS;
  const handled = hasOffer ? GUARANTEED_HANDLED : HANDLED;

  return (
    <ReportPage meta={data.meta} page={6}>
      <Eyebrow>06 — THE PLAN</Eyebrow>
      <Heading>{hasOffer ? "What happens next" : "How Stayful grows your returns"}</Heading>
      <Lede>
        {hasOffer
          ? "A fixed rent every month. We take on the property, the guests and the costs."
          : "We build direct bookings systematically, without any extra effort from you."}
      </Lede>

      <View style={s.timeline}>
        <View style={s.dotRow}>
          {steps.map((step, i) => (
            <View key={step.n} style={s.dotCell}>
              <View style={[s.dot, ...(i === steps.length - 1 ? [s.dotFilled] : [])]} />
              {i < steps.length - 1 ? <View style={s.connector} /> : null}
            </View>
          ))}
        </View>
        <View style={s.stepRow}>
          {steps.map((step) => (
            <View key={step.n} style={s.step}>
              <Text style={s.stepNum}>{step.n}</Text>
              <Text style={s.stepTitle}>{step.title}</Text>
              <Text style={s.stepBody}>{step.body}</Text>
            </View>
          ))}
        </View>
      </View>

      {hasOffer ? (
        <>
          {/* Under a guaranteed rent the landlord's income is fixed, so the
              growth projection this page carries for management leads would be
              showing them income they will not receive. These are the terms of
              the offer instead. */}
          <Text style={s.sectionLabel}>YOUR GUARANTEED RENT</Text>
          <View style={s.metricRow}>
            <View style={s.metric}>
              <Text style={s.metricValue}>{formatGbp(offerMonthly)}</Text>
              <Text style={s.metricName}>Every month</Text>
              <Text style={s.metricSub}>Booked or empty, the figure does not move</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>{formatGbp(offerAnnual)}</Text>
              <Text style={s.metricName}>Across twelve months</Text>
              <Text style={s.metricSub}>Before any costs, because there are none</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>
                {gr?.offerMeetsAsk ? formatGbp(askAnnual) : formatGbpSigned(offerVsAsk)}
              </Text>
              <Text style={s.metricName}>
                {gr?.offerMeetsAsk ? "Your asking rent" : "Against your asking rent"}
              </Text>
              <Text style={s.metricSub}>
                {gr?.offerMeetsAsk
                  ? "Matched in full, with nothing deducted"
                  : "The gap we should talk through on the call"}
              </Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>{formatGbp(0)}</Text>
              <Text style={s.metricName}>Your costs</Text>
              <Text style={s.metricSub}>Setup, cleaning, management and voids are ours</Text>
            </View>
          </View>
        </>
      ) : (
        <>
          <Text style={s.sectionLabel}>36-MONTH INCOME GROWTH PROJECTION</Text>
          <View style={s.metricRow}>
            <View style={s.metric}>
              <Text style={s.metricValue}>{growth.directBookingPctMonth36}%</Text>
              <Text style={s.metricName}>Direct bookings by month 36</Text>
              <Text style={s.metricSub}>Platform fee removed on half your revenue</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>{growth.repeatCustomers}</Text>
              <Text style={s.metricName}>Repeat customers</Text>
              <Text style={s.metricSub}>Built organically over three years</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>{growth.platformFeeSavingsPct}%</Text>
              <Text style={s.metricName}>Platform fee saved</Text>
              <Text style={s.metricSub}>On every direct booking</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>{formatGbpSigned(growth.extraMonthlyProfitYr3)}</Text>
              <Text style={s.metricName}>Extra monthly profit</Text>
              <Text style={s.metricSub}>By year 3, above the year-1 baseline</Text>
            </View>
          </View>
        </>
      )}

      <Text style={s.sectionLabel}>STAYFUL HANDLES EVERYTHING</Text>
      <View style={s.handledGrid}>
        {handled.map((item) => (
          <View key={item} style={s.handledItem}>
            <Check />
            <Text style={s.handledText}>{item}</Text>
          </View>
        ))}
      </View>

      {isLongLet ? (
        <View style={s.cta}>
          <View style={s.ctaLeft}>
            <Text style={s.ctaLabel}>NEXT STEP</Text>
            <Text style={s.ctaHead}>A long-term let looks like the stronger option here</Text>
            <Text style={s.ctaBody}>
              On these figures a long-term let is ahead, so we won&apos;t push you towards a
              short-let. If your circumstances change — or you want a second opinion on the
              numbers in this report — we&apos;re happy to talk it through.
            </Text>
            <View style={s.ctaActions}>
              <Link src="mailto:info@stayful.co.uk" style={s.ctaEmail}>
                info@stayful.co.uk
              </Link>
            </View>
          </View>
        </View>
      ) : (
        <View style={s.cta}>
          <View style={s.ctaLeft}>
            <Text style={s.ctaLabel}>NEXT STEP · FREE 30-MINUTE CALL</Text>
            <Text style={s.ctaHead}>
              {hasOffer
                ? `Confirm your guaranteed rent of ${formatGbp(offerMonthly)} a month`
                : "Book your Airbnb Profitability Action Plan"}
            </Text>
            {(hasOffer ? GUARANTEED_CTA_POINTS : CTA_POINTS).map((p) => (
              <View key={p} style={s.ctaPoint}>
                <Check color={C.ACCENT} />
                <Text style={s.ctaPointText}>{p}</Text>
              </View>
            ))}
            <View style={s.ctaActions}>
              <Link src={BOOKING_URL} style={s.ctaButton}>
                <Text style={s.ctaButtonText}>Book your call  →</Text>
              </Link>
              <Link src="mailto:info@stayful.co.uk" style={s.ctaEmail}>
                info@stayful.co.uk
              </Link>
            </View>
          </View>

          <View style={s.ctaDivider} />

          <View style={s.ctaRight}>
            <Image src={QR_PATH} style={s.qr} />
            <Text style={s.qrCaption}>SCAN TO BOOK</Text>
            <Link src={BOOKING_URL} style={s.qrLink}>
              {BOOKING_LABEL}
            </Link>
          </View>
        </View>
      )}
    </ReportPage>
  );
}
