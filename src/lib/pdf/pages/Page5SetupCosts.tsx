import React from "react";
import { View, Text, StyleSheet, Svg, Circle, Path } from "@react-pdf/renderer";
import {
  PDF_COLORS as C,
  PDF_LAYOUT as L,
  PDF_TYPE as T,
  PDF_RAMP,
  fontFamily,
} from "../theme";
import { ReportPage, Eyebrow, Heading, Lede, Swatch, StackedBar } from "../components/Primitives";
import { formatGbp, formatPaybackMonths, clamp } from "../components/format";
import { planSetupRows } from "../derive";
import type { PdfReportData } from "../derive";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  callout: {
    flexDirection: "row",
    borderWidth: L.hairline,
    borderColor: C.RULE,
    borderRadius: L.radius,
    backgroundColor: C.SURFACE_LIGHT,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 12,
  },
  calloutBody: { flex: 1, paddingLeft: 8 },
  calloutLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.INK,
    marginBottom: 4,
  },
  calloutText: { fontSize: T.micro, color: C.MUTED, lineHeight: 1.4 },

  panel: {
    backgroundColor: C.INK,
    borderRadius: L.radius,
    flexDirection: "row",
    padding: 14,
    marginBottom: 12,
  },
  panelCol: { flex: 1 },
  panelDivider: {
    width: L.hairline,
    backgroundColor: C.ON_DARK_MUTED,
    opacity: 0.4,
    marginHorizontal: 14,
  },
  panelLabel: {
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.ON_DARK_MUTED,
    marginBottom: 6,
  },
  panelFigure: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.panelFigure,
    letterSpacing: T.trackTight,
    color: C.ON_DARK,
    marginBottom: 6,
  },
  panelFigureAccent: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 28,
    letterSpacing: T.trackTight,
    color: C.ACCENT,
    marginBottom: 6,
  },
  panelMeta: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.ON_DARK_MUTED,
  },
  panelNote: { fontSize: T.micro, color: C.ON_DARK_MUTED, lineHeight: 1.4 },

  legend: { flexDirection: "row", flexWrap: "wrap", marginTop: 7, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 14, marginBottom: 4 },
  legendText: { fontSize: T.micro, color: C.INK },

  tableHead: {
    flexDirection: "row",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingBottom: 5,
    marginTop: 8,
  },
  th: { fontFamily: mono, fontSize: T.micro, letterSpacing: 0.8, color: C.MUTED },
  cItem: { flex: 1, paddingRight: 6 },
  cSupplier: { width: 70 },
  cQty: { width: 34, textAlign: "right" },
  cUnit: { width: 46, textAlign: "right" },
  cTotal: { width: 52, textAlign: "right" },

  catRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingVertical: 5,
  },
  catName: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  catLabel: {
    fontFamily: mono,
    fontSize: T.micro,
    letterSpacing: 0.8,
    color: C.INK,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: L.hairline,
    borderBottomColor: C.RULE,
    paddingVertical: 4,
  },
  itemName: { flex: 1, paddingRight: 6, paddingLeft: 10, fontSize: T.body, color: C.INK },
  supplier: { width: 70, fontSize: T.body, color: C.MUTED },
  num: { fontFamily: mono, fontSize: T.body, color: C.INK },
  numStrong: { fontFamily: mono, fontSize: T.body, fontWeight: 700, color: C.INK },
  overflowRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  overflowText: { flex: 1, paddingLeft: 10, fontFamily: mono, fontSize: T.micro, color: C.MUTED },

  grandRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1.2,
    borderTopColor: C.INK,
    paddingTop: 9,
    marginTop: "auto",
  },
  grandLabel: {
    flex: 1,
    fontFamily: mono,
    fontSize: T.label,
    letterSpacing: T.trackWide,
    color: C.INK,
  },
  grandValue: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: T.figureSm,
    letterSpacing: T.trackTight,
    color: C.INK,
  },
  emptyNote: { fontSize: T.body, color: C.MUTED, paddingVertical: 20, textAlign: "center" },
});

/** A circled "i" for the indicative-estimate callout. */
function InfoMark() {
  return (
    <Svg width={11} height={11} viewBox="0 0 12 12" style={{ marginTop: 1 }}>
      <Circle cx={6} cy={6} r={5.2} fill="none" stroke={C.MUTED} strokeWidth={0.8} />
      <Path d="M6 5.2 L6 8.6" stroke={C.MUTED} strokeWidth={1.1} strokeLinecap="round" />
      <Circle cx={6} cy={3.4} r={0.65} fill={C.MUTED} />
    </Svg>
  );
}

/**
 * Page 05 — setup costs.
 *
 * Always rendered. When the lead never filled in the setup calculator these
 * are Stayful's typical figures for a property of this size, and the page says
 * so rather than presenting them as a quote.
 */
export function Page5SetupCosts({ data }: { data: PdfReportData }) {
  const setup = data.setup;

  if (!setup) {
    return (
      <ReportPage meta={data.meta} page={5}>
        <Eyebrow>05 — SETUP COSTS</Eyebrow>
        <Heading>What it takes to get launch-ready</Heading>
        <Text style={s.emptyNote}>
          Setup costs weren&apos;t available for this property.
        </Text>
      </ReportPage>
    );
  }

  const rows = planSetupRows(setup.categories);
  const categoryTotals = setup.categories.map((c) => c.subtotal);
  const rampFor = (category: string) => {
    const i = setup.categories.findIndex((c) => c.category === category);
    return PDF_RAMP[(i < 0 ? 0 : i) % PDF_RAMP.length];
  };

  return (
    <ReportPage meta={data.meta} page={5}>
      <Eyebrow>05 — SETUP COSTS</Eyebrow>
      <Heading>What it takes to get launch-ready</Heading>
      <Lede>
        Itemised estimate for this property, {setup.furnishingLabel.toLowerCase()}. All
        figures inclusive, supplier noted per item.
      </Lede>

      {setup.indicative ? (
        <View style={s.callout}>
          <InfoMark />
          <View style={s.calloutBody}>
            <Text style={s.calloutLabel}>INDICATIVE ESTIMATE</Text>
            <Text style={s.calloutText}>
              You didn&apos;t give us your property&apos;s setup details when you
              enquired, so these figures are based on a typical property of this size
              and may be inaccurate. Your actual costs, and the payback period, could
              be higher or lower.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={s.panel}>
        <View style={s.panelCol}>
          <Text style={s.panelLabel}>TOTAL SETUP INVESTMENT</Text>
          <Text style={s.panelFigure}>{formatGbp(setup.grandTotal)}</Text>
          <Text style={s.panelMeta}>
            {setup.furnishingLabel.toUpperCase()} · {setup.bedrooms}{" "}
            {setup.bedrooms === 1 ? "BEDROOM" : "BEDROOMS"} · {setup.itemCount}{" "}
            {setup.itemCount === 1 ? "ITEM" : "ITEMS"}
          </Text>
        </View>

        <View style={s.panelDivider} />

        <View style={s.panelCol}>
          <Text style={s.panelLabel}>PAYBACK · INDICATIVE</Text>
          {data.setupPaybackMonths !== null ? (
            <>
              <Text style={s.panelFigureAccent}>
                {formatPaybackMonths(data.setupPaybackMonths)}
              </Text>
              <Text style={s.panelNote}>
                {formatGbp(setup.grandTotal)} ÷ {formatGbp(data.strVsLtl.monthlyDiff)} a
                month extra over a long-term let.
              </Text>
            </>
          ) : (
            <Text style={s.panelNote}>
              A long-term let is the stronger option for this property, so there is no
              payback period to quote against it.
            </Text>
          )}
        </View>
      </View>

      <StackedBar values={categoryTotals} />
      <View style={s.legend}>
        {setup.categories.map((c, i) => (
          <View key={c.category} style={s.legendItem}>
            <Swatch color={PDF_RAMP[i % PDF_RAMP.length]} />
            <Text style={s.legendText}>
              {c.category} {formatGbp(c.subtotal)}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.tableHead}>
        <Text style={[s.th, s.cItem]}>ITEM</Text>
        <Text style={[s.th, s.cSupplier]}>SUPPLIER</Text>
        <Text style={[s.th, s.cQty]}>QTY</Text>
        <Text style={[s.th, s.cUnit]}>UNIT</Text>
        <Text style={[s.th, s.cTotal]}>TOTAL</Text>
      </View>

      {rows.map((row, i) => {
        if (row.kind === "category") {
          return (
            <View key={`c${i}`} style={s.catRow}>
              <View style={s.catName}>
                <Swatch color={rampFor(row.category)} />
                <Text style={s.catLabel}>{row.category.toUpperCase()}</Text>
              </View>
              <Text style={[s.num, s.cSupplier]} />
              <Text style={[s.num, s.cQty]} />
              <Text style={[s.num, s.cUnit]} />
              <Text style={[s.numStrong, s.cTotal]}>{formatGbp(row.subtotal)}</Text>
            </View>
          );
        }
        if (row.kind === "item") {
          return (
            <View key={`i${row.item.id}-${i}`} style={s.itemRow}>
              <Text style={s.itemName}>{clamp(row.item.name, 40)}</Text>
              <Text style={s.supplier}>{clamp(row.item.supplier, 12)}</Text>
              <Text style={[s.num, s.cQty]}>{row.item.qty}</Text>
              <Text style={[s.num, s.cUnit]}>{formatGbp(row.item.unitCost)}</Text>
              <Text style={[s.num, s.cTotal]}>{formatGbp(row.item.total)}</Text>
            </View>
          );
        }
        return (
          <View key={`o${i}`} style={s.overflowRow}>
            <Text style={s.overflowText}>
              + {row.count} further {row.count === 1 ? "item" : "items"}
            </Text>
            <Text style={[s.num, s.cSupplier]} />
            <Text style={[s.num, s.cQty]} />
            <Text style={[s.num, s.cUnit]} />
            <Text style={[s.num, s.cTotal]}>{formatGbp(row.total)}</Text>
          </View>
        );
      })}

      <View style={s.grandRow}>
        <Text style={s.grandLabel}>GRAND TOTAL</Text>
        <Text style={s.grandValue}>{formatGbp(setup.grandTotal)}</Text>
      </View>
    </ReportPage>
  );
}
