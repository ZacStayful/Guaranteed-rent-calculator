import { getSupabase } from '@/lib/supabase';

// ─── Internal report-count endpoint ───────────────────────────────
// A lightweight post-deploy check that report storage is working:
//
//   curl -H "x-internal-secret: <INTERNAL_API_SECRET>" \
//        https://<host>/api/reports/count
//   → { "count": 123 }
//
// Internal only — gated behind an INTERNAL_API_SECRET header check so it
// isn't publicly guessable. This mirrors the pattern any future internal
// endpoint (e.g. the Market Explorer aggregation) should use.

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    // Fail closed: with no secret configured the endpoint is disabled
    // rather than left wide open.
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const provided = request.headers.get('x-internal-secret');
  if (provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json(
      { error: 'Storage not configured' },
      { status: 503 },
    );
  }

  const { count, error } = await supabase
    .from('analyser_reports')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('[reports/count] query failed:', error);
    return Response.json({ error: 'Query failed' }, { status: 500 });
  }

  return Response.json({ count: count ?? 0 });
}
