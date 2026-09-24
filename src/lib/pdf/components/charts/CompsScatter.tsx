import React from "react";
import { View, Text, Svg, Circle, Line, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS as C, PDF_TYPE as T, CONTENT_WIDTH, fontFamily } from "../../theme";
import { formatGbp, formatPercent } from "../format";
import type { PdfComparable } from "../../derive";

const mono = fontFamily("MONO");

const PLOT_W = CONTENT_WIDTH - 30;
const PLOT_H = 100;

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  label: { fontFamily: mono, fontSize: T.label, letterSpacing: T.trackWide, color: C.INK },
  legend: { flexDirection: "row", alignItems: "center", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendText: { fontSize: T.micro, color: C.MUTED },
  wrap: { flexDirection: "row" },
  plot: { position: "relative" },
  yAxis: { width: 30, height: PLOT_H, justifyContent: "space-between" },
  yLabel: { fontFamily: mono, fontSize: 6.5, color: C.MUTED, textAlign: "right", paddingRight: 4 },
  xRow: { marginLeft: 30, marginTop: 3, height: 9, position: "relative" },
  xLabel: { position: "absolute", fontFamily: mono, fontSize: 6.5, color: C.MUTED },
  empty: {
    height: PLOT_H,
    borderWidth: 0.6,
    borderColor: C.RULE,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: T.micro, color: C.MUTED },
  callout: { position: "absolute", fontFamily: mono, fontSize: 6.5, color: C.INK },
});

const Y_TICKS = [100, 75, 50, 25, 0];

/**
 * Nightly rate across, occupancy up — the two levers that set revenue. Filled
 * dots are the top quartile by annual revenue; the ringed dot is this property,
 * so the reader can see where they'd land in the local market.
 */
export function CompsScatter({
  comparables,
  yourNightly,
  yourOccupancy,
}: {
  comparables: PdfComparable[];
  yourNightly: number;
  yourOccupancy: number;
}) {
  const nightlyValues = [...comparables.map((c) => c.nightly), yourNightly].filter(
    (n) => n > 0,
  );

  if (comparables.length === 0 || nightlyValues.length === 0) {
    return (
      <View>
        <View style={s.head}>
          <Text style={s.label}>NIGHTLY RATE (ACROSS) VS OCCUPANCY (UP)</Text>
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>No comparable listings found in this area.</Text>
        </View>
      </View>
    );
  }

  // Pad the x-domain to a round £50 step so the axis labels are readable.
  const rawMin = Math.min(...nightlyValues);
  const rawMax = Math.max(...nightlyValues);
  const xMin = Math.max(0, Math.floor((rawMin - 20) / 50) * 50);
  const xMax = Math.max(xMin + 50, Math.ceil((rawMax + 20) / 50) * 50);

  const xTicks: number[] = [];
  for (let v = xMin + 50; v < xMax; v += 50) xTicks.push(v);

  const px = (nightly: number) => ((nightly - xMin) / (xMax - xMin)) * PLOT_W;
  const py = (occ: number) => PLOT_H - Math.max(0, Math.min(1, occ)) * PLOT_H;

  const yourX = px(yourNightly);
  const yourY = py(yourOccupancy);
  // Anchor the callout to the marker, but keep it inside the plot: flip it to
  // the left of the marker when there isn't room on the right.
  const CALLOUT_W = 132;
  const flip = yourX + 10 + CALLOUT_W > PLOT_W;
  const calloutLeft = flip
    ? Math.max(0, yourX - 10 - CALLOUT_W)
    : Math.min(yourX + 10, PLOT_W - CALLOUT_W);
  const calloutTop = Math.max(0, Math.min(yourY - 16, PLOT_H - 10));

  return (
    <View>
      <View style={s.head}>
        <Text style={s.label}>NIGHTLY RATE (ACROSS) VS OCCUPANCY (UP)</Text>
        <View style={s.legend}>
          <View style={s.legendItem}>
            <Svg width={8} height={8} viewBox="0 0 8 8" style={{ marginRight: 4 }}>
              <Circle cx={4} cy={4} r={3} fill={C.INK} />
            </Svg>
            <Text style={s.legendText}>Top 25%</Text>
          </View>
          <View style={s.legendItem}>
            <Svg width={8} height={8} viewBox="0 0 8 8" style={{ marginRight: 4 }}>
              <Circle cx={4} cy={4} r={2.6} fill="none" stroke={C.MUTED} strokeWidth={0.8} />
            </Svg>
            <Text style={s.legendText}>Other listings</Text>
          </View>
        </View>
      </View>

      <View style={s.wrap}>
        <View style={s.yAxis}>
          {Y_TICKS.map((t) => (
            <Text key={t} style={s.yLabel}>
              {t}%
            </Text>
          ))}
        </View>
        <View style={s.plot}>
        <Svg width={PLOT_W} height={PLOT_H}>
          {Y_TICKS.map((t) => (
            <Line
              key={`h${t}`}
              x1={0}
              y1={py(t / 100)}
              x2={PLOT_W}
              y2={py(t / 100)}
              stroke={C.RULE}
              strokeWidth={0.4}
            />
          ))}
          {xTicks.map((t) => (
            <Line
              key={`v${t}`}
              x1={px(t)}
              y1={0}
              x2={px(t)}
              y2={PLOT_H}
              stroke={C.RULE}
              strokeWidth={0.4}
            />
          ))}
          {comparables.map((c, i) =>
            c.nightly > 0 ? (
              <Circle
                key={i}
                cx={px(c.nightly)}
                cy={py(c.occupancy)}
                r={2.6}
                fill={c.top ? C.INK : "none"}
                stroke={c.top ? C.INK : C.MUTED}
                strokeWidth={0.8}
              />
            ) : null,
          )}
          {/* This property: a target ring so it reads as the subject, not a comp. */}
          <Circle
            cx={yourX}
            cy={yourY}
            r={6}
            fill="none"
            stroke={C.GREEN}
            strokeWidth={0.6}
            strokeDasharray="1.5 1.5"
          />
          <Circle cx={yourX} cy={yourY} r={3} fill={C.GREEN} />
          {/* Leader from the marker out to its label. */}
          <Line
            x1={flip ? yourX - 7 : yourX + 7}
            y1={yourY}
            x2={flip ? calloutLeft + CALLOUT_W : calloutLeft}
            y2={calloutTop + 6}
            stroke={C.GREEN}
            strokeWidth={0.5}
          />
        </Svg>
        <Text
          style={[
            s.callout,
            { left: calloutLeft, top: calloutTop, width: CALLOUT_W },
            ...(flip ? [{ textAlign: "right" as const }] : []),
          ]}
        >
          YOUR PROPERTY · {formatGbp(yourNightly)} · {formatPercent(yourOccupancy)}
        </Text>
        </View>
      </View>

      <View style={s.xRow}>
        {xTicks.map((t) => (
          <Text key={t} style={[s.xLabel, { left: px(t) - 12 }]}>
            {formatGbp(t)}
          </Text>
        ))}
      </View>
    </View>
  );
}
