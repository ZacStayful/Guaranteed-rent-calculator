import { isUnlimited, FREE_ANALYSIS_LIMIT, PAYMENT_URL } from '@/lib/usage';
import { normaliseAnalysisInput } from '@/lib/pipeline/input';
import { runAnalysis } from '@/lib/pipeline/runAnalysis';

// This route renders the PDF with @react-pdf/renderer, which needs the Node
// runtime (not Edge).
export const runtime = 'nodejs';

// The analysis pipeline makes ~8 external API calls and then, AFTER emitting
// the 'complete' SSE event, renders the branded PDF and uploads it to Monday
// (plus the CRM sync). That trailing CRM work is the last thing to run, so it
// is the first casualty if the function is cut off at the platform's default
// execution ceiling (~10s on Vercel Hobby) — the lead already has their result
// but the PDF never lands in Monday. Give the function enough budget for the
// pipeline + the trailing render/upload to finish.
export const maxDuration = 60;

// ─── Rate Limiter (in-memory, per IP) ────────────────────────────
// 10 requests per IP per 60-second window. Protects against API credit abuse.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Clean up stale entries every 5 minutes to prevent memory leak.
// unref'd so the timer never by itself keeps the process alive.
const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000);
// Node's Timeout has unref(); the DOM's numeric handle does not.
(rateLimitCleanup as unknown as { unref?: () => void }).unref?.();

// ─── SSE Helper ──────────────────────────────────────────────────
function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  // Rate limiting
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  // Calibration bypass: dev-mode only, requires header with shared secret from .env
  const calibrationHeader = request.headers.get('x-calibration-bypass');
  const calibrationSecret = process.env.CALIBRATION_BYPASS_SECRET;
  const isCalibrationBypass =
    process.env.NODE_ENV !== 'production' &&
    calibrationSecret &&
    calibrationHeader === calibrationSecret;

  if (!isCalibrationBypass && isRateLimited(ip)) {
    return Response.json(
      { error: 'Too many requests. Please wait a minute before trying again.' },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid request body.' },
      { status: 400 },
    );
  }

  // Validate + map input. Shared with the bulk upload so a spreadsheet row and
  // a form submission are normalised identically. The public form additionally
  // insists on a desired rent — the guaranteed-rent offer is what the page is
  // for, and there is nothing to price against without one.
  const normalised = normaliseAnalysisInput(body, { requireDesiredRent: true });
  const emailStr = typeof body.email === 'string' && body.email.includes('@')
    ? (body.email as string).trim()
    : null;

  // ─── Usage gate ────────────────────────────────────────────────
  // Cap free analyses at FREE_ANALYSIS_LIMIT per EMAIL (owner exempt), then
  // forward the lead to the paid product. The count is a durable per-email
  // counter on the lead's Monday item ("Analyser Uses"), incremented once per
  // completed analysis below. It counts forward from when the column was added,
  // so established leads keep their free runs (not retroactively blocked), and
  // it's keyed by email — never the device — so it can't over-block a shared
  // browser. Fails open: an email that isn't a known lead, or any CRM error,
  // is allowed through, so genuine new users are never wrongly gated.
  if (emailStr && !isUnlimited(emailStr)) {
    let useCount = 0;
    try {
      const { getAnalyserUseCount } = await import('@/lib/apis/monday');
      useCount = await getAnalyserUseCount(emailStr);
    } catch (err) {
      console.error('[Usage gate] Monday use-count check failed (allowing):', err);
    }
    if (useCount >= FREE_ANALYSIS_LIMIT) {
      console.log(`[Usage gate] Blocking ${emailStr}: ${useCount} use(s) ≥ limit ${FREE_ANALYSIS_LIMIT}`);
      return Response.json(
        {
          error: `You've used your ${FREE_ANALYSIS_LIMIT} free analyses. To keep using the analyser, continue at ${PAYMENT_URL}.`,
          paymentRequired: true,
          paymentUrl: PAYMENT_URL,
          freeLimit: FREE_ANALYSIS_LIMIT,
        },
        { status: 402 },
      );
    }
  }

  if (!normalised.ok) {
    return Response.json({ error: normalised.error }, { status: 400 });
  }

  // ─── Streaming SSE Response ──────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(sseEvent(data)));
      };

      try {
        // runAnalysis emits the same stage/progress/message events this route
        // used to send inline, and performs the storage + CRM side effects
        // after the 'complete' event. It never throws.
        await runAnalysis(normalised.input, {
          onProgress: (event) => send({ ...event }),
        });
      } catch (err) {
        console.error('Unexpected error in /api/analyse:', err);
        send({ stage: 'error', progress: 0, message: 'An unexpected error occurred. Please try again.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
