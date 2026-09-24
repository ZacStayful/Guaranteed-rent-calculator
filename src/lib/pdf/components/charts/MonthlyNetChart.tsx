import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS as C, PDF_TYPE as T, fontFamily } from "../../theme";
import { formatGbp, formatAxisMoney } from "../format";
import type { PdfMonth } from "../../derive";

const mono = fontFamily("MONO");

const CHART_HEIGHT = 200;
const AXIS_WIDTH = 26;

const s = StyleSheet.create({
  wrap: { flexDirection: "row" },
  axis: { width: AXIS_WIDTH, height: CHART_HEIGHT, justifyContent: "space-between" },
  axisLabel: { fontFamily: mono, fontSize: 6.5, color: C.MUTED, textAlign: "right" },
  plot: { flex: 1, height: CHART_HEIGHT, position: "relative" },
  gridline: { position: "absolute", left: 0, right: 0, height: 0.4, backgroundColor: C.RULE },
  bars: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  col: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  valueLabel: { fontFamily: mono, fontSize: 6, color: C.INK, marginBottom: 2 },
  bar: { width: "62%", borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 },
  monthRow: { flexDirection: "row", marginLeft: AXIS_WIDTH, marginTop: 4 },
  monthCell: {
    flex: 1,
    fontFamily: mono,
    fontSize: 6.5,
    color: C.MUTED,
    textAlign: "center",
  },
  legend: { flexDirection: "row", alignItems: "center", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendText: { fontSize: T.micro, color: C.MUTED },
  swatch: { width: 5, height: 5, borderRadius: 1, backgroundColor: C.GREEN, marginRight: 4 },
  dashRow: { flexDirection: "row", width: 14, marginRight: 4, alignItems: "center" },
  dash: { width: 3, height: 0.8, backgroundColor: C.INK, marginRight: 1.5 },
  refLine: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center" },
  refDash: { width: 4, height: 0.8, backgroundColor: C.INK, marginRight: 2.5 },
});

/**
 * Twelve months of net income as bars, with the peak months picked out and the
 * long-let monthly net drawn across as a dashed reference — so the reader can
 * see at a glance which months beat it and by how much.
 */
export function MonthlyNetChart({
  months,
  longLetMonthlyNet,
}: {
  months: PdfMonth[];
  longLetMonthlyNet: number;
}) {
  if (months.length === 0) return null;

  // `PdfMonth.peak` flags the top three months; the chart picks out only the
  // single best one, which is the month the PEAK footnote names.
  const bestNet = Math.max(...months.map((m) => m.net));
  const peakNet = Math.max(...months.map((m) => m.net), longLetMonthlyNet, 1);
  // Round the scale up to a clean step so the axis labels read well.
  const step = peakNet > 2000 ? 1000 : 500;
  const scaleMax = Math.max(step, Math.ceil((peakNet * 1.15) / step) * step);

  const ticks: number[] = [];
  for (let v = scaleMax; v >= 0; v -= step / (scaleMax > 2000 ? 1 : 2)) ticks.push(v);

  const refPct = Math.max(0, Math.min(100, (longLetMonthlyNet / scaleMax) * 100));

  return (
    <View>
      <View style={s.wrap}>
        <View style={s.axis}>
          {ticks.map((t, i) => (
            <Text key={i} style={s.axisLabel}>
              {formatAxisMoney(t)}
            </Text>
          ))}
        </View>
        <View style={s.plot}>
          {ticks.map((t, i) => (
            <View key={i} style={[s.gridline, { bottom: (t / scaleMax) * CHART_HEIGHT }]} />
          ))}
          <View style={s.bars}>
            {months.map((m) => {
              const h = Math.max(2, (m.net / scaleMax) * CHART_HEIGHT);
              return (
                <View key={m.month} style={s.col}>
                  <Text style={s.valueLabel}>{formatGbp(m.net)}</Text>
                  <View
                    style={[
                      s.bar,
                      { height: h, backgroundColor: m.net === bestNet ? C.INK : C.GREEN },
                    ]}
                  />
                </View>
              );
            })}
          </View>
          {/* Long-let reference, drawn last so it sits over the bars. */}
          {longLetMonthlyNet > 0 ? (
            <View style={[s.refLine, { bottom: (refPct / 100) * CHART_HEIGHT }]}>
              {Array.from({ length: 62 }, (_, i) => (
                <View key={i} style={s.refDash} />
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <View style={s.monthRow}>
        {months.map((m) => (
          <Text key={m.month} style={s.monthCell}>
            {m.short}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Legend for the chart above, placed by the caller beside the section label. */
export function MonthlyNetLegend({ longLetMonthlyNet }: { longLetMonthlyNet: number }) {
  return (
    <View style={s.legend}>
      <View style={s.legendItem}>
        <View style={s.swatch} />
        <Text style={s.legendText}>Short-term let</Text>
      </View>
      <View style={s.legendItem}>
        <View style={s.dashRow}>
          {Array.from({ length: 4 }, (_, i) => (
            <View key={i} style={s.dash} />
          ))}
        </View>
        <Text style={s.legendText}>Long-term let {formatGbp(longLetMonthlyNet)}</Text>
      </View>
    </View>
  );
}
