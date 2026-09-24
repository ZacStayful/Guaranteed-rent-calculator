import type { NextConfig } from "next";

/**
 * Assets the PDF renderer reads off the filesystem at request time: the two
 * report fonts' TTFs, the wordmark and the booking QR.
 *
 * Files under `public/` are served by the CDN and are NOT included in a
 * serverless function bundle, and the fonts deliberately live under `src/` so
 * they're never publicly served — so every route that renders the report has to
 * ask for them explicitly. Missing them fails only at request time in
 * production, which is why `registerPdfFonts()` logs loudly and falls back.
 */
const PDF_RENDER_ASSETS = [
  "src/lib/pdf/fonts/**/*",
  "public/images/stayful-logo.png",
  "public/images/qr-book-call.png",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // The lead's own download.
    "/api/generate-pdf": PDF_RENDER_ASSETS,
    // Renders the report and uploads it to the Monday leads board.
    "/api/analyse": PDF_RENDER_ASSETS,
    // Returns the report as base64 for the lead database.
    "/api/internal/analyse": PDF_RENDER_ASSETS,
    // Bulk worker — same render, behind a concurrency lock.
    "/api/admin/bulk/worker": PDF_RENDER_ASSETS,
  },
};

export default nextConfig;
