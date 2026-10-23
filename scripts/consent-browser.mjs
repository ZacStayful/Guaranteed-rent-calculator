// The cookie banner (website build plan, batch 4 task 1) in a real browser, against Meta's and Google's real scripts:
//   NEXT_PUBLIC_META_PIXEL_ID=687157345550761 npm run build
//   node --import ./scripts/register-test-resolver.mjs scripts/consent-browser.mjs
// It starts `next start`, serves the build as https://guaranteedrent.stayful.co.uk (and as a Vercel preview address),
// downloads Meta's and Google's scripts for real (plain downloads of their code, which record nothing), and answers
// every request those scripts then make (the pixel's events, its gateway, Analytics' hits) itself, keeping a copy.
// The analysis is answered with the demo result, and our visit counter is answered here too. Nothing reaches Meta,
// Google, the counter or Monday.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { DEMO_RESULT } from '../src/lib/demo-data.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4391;
const LIVE = 'https://guaranteedrent.stayful.co.uk';
const PREVIEW = 'https://guaranteed-rent-calculator-git-test-zac.vercel.app';
const PULSE = 'https://cckfkcmjnpnxlxgunyfy.supabase.co/functions/v1/website-pulse';

// The visitor's details, as a website form would send them on.
const EMAIL = 'jane.tester@example.com';
const LINK = `/?email=${encodeURIComponent(EMAIL)}&address=${encodeURIComponent('12 High Street, Leeds LS1 4AB')}` +
  '&bedrooms=2&bathrooms=1&propertyType=Flat&from=/airbnb-management-leeds&utm_source=test';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const PERSONAL = [EMAIL, encodeURIComponent(EMAIL), sha(EMAIL), '12 High Street', '12%20High%20Street', '12+High+Street',
  'LS1 4AB', 'LS1%204AB', 'LS1+4AB', 'ls14ab', sha('ls14ab'), sha('ls1 4ab')];
// Meta's matching fields (hashed form fields): ud[em], udff[em] and the like.
const MATCHING = /(^|[?&;])(ud|udff)(\[|%5B)|advanced_matching"\s*:\s*\{\s*"/i;

// Script downloads that record nothing: Meta's pixel code and its plugins, Google's tag.
const SCRIPT = /^https:\/\/connect\.facebook\.net\/|^https:\/\/www\.googletagmanager\.com\/gtag\/(js|destination)\?/;
// Everything those scripts send: events, hits, the pixel's gateway on Amazon or Google Cloud.
const HIT = /(^|\.)(facebook\.com|facebook\.net|google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|googletagmanager\.com|google\.com|google\.co\.uk|on\.aws|run\.app|cloud\.run)$/;

const downloads = new Map();
function download(url) {
  const u = new URL(url);
  // The pixel's settings file: only the version, not this page's details.
  if (/\/signals\/config\//.test(u.pathname)) u.search = `?v=${u.searchParams.get('v') || '2.9.170'}&r=stable`;
  const key = u.href;
  if (!downloads.has(key)) downloads.set(key, execFileSync('curl', ['-sS', '--fail', '--max-time', '60', key], { maxBuffer: 64 * 1024 * 1024 }));
  return downloads.get(key);
}

// ── The app ───────────────────────────────────────────────────────
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore', detached: true });
const stopServer = () => { try { process.kill(-server.pid); } catch { /* gone */ } };
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/robots.txt`)).ok) break; } catch { /* not yet */ }
  if (i > 120) { stopServer(); throw new Error('next start did not answer'); }
  await new Promise((r) => setTimeout(r, 500));
}

let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const results = [];
const ok = (name) => { results.push(name); console.log('PASS', name); };

async function open({ base = LIVE, width = 1280, mobile = false, cookies = [] } = {}) {
  const userAgent = mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 760 : 900 }, isMobile: mobile, hasTouch: mobile, userAgent });
  if (cookies.length) await ctx.addCookies(cookies);
  // An ordinary browser: Meta's settings for this pixel drop every event from an automated one.
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const t = { ctx, page: null, base, scripts: [], hits: [], pulse: [], track: [], other: [] };
  await ctx.route(/^https?:\/\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin === LIVE || u.origin === PREVIEW) {
      if (u.pathname === '/api/analyse') {
        const body = `data: ${JSON.stringify({ stage: 'complete', progress: 100, data: DEMO_RESULT })}\n\n`;
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      }
      if (u.pathname === '/api/track') { t.track.push(req.postData() || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
      const response = await route.fetch({ url: `http://localhost:${PORT}${u.pathname}${u.search}`, maxRedirects: 0 });
      return route.fulfill({ response });
    }
    if (u.href.startsWith(PULSE)) { t.pulse.push(JSON.parse(req.postData() || 'null')); return route.fulfill({ status: 204 }); }
    if (SCRIPT.test(u.href)) { t.scripts.push(u.href); return route.fulfill({ status: 200, contentType: 'text/javascript', body: download(u.href) }); }
    if (HIT.test(u.hostname)) { t.hits.push({ url: u.href, body: req.postData() || '' }); return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }); }
    t.other.push(u.href);
    return route.abort();
  });
  t.page = await ctx.newPage();
  t.page.on('pageerror', (e) => { if (/fbq|gtag|consent/i.test(String(e))) t.pageErrors = [...(t.pageErrors || []), String(e)]; });
  return t;
}
const settle = (t, ms = 2500) => t.page.waitForTimeout(ms);
const tags = (t) => t.scripts.length + t.hits.length;
const metaEvents = (t) => t.hits.filter((h) => /facebook\.com\/tr/.test(h.url)).map((h) => new URL(h.url).searchParams.get('ev') || (/(^|&)ev=([^&]+)/.exec(h.body) || [])[2]);
const gaEvents = (t) => t.hits.filter((h) => /\/g\/collect/.test(h.url)).flatMap((h) => [new URL(h.url).searchParams.get('en'), ...[...h.body.matchAll(/(?:^|&)en=([^&\r\n]+)/g)].map((m) => m[1])]).filter(Boolean);
const cookieNames = async (t) => (await t.ctx.cookies()).map((c) => c.name);
async function waitFor(fn, what, ms = 15000, t = null) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 200)); }
  const seen = t ? `\n meta: ${metaEvents(t)} ga: ${gaEvents(t)}\n scripts: ${t.scripts.join('\n  ')}\n hits: ${t.hits.map((h) => h.url.slice(0, 160)).join('\n  ')}\n other: ${t.other.join(', ')}\n errors: ${t.pageErrors || ''}` : '';
  throw new Error(`timed out waiting for ${what}${seen}`);
}
async function runAnalysis(t) {
  await t.page.fill('#guests', '4');
  await t.page.fill('#desiredRentMonthly', '1200');
  await t.page.locator('form button[type="submit"]').click({ timeout: 5000 });
  await t.page.waitForSelector('text=Analysis Complete', { timeout: 20000 });
  await settle(t, 1500);
}
function noPersonalData(t, where) {
  for (const h of t.hits) {
    const all = `${h.url}\n${h.body}`;
    assert.doesNotMatch(all, MATCHING, `${where}: Meta matching field in ${h.url.slice(0, 120)}`);
    for (const p of PERSONAL) assert.ok(!all.toLowerCase().includes(p.toLowerCase()), `${where}: "${p}" sent in ${h.url.slice(0, 120)}`);
  }
}

try {
  // 1. Before any choice, at phone width: nothing from Google or Meta, the link still fills the form, the banner leaves
  //    the form's button clickable, and the session is neither stored nor sent.
  {
    const t = await open({ width: 390, mobile: true });
    await t.page.goto(LIVE + LINK);
    await t.page.waitForSelector('#sf-consent');
    assert.ok(!/email|address|LS1/i.test(new URL(t.page.url()).search), `the address bar kept the details: ${t.page.url()}`);
    assert.equal(await t.page.inputValue('#email'), EMAIL);
    const [reject, accept] = await t.page.locator('#sf-consent button').all();
    assert.equal(await reject.textContent(), 'Reject');
    assert.equal(await accept.textContent(), 'Accept');
    const [rb, ab] = [await reject.boundingBox(), await accept.boundingBox()];
    assert.ok(Math.abs(rb.width - ab.width) < 2 && Math.abs(rb.height - ab.height) < 2, 'Reject and Accept are the same size');
    await t.page.mouse.move(100, 200); await t.page.mouse.wheel(0, 600); await settle(t);
    assert.equal(tags(t), 0, `asked before any choice: ${[...t.scripts, ...t.hits.map((h) => h.url)].join(', ')}`);
    await runAnalysis(t);
    assert.equal(tags(t), 0, 'nothing from Google or Meta after an analysis without a choice');
    const names = await cookieNames(t);
    assert.ok(!names.some((n) => /^_ga|^_fbp|^_fbc|^_gcl/.test(n)), `tracking cookies: ${names}`);
    assert.equal(await t.page.evaluate(() => localStorage.getItem('stayful_sessions')), null);
    assert.equal(t.pulse.length, 1, 'one count in our own counter');
    assert.deepEqual(t.pulse[0], { v: 1, t: 'act', kind: 'calculator', path: '/', label: 'guaranteed rent', target: '/airbnb-management-leeds' });
    await t.page.goto('about:blank'); await new Promise((r) => setTimeout(r, 500));
    assert.ok(!t.track.some((b) => /propertyAddress/.test(b)), 'the session was sent without consent');
    assert.equal(t.other.filter((u) => !/maps\.googleapis|maps\.gstatic|fonts\./.test(u)).length, 0, `other requests: ${t.other}`);
    ok('no choice yet: nothing from Google or Meta, no tracking cookies, form fills and works at phone width');
    await t.ctx.close();
  }

  // 2. Accept: both start on the same page, follow the visitor across stayful.co.uk, and never carry their details.
  {
    const t = await open();
    await t.page.goto(LIVE + LINK);
    await t.page.click('#sf-consent [data-choice="yes"]');
    await waitFor(() => metaEvents(t).includes('PageView') && gaEvents(t).includes('page_view'), 'PageView and page_view', 15000, t);
    assert.equal(await t.page.locator('#sf-consent').count(), 0);
    const jar = await t.ctx.cookies();
    const consent = jar.find((c) => c.name === 'stayful_consent');
    assert.equal(consent.value, 'yes.1'); assert.equal(consent.domain, '.stayful.co.uk'); assert.equal(consent.secure, true);
    assert.equal(jar.find((c) => c.name === '_ga')?.domain, '.stayful.co.uk', 'the _ga cookie is shared with www');
    assert.ok(jar.some((c) => c.name === '_fbp'));
    await runAnalysis(t);
    await waitFor(() => metaEvents(t).includes('Lead') && gaEvents(t).includes('generate_lead'), 'Lead and generate_lead', 15000, t);
    noPersonalData(t, 'after Accept');
    await t.page.goto('about:blank'); await new Promise((r) => setTimeout(r, 500));
    assert.ok(t.track.some((b) => /propertyAddress/.test(b)), 'with consent the session goes to our own server');
    ok(`Accept: pixel and Analytics start at once (Meta ${[...new Set(metaEvents(t))].join(', ')}; Analytics ${[...new Set(gaEvents(t))].join(', ')}), no email, address, postcode or Meta matching field in ${t.hits.length} requests`);
    await t.ctx.close();
  }

  // 3. A yes given on www: no banner, the tags start.
  {
    const t = await open({ cookies: [{ name: 'stayful_consent', value: 'yes.1', domain: '.stayful.co.uk', path: '/', secure: true, sameSite: 'Lax' }] });
    await t.page.goto(LIVE + '/');
    await waitFor(() => metaEvents(t).includes('PageView') && gaEvents(t).includes('page_view'), 'PageView', 15000, t);
    assert.equal(await t.page.locator('#sf-consent').count(), 0);
    ok('a choice made on www holds here');

    // 4. Cookie settings, then Reject: a fresh page with the cookies gone and nothing more sent.
    await t.page.click('[data-cookie-settings]');
    await t.page.waitForSelector('#sf-consent');
    // What the earlier page sent while the answer was still yes: the Cookie settings click, and Google's delayed second
    // copy of the page view (to google.com, a few seconds after it).
    await settle(t, 6000);
    const before = tags(t);
    await Promise.all([t.page.waitForEvent('load'), t.page.click('#sf-consent [data-choice="no"]')]);
    await settle(t);
    const names = await cookieNames(t);
    assert.ok(!names.some((n) => /^_ga|^_fbp/.test(n)), `left after Reject: ${names}`);
    assert.equal((await t.ctx.cookies()).find((c) => c.name === 'stayful_consent').value, 'no.1');
    assert.equal(tags(t), before, `sent after Reject: ${t.hits.slice(before - t.scripts.length).map((h) => h.url.slice(0, 120)).join(', ')}`);
    assert.equal(await t.page.locator('#sf-consent').count(), 0);
    ok('Cookie settings reopens the banner; Reject reloads, clears _ga and _fbp, and nothing more is sent');
    await t.ctx.close();
  }

  // 5. Reject first: nothing at all, and it is remembered.
  {
    const t = await open();
    await t.page.goto(LIVE + '/');
    await t.page.click('#sf-consent [data-choice="no"]');
    await settle(t);
    await t.page.reload(); await settle(t);
    assert.equal(await t.page.locator('#sf-consent').count(), 0);
    assert.equal(tags(t), 0);
    ok('Reject: nothing from Google or Meta, and the choice is remembered');
    await t.ctx.close();
  }

  // 6. A Vercel preview: Analytics and our counter stay off even after Accept (the pixel behaves as before batch 4).
  {
    const t = await open({ base: PREVIEW });
    await t.page.goto(PREVIEW + LINK);
    await t.page.click('#sf-consent [data-choice="yes"]');
    await waitFor(() => metaEvents(t).includes('PageView'), 'PageView on the preview', 15000, t);
    await runAnalysis(t);
    assert.ok(!t.scripts.some((u) => /googletagmanager/.test(u)) && gaEvents(t).length === 0, 'Analytics ran on a preview');
    assert.equal(t.pulse.length, 0, 'the counter sent from a preview');
    assert.equal((await t.ctx.cookies()).find((c) => c.name === 'stayful_consent').domain, new URL(PREVIEW).hostname, 'host-only cookie on a preview');
    noPersonalData(t, 'preview');
    ok('a preview: no Analytics, no count, the choice stays on that host');
    await t.ctx.close();
  }
  console.log(`\n${results.length} checks passed`);
} finally {
  await browser.close();
  stopServer();
}
