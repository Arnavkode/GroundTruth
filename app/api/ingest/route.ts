import { ingest, LIMITS, SOURCE_KINDS, type SourceKind, type UploadFile } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Hard ceiling on how long this route may run. Vercel kills it after this. */
export const maxDuration = 15;

const ALLOWED_EXTENSIONS = /\.(csv|json|txt)$/i;
const ALLOWED_TYPES = new Set([
  "text/csv",
  "application/csv",
  "text/plain",
  "application/json",
  "text/json",
  "application/vnd.ms-excel", // what some browsers label .csv as
  "",
]);

function reject(status: number, fatal: string[]) {
  return Response.json(
    { report: { ok: false, fatal, issues: [], truncations: [], accepted: {}, rejected: {} }, dataset: null },
    { status },
  );
}

export async function POST(request: Request) {
  // 1. Size, before anything is read into memory or parsed.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.MAX_BYTES) {
    return reject(413, [
      `Upload is ${(declared / 1024).toFixed(0)}KB; the limit is ${LIMITS.MAX_BYTES / 1024}KB.`,
    ]);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return reject(415, ["Send the files as multipart/form-data."]);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reject(400, ["Could not read the upload — malformed multipart body."]);
  }

  // 2. Collect only the fields we recognise, validating each file as we go.
  const files: UploadFile[] = [];
  const fatal: string[] = [];
  let bytes = 0;

  for (const kind of SOURCE_KINDS) {
    for (const entry of form.getAll(kind)) {
      if (typeof entry === "string") {
        // A pasted-in body is allowed; treat it as a file with no name.
        if (!entry.trim()) continue;
        bytes += Buffer.byteLength(entry, "utf8");
        files.push({ kind: kind as SourceKind, filename: `${kind}.json`, text: entry });
        continue;
      }
      const file = entry as File;
      if (file.size === 0) continue;

      if (!ALLOWED_EXTENSIONS.test(file.name)) {
        fatal.push(`${file.name}: only .csv, .json and .txt files are accepted.`);
        continue;
      }
      if (!ALLOWED_TYPES.has(file.type)) {
        fatal.push(`${file.name}: content type "${file.type}" is not accepted.`);
        continue;
      }
      if (file.size > LIMITS.MAX_BYTES) {
        fatal.push(`${file.name}: ${(file.size / 1024).toFixed(0)}KB exceeds the ${LIMITS.MAX_BYTES / 1024}KB limit.`);
        continue;
      }

      bytes += file.size;
      if (bytes > LIMITS.MAX_BYTES) {
        fatal.push(`Combined upload exceeds the ${LIMITS.MAX_BYTES / 1024}KB limit.`);
        break;
      }
      files.push({ kind: kind as SourceKind, filename: file.name, text: await file.text() });
    }
  }

  if (fatal.length > 0) return reject(413, fatal);
  if (files.length === 0) {
    return reject(400, [
      `No files received. Attach at least one of: ${SOURCE_KINDS.join(", ")}.`,
    ]);
  }

  const label = String(form.get("label") ?? "").slice(0, 120) || "Uploaded evidence";

  // The fee schedule is per-merchant, so it has to be an input rather than a
  // constant — otherwise every upload on a different rate flags its own fees.
  const pct = Number(form.get("feePercent"));
  const fixed = Number(form.get("feeFixedCents"));
  const feeSchedule =
    Number.isFinite(pct) && Number.isFinite(fixed) && pct >= 0 && pct <= 100 && fixed >= 0
      ? { percentBps: Math.round(pct * 100), fixedCents: Math.round(fixed) }
      : undefined;

  const result = ingest(files, { label, feeSchedule });

  return Response.json(result, { status: result.report.ok ? 200 : 422 });
}
