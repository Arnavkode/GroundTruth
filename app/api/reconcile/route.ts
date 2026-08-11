import { clampDataset } from "@/lib/ingest";
import { reconcileStream, sseHeaders } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fixture run. */
export async function GET(request: Request) {
  return new Response(reconcileStream(request), { headers: sseHeaders() });
}

/**
 * Uploaded run. The dataset arrives from the browser, so every cap is applied
 * again here — /api/ingest is a convenience, not the security boundary.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const { dataset, problems } = clampDataset((body as { dataset?: unknown })?.dataset);
  if (!dataset) {
    return Response.json({ error: "Dataset rejected.", problems }, { status: 422 });
  }
  return new Response(reconcileStream(request, dataset), { headers: sseHeaders() });
}
