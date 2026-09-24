import React from "react";
import { View, Text, Svg, Circle, Path, Line, G, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS as C, PDF_TYPE as T, fontFamily } from "../../theme";

const mono = fontFamily("MONO");
const sans = fontFamily("SANS");

const s = StyleSheet.create({
  ringWrap: { alignItems: "center", justifyContent: "center", position: "relative" },
  ringValue: {
    position: "absolute",
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 17,
    color: C.ON_DARK,
    textAlign: "center",
  },
  ringOutOf: {
    position: "absolute",
    fontFamily: mono,
    fontSize: 6,
    color: C.ON_DARK_MUTED,
    textAlign: "center",
  },
  needleWrap: { alignItems: "center" },
  scaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -6,
  },
  scaleLabel: { fontFamily: mono, fontSize: T.micro, color: C.MUTED },
  riskLabel: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 19,
    color: C.INK,
    textAlign: "center",
    marginTop: 8,
  },
  riskCaption: {
    fontSize: T.micro,
    color: C.MUTED,
    textAlign: "center",
    marginTop: 3,
  },
});

/**
 * A ring showing a 0–100 score, for the direct-booking panel. Sized for a dark
 * panel, so the track and label use the on-dark tones.
 */
export function RingGauge({
  score,
  size = 54,
}: {
  score: number;
  size?: number;
}) {
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const r = size / 2 - 3;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <View style={[s.ringWrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={C.ON_DARK_MUTED} strokeWidth={2} />
        {pct > 0 ? (
          // Rotate so the arc starts at 12 o'clock and runs clockwise.
          <G transform={`rotate(-90 ${cx} ${cy})`}>
            <Circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={C.ACCENT}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray={`${circumference * pct} ${circumference}`}
            />
          </G>
        ) : null}
      </Svg>
      <Text style={[s.ringValue, { top: size / 2 - 13 }]}>{Math.round(score)}</Text>
      <Text style={[s.ringOutOf, { top: size / 2 + 4 }]}>/ {100}</Text>
    </View>
  );
}

const DIAL_W = 190;
const DIAL_H = 74;

/**
 * A tick-fan dial with a needle, for the risk score.
 *
 * The needle sweeps 180° from low (left) to high (right), so a low score reads
 * as "safe" at a glance without having to parse the number.
 */
export function SpeedometerGauge({ score, outOf = 100 }: { score: number; outOf?: number }) {
  const pct = Math.max(0, Math.min(1, score / outOf));
  const cx = DIAL_W / 2;
  const cy = DIAL_H - 8;
  const rOuter = 62;
  const rInner = 50;
  const needleLen = 44;

  // 180° sweep: pi (left) -> 0 (right).
  const angle = Math.PI - pct * Math.PI;
  const nx = cx + Math.cos(angle) * needleLen;
  const ny = cy - Math.sin(angle) * needleLen;

  const TICKS = 44;
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => {
    const a = Math.PI - (i / TICKS) * Math.PI;
    return {
      x1: cx + Math.cos(a) * rInner,
      y1: cy - Math.sin(a) * rInner,
      x2: cx + Math.cos(a) * rOuter,
      y2: cy - Math.sin(a) * rOuter,
    };
  });

  return (
    <View style={s.needleWrap}>
      <Svg width={DIAL_W} height={DIAL_H}>
        {ticks.map((t, i) => (
          <Line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={C.MUTED}
            strokeWidth={0.5}
          />
        ))}
        <Path
          d={`M ${cx} ${cy} L ${nx} ${ny}`}
          stroke={C.INK}
          strokeWidth={1.4}
          strokeLinecap="round"
        />
        <Circle cx={cx} cy={cy} r={3} fill={C.INK} />
      </Svg>
      <View style={[s.scaleRow, { width: DIAL_W - 30 }]}>
        <Text style={s.scaleLabel}>LOW</Text>
        <Text style={s.scaleLabel}>HIGH</Text>
      </View>
    </View>
  );
}

/** The dial plus its label and caption, as the design stacks them. */
export function RiskDial({ score, label }: { score: number; label: string }) {
  return (
    <View>
      <SpeedometerGauge score={score} />
      <Text style={s.riskLabel}>
        {label} · {Math.round(score)}
        <Text style={{ fontSize: 11, color: C.MUTED }}>/100</Text>
      </Text>
      <Text style={s.riskCaption}>0 = lowest risk, 100 = highest</Text>
    </View>
  );
}
