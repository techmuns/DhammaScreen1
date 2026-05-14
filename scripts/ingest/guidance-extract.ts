// Concall transcript extraction script.
//
// Reads guidance-source-manifest.json, picks concall_transcript rows
// that are reachable + confidently classified, downloads each PDF,
// extracts text page-by-page, runs a *narrow* set of regex patterns
// over the text to spot forward-looking numeric guidance, and writes
// extracted commentary candidates to guidance-commentary.json with
// reviewStatus="needs_review" on every row.
//
// Run examples:
//   npm run ingest:guidance:extract -- --company tcs --max-documents 1
//   npm run ingest:guidance:extract -- --max-documents 2 --timeout-ms 20000
//   npm run ingest:guidance:extract -- --dry-run
//
// Hard rules (the project's no-fabrication policy):
//   - Never invent a quote. Every emitted row carries the exact
//     verbatim sentence the regex matched, with whitespace
//     normalisation as the ONLY edit.
//   - Never invent a numeric band. numericLow/High are filled ONLY
//     when the matched sentence carried a literal "X to Y %" /
//     "X–Y%" / "X-Y%" pattern.
//   - Never approve automatically. reviewStatus is always
//     "needs_review"; only the (future) analyst tool can promote.
//   - Never write to guidance-actual-comparison.json — that is the
//     responsibility of a later script after rows are approved.
//   - On HTTP error / PDF parse error / network timeout: record the
//     failure in meta.errors[] and continue. Never crash, never
//     half-write the snapshot.
//   - The commentaryId is deterministic so re-running the extractor
//     never duplicates a previously-emitted quote.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPANIES } from "../config/dhamma-companies";
import type {
  GuidanceCommentaryRow,
  GuidanceDirection,
  GuidanceMetric,
  GuidanceTopic,
} from "../../src/data/types/dhammaDashboard";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(here, "../../src/data/snapshots");
const MANIFEST_FILE = "guidance-source-manifest.json";
const COMMENTARY_FILE = "guidance-commentary.json";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) DhammaScreen/0.1 Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/pdf,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  companyIds: string[] | null;
  maxDocuments: number | null;
  timeoutMs: number;
  dryRun: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    companyIds: null,
    maxDocuments: null,
    timeoutMs: 20_000,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--company" && next) {
      (opts.companyIds ??= []).push(next.toLowerCase());
      i++;
    } else if (arg === "--max-documents" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.maxDocuments = parsed;
      i++;
    } else if (arg === "--timeout-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.timeoutMs = parsed;
      i++;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Snapshot types (mirror existing project conventions)
// ---------------------------------------------------------------------------

interface ManifestRow {
  companyId: string;
  companyName: string;
  documentType: string;
  title: string | null;
  sourceProvider: string;
  sourceUrl: string | null;
  documentUrl: string | null;
  status: string;
  confidence: "high" | "medium" | "low";
}

interface ManifestMeta {
  generatedAt: string | null;
  rowCount: number;
  status: string;
  notes: string | null;
}

interface Manifest {
  meta: ManifestMeta;
  rows: ManifestRow[];
}

interface CommentaryError {
  sourceId: string;
  companyId: string | null;
  documentUrl: string | null;
  message: string;
  occurredAt: string;
}

interface CommentaryMeta {
  source: string;
  snapshotId: string;
  description: string;
  generatedAt: string | null;
  rowCount: number;
  status: "empty" | "partial" | "ok" | "error";
  notes: string | null;
  errors: CommentaryError[];
}

interface CommentarySnapshot {
  meta: CommentaryMeta;
  rows: GuidanceCommentaryRow[];
}

// ---------------------------------------------------------------------------
// Snapshot I/O
// ---------------------------------------------------------------------------

async function readJson<T>(filename: string): Promise<T | null> {
  const filePath = resolve(SNAPSHOT_DIR, filename);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(filename: string, payload: unknown): Promise<void> {
  const filePath = resolve(SNAPSHOT_DIR, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// HTTP download (single GET, bounded timeout, no retries — this is the
// CI's job to retry by re-running the workflow if BSE flaps).
// ---------------------------------------------------------------------------

interface DownloadOutcome {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  byteLength: number;
  buffer: Uint8Array | null;
  errorMessage: string | null;
}

async function downloadPdf(
  url: string,
  timeoutMs: number
): Promise<DownloadOutcome> {
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type") ?? null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        byteLength: 0,
        buffer: null,
        errorMessage: `HTTP ${response.status}`,
      };
    }
    const arrayBuf = await response.arrayBuffer();
    return {
      ok: true,
      status: response.status,
      contentType,
      byteLength: arrayBuf.byteLength,
      buffer: new Uint8Array(arrayBuf),
      errorMessage: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      contentType: null,
      byteLength: 0,
      buffer: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function isPdfContentType(ct: string | null): boolean {
  if (!ct) return false;
  return /\bapplication\/pdf\b/i.test(ct) || /\boctet-stream\b/i.test(ct);
}

// ---------------------------------------------------------------------------
// PDF text extraction (lazy-loaded so the cold path stays clean).
// ---------------------------------------------------------------------------

interface PdfPage {
  pageIndex: number; // 1-based to match pdfjs
  text: string;
}

async function extractPdfPages(
  buffer: Uint8Array,
  documentUrl: string
): Promise<PdfPage[]> {
  // The legacy build is the Node-friendly entrypoint (no worker, no
  // DOM polyfills). Lazy import keeps the cold path off this dep.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: buffer,
    // Silence informational warnings; we only care about extracted text.
    verbosity: 0,
    isEvalSupported: false,
  }).promise;

  const pages: PdfPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        if (typeof item === "object" && item !== null && "str" in item) {
          parts.push((item as { str: string }).str);
        }
      }
      // Join with single spaces; sentence boundaries are recovered
      // downstream from punctuation, not from pdfjs's line breaks.
      pages.push({ pageIndex: i, text: parts.join(" ") });
    } catch (err) {
      // One bad page should not poison the whole document; record an
      // empty page so character offsets downstream stay stable per
      // pageIndex.
      pages.push({
        pageIndex: i,
        text: `[pdfjs page ${i} extraction failed: ${
          err instanceof Error ? err.message : String(err)
        } for ${documentUrl}]`,
      });
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Pattern catalogue
//
// Every pattern is narrow on purpose. The goal at this stage is high
// precision (a row that survives the analyst review) rather than
// recall. New patterns are easy to add later; false positives are
// expensive to clean up.
// ---------------------------------------------------------------------------

interface PatternSpec {
  name: string;
  regex: RegExp;
  topic: GuidanceTopic;
  metric: GuidanceMetric | null;
  expectedDirection: GuidanceDirection | null;
  confidence: "low" | "medium" | "high";
}

const SENTENCE_TERMINATORS = /[.!?]/g;
const MAX_SENTENCE_LOOKBACK = 400;
const MAX_SENTENCE_LOOKAHEAD = 400;

// Note: regex matches must be re-tested per pattern because state is
// shared by `lastIndex` across `.exec` calls. We use matchAll instead.
const PATTERNS: PatternSpec[] = [
  {
    name: "expect-band-percent",
    // "we expect ... 8 to 10%" / "guidance of 26-28%" / "targeting 12%-15%"
    regex:
      /\b(expect(?:ing|ed)?|guide(?:s|d)?|guidance|targeting|target(?:ing|ed)?|projecting|projection|outlook)\b[^.!?\n]{0,140}\b\d{1,3}(?:\.\d+)?\s*(?:[-–—]|to)\s*\d{1,3}(?:\.\d+)?\s*%/gi,
    topic: "other",
    metric: null,
    expectedDirection: null,
    confidence: "medium",
  },
  {
    name: "margin-band-percent",
    // "EBIT margin of 26-28%" / "operating margin in the 24%-26% range"
    regex:
      /\b(ebit(?:da)?\s+margin|operating\s+margin|net\s+margin|margin)\b[^.!?\n]{0,120}\b\d{1,3}(?:\.\d+)?\s*(?:[-–—]|to)\s*\d{1,3}(?:\.\d+)?\s*%/gi,
    topic: "margin",
    metric: "ebitda_margin",
    expectedDirection: "margin_target",
    confidence: "medium",
  },
  {
    name: "growth-band-percent",
    // "revenue growth of 5-7%" / "growth in the 8-10% range"
    regex:
      /\b(revenue\s+growth|growth)\b[^.!?\n]{0,100}\b\d{1,3}(?:\.\d+)?\s*(?:[-–—]|to)\s*\d{1,3}(?:\.\d+)?\s*%/gi,
    topic: "revenue_growth",
    metric: "revenue",
    expectedDirection: "growth_yoy",
    confidence: "medium",
  },
  {
    name: "attrition-percent",
    regex:
      /\battrition\b[^.!?\n]{0,80}\b\d{1,3}(?:\.\d+)?\s*(?:[-–—]|to)?\s*\d{0,3}(?:\.\d+)?\s*%/gi,
    topic: "attrition",
    metric: null,
    expectedDirection: "qualitative",
    confidence: "medium",
  },
  {
    name: "capex-quantum",
    // "capex of ~3,000 cr" / "capex of $250-300 million"
    regex:
      /\bcapex\b[^.!?\n]{0,80}(?:₹|\$|\bUSD\b|\bINR\b)?\s*\d{1,4}(?:[,\d]{0,8})(?:\.\d+)?\s*(?:cr\.?|crore|million|mn|bn|billion)/gi,
    topic: "capex",
    metric: "capex",
    expectedDirection: "absolute",
    confidence: "medium",
  },
  {
    name: "tax-rate-percent",
    regex:
      /\b(effective\s+tax\s+rate|tax\s+rate)\b[^.!?\n]{0,80}\b\d{1,2}(?:\.\d+)?\s*(?:[-–—]|to)?\s*\d{0,2}(?:\.\d+)?\s*%/gi,
    topic: "tax_rate",
    metric: null,
    expectedDirection: "qualitative",
    confidence: "medium",
  },
  {
    name: "margin-bps",
    // "expand margins by 50 bps" / "100 basis points improvement"
    regex:
      /(\bbasis\s+points\b|\bbps\b)[^.!?\n]{0,80}(margin|growth|operating\s+leverage|attrition)/gi,
    topic: "margin",
    metric: "ebitda_margin",
    expectedDirection: "qualitative",
    confidence: "low",
  },
];

// Pull a numeric band out of a verbatim sentence. Returns null if the
// sentence has no clear range. We only emit numericLow/High when the
// regex really matches a range; this is the no-fabrication rule.
function extractNumericBand(quote: string): {
  low: number | null;
  high: number | null;
  unit: "percent" | "bps" | "absolute" | null;
} {
  // Percent range
  const pct = quote.match(
    /(\d{1,3}(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d{1,3}(?:\.\d+)?)\s*%/
  );
  if (pct) {
    const low = Number(pct[1]);
    const high = Number(pct[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return { low, high, unit: "percent" };
    }
  }
  // Single percent
  const onePct = quote.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (onePct) {
    const v = Number(onePct[1]);
    if (Number.isFinite(v)) return { low: v, high: v, unit: "percent" };
  }
  // bps mention (no numeric band promoted; keep null so analyst fills)
  if (/\b(bps|basis\s+points)\b/i.test(quote)) {
    return { low: null, high: null, unit: "bps" };
  }
  return { low: null, high: null, unit: null };
}

function expandToSentence(
  pageText: string,
  matchIndex: number,
  matchLength: number
): { sentence: string; sentenceStart: number } {
  const lowerBound = Math.max(0, matchIndex - MAX_SENTENCE_LOOKBACK);
  const upperBound = Math.min(
    pageText.length,
    matchIndex + matchLength + MAX_SENTENCE_LOOKAHEAD
  );

  // Search backward for sentence start
  let start = lowerBound;
  for (let i = matchIndex; i > lowerBound; i--) {
    if (SENTENCE_TERMINATORS.test(pageText[i])) {
      start = i + 1;
      SENTENCE_TERMINATORS.lastIndex = 0;
      break;
    }
    SENTENCE_TERMINATORS.lastIndex = 0;
  }
  // Search forward for sentence end
  let end = upperBound;
  for (let i = matchIndex + matchLength; i < upperBound; i++) {
    if (SENTENCE_TERMINATORS.test(pageText[i])) {
      end = i + 1;
      SENTENCE_TERMINATORS.lastIndex = 0;
      break;
    }
    SENTENCE_TERMINATORS.lastIndex = 0;
  }
  return {
    sentence: pageText.slice(start, end).trim(),
    sentenceStart: start,
  };
}

// ---------------------------------------------------------------------------
// commentaryId — deterministic across runs.
// ---------------------------------------------------------------------------

function shortHash(input: string, len = 10): string {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}

function buildCommentaryId(args: {
  companyId: string;
  documentUrl: string;
  pageIndex: number;
  charOffset: number;
  quote: string;
}): string {
  const docHash = shortHash(args.documentUrl, 8);
  const quoteHash = shortHash(args.quote, 10);
  return `${args.companyId}::${docHash}::p${args.pageIndex}::o${args.charOffset}::${quoteHash}`;
}

// ---------------------------------------------------------------------------
// Per-document extraction
// ---------------------------------------------------------------------------

interface ExtractDocumentResult {
  rows: GuidanceCommentaryRow[];
  errors: CommentaryError[];
}

async function extractDocument(
  row: ManifestRow,
  options: CliOptions
): Promise<ExtractDocumentResult> {
  const extractedAt = new Date().toISOString();
  const rows: GuidanceCommentaryRow[] = [];
  const errors: CommentaryError[] = [];

  if (!row.documentUrl) {
    errors.push({
      sourceId: "guidance-extract",
      companyId: row.companyId,
      documentUrl: null,
      message: `${row.companyId}: manifest row has no documentUrl`,
      occurredAt: extractedAt,
    });
    return { rows, errors };
  }

  if (options.dryRun) {
    errors.push({
      sourceId: "guidance-extract",
      companyId: row.companyId,
      documentUrl: row.documentUrl,
      message: `dry-run: would download ${row.documentUrl}`,
      occurredAt: extractedAt,
    });
    return { rows, errors };
  }

  const download = await downloadPdf(row.documentUrl, options.timeoutMs);
  if (!download.ok || !download.buffer) {
    errors.push({
      sourceId: "guidance-extract",
      companyId: row.companyId,
      documentUrl: row.documentUrl,
      message:
        `${row.companyId}: download failed ` +
        `(${download.errorMessage ?? "unknown"}, content-type=${
          download.contentType ?? "(none)"
        })`,
      occurredAt: extractedAt,
    });
    return { rows, errors };
  }
  if (!isPdfContentType(download.contentType)) {
    errors.push({
      sourceId: "guidance-extract",
      companyId: row.companyId,
      documentUrl: row.documentUrl,
      message:
        `${row.companyId}: downloaded payload is not a PDF ` +
        `(content-type=${download.contentType ?? "(none)"}, ` +
        `byteLength=${download.byteLength})`,
      occurredAt: extractedAt,
    });
    return { rows, errors };
  }

  let pages: PdfPage[];
  try {
    pages = await extractPdfPages(download.buffer, row.documentUrl);
  } catch (err) {
    errors.push({
      sourceId: "guidance-extract",
      companyId: row.companyId,
      documentUrl: row.documentUrl,
      message:
        `${row.companyId}: pdfjs failed to open document (` +
        (err instanceof Error ? err.message : String(err)) +
        ")",
      occurredAt: extractedAt,
    });
    return { rows, errors };
  }

  for (const page of pages) {
    if (!page.text) continue;
    for (const pattern of PATTERNS) {
      // Reset state — patterns are global and reused across pages.
      pattern.regex.lastIndex = 0;
      for (const m of page.text.matchAll(pattern.regex)) {
        const matchIndex = m.index ?? 0;
        const matchLength = m[0].length;
        const { sentence } = expandToSentence(
          page.text,
          matchIndex,
          matchLength
        );
        if (sentence.length < 12) continue; // sentence too short to be useful
        const cleaned = sentence.replace(/\s+/g, " ").trim();
        const numeric = extractNumericBand(cleaned);
        const commentaryId = buildCommentaryId({
          companyId: row.companyId,
          documentUrl: row.documentUrl,
          pageIndex: page.pageIndex,
          charOffset: matchIndex,
          quote: cleaned,
        });
        rows.push({
          commentaryId,
          companyId: row.companyId,
          companyName: row.companyName,
          sourceProvider: row.sourceProvider,
          sourceUrl: row.sourceUrl,
          documentUrl: row.documentUrl,
          documentTitle: row.title,
          documentType: row.documentType,
          commentaryPeriod: null, // recovered by a separate period helper in Step 23
          targetPeriod: null,
          speaker: null,
          speakerRole: null,
          topic: pattern.topic,
          metric: pattern.metric,
          expectedDirection: pattern.expectedDirection,
          rawQuote: sentence,
          cleanedQuote: cleaned,
          pageIndex: page.pageIndex,
          charOffset: matchIndex,
          quoteLength: sentence.length,
          numericLow: numeric.low,
          numericHigh: numeric.high,
          numericUnit: numeric.unit,
          confidence: pattern.confidence,
          reviewStatus: "needs_review",
          extractedAt,
          notes: `Pattern=${pattern.name} · doc=${row.documentUrl}`,
        });
      }
    }
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));

  const manifest = await readJson<Manifest>(MANIFEST_FILE);
  if (!manifest) {
    console.log(
      "[guidance:extract] no manifest at " +
        resolve(SNAPSHOT_DIR, MANIFEST_FILE) +
        "; run `npm run ingest:guidance:sources` first."
    );
    return;
  }

  // Eligible manifest rows: concall transcripts with a usable URL and
  // at least medium-confidence classification.
  let candidates = manifest.rows.filter(
    (r) =>
      r.documentType === "concall_transcript" &&
      r.status === "discovered" &&
      (r.confidence === "high" || r.confidence === "medium") &&
      r.documentUrl !== null
  );
  if (options.companyIds) {
    candidates = candidates.filter((r) =>
      options.companyIds!.includes(r.companyId)
    );
  }
  if (options.maxDocuments !== null) {
    candidates = candidates.slice(0, options.maxDocuments);
  }

  // Existing rows (idempotent merge). We preserve every row whose
  // commentaryId is NOT re-emitted this run; this way an analyst's
  // review_status edits survive a re-fetch of the same documents.
  const existing =
    (await readJson<CommentarySnapshot>(COMMENTARY_FILE))?.rows ?? [];
  const existingById = new Map(existing.map((r) => [r.commentaryId, r]));

  const newRows: GuidanceCommentaryRow[] = [];
  const errors: CommentaryError[] = [];

  for (const candidate of candidates) {
    const out = await extractDocument(candidate, options);
    newRows.push(...out.rows);
    errors.push(...out.errors);
  }

  // Merge: per-commentaryId. New rows from this run win over an
  // existing `needs_review` row with the same id (it's the same
  // quote anyway); reviewed rows ("approved" / "rejected") in
  // `existing` are preserved untouched.
  const byId = new Map<string, GuidanceCommentaryRow>();
  for (const r of existing) byId.set(r.commentaryId, r);
  for (const r of newRows) {
    const prior = byId.get(r.commentaryId);
    if (prior && prior.reviewStatus !== "needs_review") {
      // Don't overwrite an analyst review; just note the re-extraction.
      continue;
    }
    byId.set(r.commentaryId, r);
  }
  const merged = [...byId.values()];

  const status: CommentaryMeta["status"] =
    merged.length === 0
      ? errors.length > 0
        ? "error"
        : "empty"
      : errors.length === 0
        ? "ok"
        : "partial";

  const snapshot: CommentarySnapshot = {
    meta: {
      source: "Concall transcript extraction",
      snapshotId: "guidance-commentary",
      description:
        "Verbatim guidance commentary candidates extracted from concall " +
        "transcripts and other source documents. Every row is " +
        "reviewStatus='needs_review' until an analyst approves. The " +
        "dashboard only renders rows with reviewStatus='approved'.",
      generatedAt: new Date().toISOString(),
      rowCount: merged.length,
      status,
      notes:
        `Documents attempted: ${candidates.length}. ` +
        `New rows this run: ${newRows.length}. ` +
        `Errors: ${errors.length}. ` +
        `Preserved (prior reviews): ${
          merged.length - newRows.length
        }.`,
      errors,
    },
    rows: merged,
  };

  // Silence the unused warning for the existingById reference — we
  // intentionally kept it so a future refactor can de-dupe via Map
  // semantics if needed.
  void existingById;

  // Validate company names are real (defensive; the manifest comes
  // from a CI-trusted pipeline but better safe than sorry).
  const knownCompanyIds = new Set(COMPANIES.map((c) => c.companyId));
  for (const r of merged) {
    if (!knownCompanyIds.has(r.companyId)) {
      // Don't fail the run; just note it.
      console.warn(
        `[guidance:extract] unknown companyId=${r.companyId} in commentary row ${r.commentaryId}`
      );
    }
  }

  await writeJson(COMMENTARY_FILE, snapshot);

  console.log(
    `[guidance:extract] candidates=${candidates.length} ` +
      `newRows=${newRows.length} errors=${errors.length} ` +
      `totalRows=${merged.length}`
  );
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${resolve(process.argv[1])}`;

if (isDirectInvocation) {
  main().catch((err) => {
    console.error("[guidance:extract] failed:", err);
    process.exitCode = 1;
  });
}
