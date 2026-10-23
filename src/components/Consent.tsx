"use client";

// The cookie banner, and the tags that wait for it (website build plan, batch 4
// task 1; Zac 2026-10-23). The rules and the words are in src/lib/consent.ts.
//
// Until the visitor presses Accept, neither the Meta pixel nor Google Analytics
// is on the page at all. After Accept both start at once, on this page, with no
// reload; Reject removes their cookies (and reloads if they were running, the
// only way to stop them). "Cookie settings" in the footer opens the banner again.
//
// Google Analytics (the website's property, G-ZFC7PTYMP9) runs only on the live
// address. Its _ga cookie goes on .stayful.co.uk, which is how Analytics follows
// one visitor between www and this calculator: no link decoration is needed
// between subdomains of one site.

import { useEffect, useSyncExternalStore } from "react";
import Script from "next/script";
import { PREFILL_GUARD_SCRIPT } from "@/lib/linkParams";
import {
  CONSENT_TEXT,
  COOKIE_POLICY_URL,
  consentCookie,
  expireTrackingCookies,
  readConsent,
  type ConsentChoice,
} from "@/lib/consent";
import { LIVE_HOST } from "@/lib/pulse";

const GA_ID = "G-ZFC7PTYMP9";

// ── A tiny store: the choice lives in the cookie, the banner's "open again" here.
const listeners = new Set<() => void>();
let reopened = false;
let tagsStarted = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  listeners.forEach((l) => l());
}
// "yes" | "no" | "none", then "|1" while the banner was opened again.
function snapshot() {
  return `${readConsent(document.cookie) ?? "none"}|${reopened ? 1 : 0}`;
}
// The server cannot read the choice, so it renders neither banner nor tags;
// the browser adds whichever applies straight after.
function serverSnapshot() {
  return "unknown|0";
}

/** Opens the banner again (the footer's "Cookie settings"). */
export function openCookieSettings() {
  reopened = true;
  notify();
}

// Google's and Meta's own stop switches: nothing more is sent from this page.
function stopTags() {
  const w = window as unknown as Record<string, unknown> & { fbq?: (...args: unknown[]) => void };
  w[`ga-disable-${GA_ID}`] = true;
  try {
    w.fbq?.("consent", "revoke");
  } catch {
    // the pixel never loaded
  }
}

function choose(choice: ConsentChoice) {
  const had = readConsent(document.cookie);
  document.cookie = consentCookie(choice, window.location);
  reopened = false;
  if (choice === "no") {
    for (const c of expireTrackingCookies(document.cookie, window.location.hostname)) document.cookie = c;
    // Tags that already started only stop with a fresh page. Until it loads,
    // their own stop switches keep them quiet (stopTags).
    if (had === "yes" || tagsStarted) {
      stopTags();
      window.location.reload();
      return;
    }
  }
  notify();
}

function pixelScript(pixelId: string) {
  // PREFILL_GUARD_SCRIPT again first, so the visitor's details are out of the
  // address bar whichever script runs first (src/lib/linkParams.ts).
  return `${PREFILL_GUARD_SCRIPT}
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(pixelId)});
${matchingOff(pixelId)}
fbq('track', 'PageView');`;
}

// Meta's "automatic advanced matching" (switched on for this pixel in Events
// Manager) reads the email typed into the form and sends it to Meta hashed,
// with every event and through its gateway: found 2026-10-23 running Meta's
// real code (scripts/consent-browser.mjs), against the ruling to keep visitors'
// emails away from Meta (website build plan, wave 2, decision 3A). Meta has no
// page-side command for it, so this opts the pixel out directly as soon as
// Meta's code has loaded, before its settings file opts it in; the settings
// file only opts in a pixel that was not opted out. The lasting fix is the
// switch in Events Manager (Zac's step); this holds until then and after.
function matchingOff(pixelId: string) {
  return `(function(){var id=${JSON.stringify(pixelId)};function off(){try{var i=window.fbq&&window.fbq.instance;if(i&&typeof i.optOut==='function'){i.optOut(id,'AutomaticMatching');i.optOut(id,'AutomaticMatchingForPartnerIntegrations');}}catch(e){}}
if(window.fbq&&window.fbq.instance)off();else{var el=document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]');if(el)el.addEventListener('load',off);}})();`;
}

const GA_SCRIPT = `${PREFILL_GUARD_SCRIPT}
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('consent', 'default', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
gtag('js', new Date());
gtag('config', ${JSON.stringify(GA_ID)});`;

function Tags({ pixelId }: { pixelId?: string }) {
  useEffect(() => {
    tagsStarted = true;
    // Meta's automatic button-click events listen ahead of the banner's own
    // handler, so a Reject press would itself be reported. This listener runs
    // first of all (the window, while the click is still on its way down).
    const onReject = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest('#sf-consent [data-choice="no"]') : null;
      if (el) stopTags();
    };
    window.addEventListener("click", onReject, true);
    return () => window.removeEventListener("click", onReject, true);
  }, []);
  const live = window.location.hostname === LIVE_HOST;
  return (
    <>
      {pixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {pixelScript(pixelId)}
        </Script>
      )}
      {live && (
        <>
          <Script id="google-analytics" strategy="afterInteractive">
            {GA_SCRIPT}
          </Script>
          <Script
            id="google-analytics-tag"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          />
        </>
      )}
    </>
  );
}

function Banner() {
  return (
    <div
      id="sf-consent"
      role="region"
      aria-label={CONSENT_TEXT.settings}
      className="fixed inset-x-4 bottom-4 z-[2147483000] mx-auto flex max-w-[720px] flex-col items-stretch gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-[15px] leading-snug text-card-foreground shadow-[0_20px_50px_-20px_rgba(31,48,25,0.5)] sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4"
    >
      <p className="m-0 flex-1">
        {CONSENT_TEXT.banner}{" "}
        <a href={COOKIE_POLICY_URL} className="underline underline-offset-2">
          {CONSENT_TEXT.policy}
        </a>
      </p>
      <div className="flex flex-none gap-2">
        {(["no", "yes"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            data-choice={choice}
            onClick={() => choose(choice)}
            className="min-h-11 min-w-[100px] flex-1 cursor-pointer rounded-full border border-primary bg-primary px-[18px] py-2.5 text-[15px] font-semibold text-primary-foreground hover:bg-primary/85 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring sm:flex-none"
          >
            {choice === "yes" ? CONSENT_TEXT.accept : CONSENT_TEXT.reject}
          </button>
        ))}
      </div>
    </div>
  );
}

/** In the root layout: the banner when a choice is due, and the tags once accepted. */
export function Consent({ pixelId }: { pixelId?: string }) {
  const [choice, open] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|");
  return (
    <>
      {choice === "yes" && <Tags pixelId={pixelId} />}
      {(choice === "none" || open === "1") && (
        <>
          <Banner />
          {/* Room at the end of the page, so the banner never sits over the
              last of it (the form's button included) at phone width. */}
          <div aria-hidden="true" className="h-56 sm:h-28" />
        </>
      )}
    </>
  );
}

/** The footer's "Cookie settings": opens the banner again. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      data-cookie-settings=""
      onClick={openCookieSettings}
      className={className ?? "cursor-pointer underline underline-offset-2 hover:text-foreground"}
    >
      {CONSENT_TEXT.settings}
    </button>
  );
}
