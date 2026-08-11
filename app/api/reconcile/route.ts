import { reconcileStream, sseHeaders } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return new Response(reconcileStream(request), { headers: sseHeaders() });
}
