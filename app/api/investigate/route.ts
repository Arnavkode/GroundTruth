import { investigateStream, sseHeaders } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const disputeId = new URL(request.url).searchParams.get("dispute") ?? "DSP-1009";
  return new Response(investigateStream(request, disputeId), { headers: sseHeaders() });
}
