import { clampDataset } from "@/lib/ingest";
import { investigateStream, sseHeaders } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const disputeId = new URL(request.url).searchParams.get("dispute") ?? "DSP-1009";
  return new Response(investigateStream(request, disputeId), { headers: sseHeaders() });
}

export async function POST(request: Request) {
  const disputeId = new URL(request.url).searchParams.get("dispute") ?? "";
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
  return new Response(investigateStream(request, disputeId, dataset), { headers: sseHeaders() });
}
