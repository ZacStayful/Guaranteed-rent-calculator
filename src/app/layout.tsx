import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { PREFILL_GUARD_SCRIPT } from "@/lib/linkParams";
import { Consent } from "@/components/Consent";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stayful Guaranteed Rent Calculator | Fixed Monthly Rent for Landlords",
  description:
    "Find out what Stayful will pay you in guaranteed rent, and what your property could earn as a short-term let. Real market data, a fixed monthly figure, and no costs or void periods on your side.",
  generator: "Stayful",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-light-32x32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark-32x32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-icon.png",
  },
};

// Inlined at build time. When it is not set the pixel is not loaded at all,
// rather than starting with an id of "undefined" that Meta rejects.
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} font-sans antialiased`}
      >
        {children}
        {/* Takes the visitor's email, address and postcode out of the address
            bar before anything else runs, so neither the pixel nor Google
            Analytics ever sends them on (src/lib/linkParams.ts,
            PREFILL_GUARD_SCRIPT). */}
        <Script id="prefill-guard" strategy="beforeInteractive">
          {PREFILL_GUARD_SCRIPT}
        </Script>
        {/* The cookie banner. The Meta pixel and Google Analytics start only
            after Accept (src/components/Consent.tsx). */}
        <Consent pixelId={META_PIXEL_ID} />
      </body>
    </html>
  );
}
