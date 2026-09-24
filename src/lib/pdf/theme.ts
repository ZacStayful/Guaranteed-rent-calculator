/**
 * Design tokens for the Stayful property income analysis PDF.
 *
 * Every value here was sampled from the approved design spec (a 6-page A4
 * report). Edit tokens, not the page components — the pages compose from
 * these so the whole document stays in step.
 */

import path from "node:path";

// ─── Palette ─────────────────────────────────────────────────────
// A single sage/olive family. Light surfaces on a sage page, with one very
// dark green used for panels and ink. ACCENT is only ever used on INK.
export const PDF_COLORS = {
  /** Page background. Also the baked-in background of the logo asset. */
  PAPER: "#d2d6bd",
  /** Stat cards, light panels, table fills. */
  SURFACE: "#dee1cc",
  /** Lightest tint — inset fills, and text on INK. */
  SURFACE_LIGHT: "#e6ead9",
  /** Dark panels, headlines, body copy. */
  INK: "#1f2c1b",
  /** Primary green — wordmark, chart bars, strong rules. */
  GREEN: "#67815c",
  /** Bright green. Figures and bars **on INK only** (fails contrast on PAPER). */
  ACCENT: "#a4c191",
  /** Secondary text on PAPER, and the long-let comparison bar. */
  MUTED: "#7c8a70",
  /** Hairlines and card borders. */
  RULE: "#aab096",
  /** Primary text on INK. */
  ON_DARK: "#e6ead9",
  /** Secondary text and labels on INK. */
  ON_DARK_MUTED: "#aebba7",
} as const;

/**
 * Descending tint ramp for segmented bars — the page-02 cost breakdown and
 * the page-05 setup categories. Index 0 is the strongest.
 */
export const PDF_RAMP = ["#67815c", "#8ca07d", "#a8b498", "#bdc5aa", "#cdd2ba"] as const;

// ─── Typography ──────────────────────────────────────────────────
// Two families: a geometric sans for headlines and figures, a monospace for
// every label, eyebrow, badge and numeric table column.
export const PDF_FONTS = {
  SANS: "Space Grotesk",
  MONO: "JetBrains Mono",
} as const;

export const PDF_TYPE = {
  /** Page-01 property address. Steps down for long addresses — see pickH1Size. */
  h1: 30,
  /** Page-02..06 section headline. */
  h2: 22,
  /** Page-01 hero figure. */
  heroFigure: 36,
  /** Figures inside dark panels. */
  panelFigure: 34,
  /** Stat card values. */
  cardValue: 20,
  /** Smaller emphasised figures (benchmark strip, growth cards). */
  figureSm: 17,
  /** Body copy and table cells. */
  body: 9,
  /** Lede under a section headline. */
  lede: 9.5,
  /** Mono labels, eyebrows, badges, table headers. */
  label: 8,
  /** Footnotes, footer, captions. */
  micro: 7.5,
  /** Letter-spacing for uppercase mono. */
  trackWide: 1.2,
  trackTight: -0.4,
} as const;

/** The design's H1 fits 2 lines at ~31 characters. Step down past that. */
export function pickH1Size(address: string): number {
  if (address.length > 56) return 21;
  if (address.length > 44) return 24;
  if (address.length > 34) return 27;
  return PDF_TYPE.h1;
}

// ─── Layout ──────────────────────────────────────────────────────
export const PDF_LAYOUT = {
  /** A4 in points. */
  pageWidth: 595.28,
  pageHeight: 841.89,
  marginX: 36,
  marginTop: 30,
  marginBottom: 30,
  /** Reserved band for the fixed header / footer. */
  headerHeight: 46,
  headerHeightFirst: 74,
  footerHeight: 26,
  gutter: 8,
  radius: 3,
  hairline: 0.6,
} as const;

/** Usable content width inside the page margins. */
export const CONTENT_WIDTH = PDF_LAYOUT.pageWidth - PDF_LAYOUT.marginX * 2;

// ─── Cost model ──────────────────────────────────────────────────
// Single source of truth for the percentages the report deducts. These mirror
// `analysis.ts`, where shortLetNetAnnual = gross × 0.52 and
// longLetNetAnnual = gross × 0.90, so the page-02 rows reconcile to the net
// line exactly. Change them here and the labels and arithmetic move together.
export const PDF_COST_RATES = {
  PLATFORM: 0.15,
  MANAGEMENT: 0.15,
  CLEANING: 0.18,
  /** 1 − TOTAL is the net ratio the engine applies. */
  TOTAL: 0.48,
  LTL_AGENT: 0.10,
} as const;

// ─── Font registration ───────────────────────────────────────────
// The TTFs live under `src/lib/pdf/fonts`, not `public/` — Vercel serves
// public/ from the CDN and leaves it out of the function bundle, and these are
// read off the filesystem at request time. next.config.ts adds them to
// `outputFileTracingIncludes` for every route that renders a report.
const FONT_FILES = {
  SANS: [
    { file: "SpaceGrotesk-Medium.ttf", fontWeight: 500 as const },
    { file: "SpaceGrotesk-Bold.ttf", fontWeight: 700 as const },
  ],
  // Two mono weights: nothing in the report asks for mono at 500, and an
  // unused face is dead weight in four function bundles.
  MONO: [
    { file: "JetBrainsMono-Regular.ttf", fontWeight: 400 as const },
    { file: "JetBrainsMono-Bold.ttf", fontWeight: 700 as const },
  ],
} as const;

/**
 * Absolute path to a report font.
 *
 * Deliberately a single, statically-written path with no filesystem probing:
 * anything more dynamic here makes the bundler trace the whole project into
 * every route that renders a report (README, docs, package-lock and all), and
 * these files are committed to the repo and declared in next.config.ts's
 * `outputFileTracingIncludes`. `src/lib/pdf/fonts` is checked by
 * `assets.test.ts`, and the build verifies they reach each route's trace.
 */
function fontPath(file: string): string {
  return path.join(process.cwd(), "src/lib/pdf/fonts", file);
}

/** The minimal slice of `@react-pdf/renderer`'s `Font` that we use. */
export interface FontStoreLike {
  register: (opts: {
    family: string;
    fonts: Array<{ src: string; fontWeight: number }>;
  }) => void;
  registerHyphenationCallback: (cb: (word: string) => string[]) => void;
}

// `@react-pdf/renderer` can end up instantiated more than once in a process
// (different resolutions of the same package), and each instance carries its
// own font store. Registering into the wrong one fails at layout time with
// "Font family not registered", so track which stores we've done rather than
// using a single module-level flag.
const registeredStores = new WeakSet<FontStoreLike>();

/**
 * Register the report fonts into `font` — which must be the `Font` export from
 * the same `@react-pdf/renderer` instance that will perform the render. Call
 * it from the render entry point (see `renderReport`), not from a component.
 *
 * Idempotent per store. A missing font directory is not fatal: this document
 * sits on the lead pipeline — /api/analyse uploads it to Monday on every
 * completed analysis — so it renders on the built-in Helvetica rather than
 * throwing. It will look wrong, loudly, and the reason is logged above.
 */
export function registerPdfFonts(font: FontStoreLike): void {
  if (registeredStores.has(font)) return;
  registeredStores.add(font);

  try {
    font.register({
      family: PDF_FONTS.SANS,
      fonts: FONT_FILES.SANS.map((f) => ({
        src: fontPath(f.file),
        fontWeight: f.fontWeight,
      })),
    });
    font.register({
      family: PDF_FONTS.MONO,
      fonts: FONT_FILES.MONO.map((f) => ({
        src: fontPath(f.file),
        fontWeight: f.fontWeight,
      })),
    });
    // Long unbroken strings (listing titles, addresses) should clip rather
    // than be split mid-word with a hyphen.
    font.registerHyphenationCallback((word) => [word]);
  } catch (err) {
    console.error("[pdf] Font registration failed, falling back to Helvetica:", err);
  }
}

/** Which family to use in a stylesheet. */
export function fontFamily(kind: "SANS" | "MONO"): string {
  return kind === "SANS" ? PDF_FONTS.SANS : PDF_FONTS.MONO;
}

/** Every font file the report registers. Used by `assets.test.ts`. */
export function pdfFontPaths(): string[] {
  return [...FONT_FILES.SANS, ...FONT_FILES.MONO].map((f) => fontPath(f.file));
}

