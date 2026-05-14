// Guidance-source discovery script.
//
// Discovery only. This script asks "for company X on source Y, what
// candidate document URLs exist?" and writes the answers to
// `src/data/snapshots/guidance-source-manifest.json`. It does NOT:
//   - extract guidance claims,
//   - parse transcript text,
//   - write to `guidance-commentary.json`,
//   - bypass logins / CAPTCHAs / paywalls,
//   - use credentials of any kind.
//
// Run examples:
//   npm run ingest:guidance:sources -- --company tcs --source tijori --max-companies 1
//   npm run ingest:guidance:sources -- --company tcs --source screener
//   npm run ingest:guidance:sources -- --dry-run
//
// Hard rules:
//   - On HTTP error / blocked / login wall, write a row with the
//     honest failure reason. Never invent URLs.
//   - On JS-rendered SPA detection, record that headless rendering
//     would be required and stop — do NOT silently launch a browser.
//   - Existing rows for OTHER companies pass through untouched on
//     merge so a single-company probe never wipes the manifest.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";

import { COMPANIES } from "../config/dhamma-companies";
import {
  GUIDANCE_SOURCES,
  type GuidanceSource,
  type GuidanceSourceId,
} from "../config/guidance-sources";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(here, "../../src/data/snapshots");
const MANIFEST_FILE = "guidance-source-manifest.json";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) DhammaScreen/0.1 Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------------------------------------------------------------------------
// Row + snapshot types (kept local to the script for now; promote to
// `src/data/types/dhammaDashboard.ts` once the schema settles).
// ---------------------------------------------------------------------------

export type DocumentType =
  | "concall_transcript"
  | "investor_presentation"
  | "earnings_release"
  | "press_release"
  | "management_commentary"
  | "annual_report"
  | "credit_rating"
  | "other";

export type DiscoveryStatus =
  | "discovered"
  | "downloaded"
  | "parsed"
  | "blocked"
  | "not_found"
  | "error";

export type DiscoveryConfidence = "high" | "medium" | "low";

export interface GuidanceSourceManifestRow {
  companyId: string;
  companyName: string;
  period: string | null;
  documentType: DocumentType;
  title: string | null;
  sourceProvider: GuidanceSourceId | "manual";
  sourceUrl: string | null;
  documentUrl: string | null;
  publishedDate: string | null;
  fetchedAt: string;
  status: DiscoveryStatus;
  confidence: DiscoveryConfidence;
  notes: string | null;
  errorMessage: string | null;
}

interface SnapshotError {
  sourceId: string;
  companyId: string | null;
  message: string;
  occurredAt: string;
}

interface SnapshotMeta {
  source: string;
  snapshotId: string;
  description: string;
  generatedAt: string;
  rowCount: number;
  status: "ok" | "partial" | "empty" | "error";
  notes: string | null;
  errors: SnapshotError[];
}

interface Manifest {
  meta: SnapshotMeta;
  rows: GuidanceSourceManifestRow[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  companyIds: string[] | null;
  maxCompanies: number | null;
  sources: GuidanceSourceId[] | null;
  dryRun: boolean;
  timeoutMs: number;
  // Per-source ceiling for how many document rows to emit per company.
  // Acts as a sanity cap so a page with hundreds of links can't bloat
  // the manifest in a single run.
  maxDocuments: number;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    companyIds: null,
    maxCompanies: null,
    sources: null,
    dryRun: false,
    timeoutMs: 15_000,
    maxDocuments: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--company" && next) {
      (opts.companyIds ??= []).push(next.toLowerCase());
      i++;
    } else if (arg === "--max-companies" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.maxCompanies = parsed;
      i++;
    } else if (arg === "--source" && next) {
      const id = next.toLowerCase() as GuidanceSourceId;
      // We accept the alias "exchanges" as shorthand for both NSE + BSE
      // to match the user's CLI spec; expand it on the way in.
      if (next.toLowerCase() === "exchanges") {
        (opts.sources ??= []).push("nse", "bse");
      } else if (
        ["tijori", "screener", "nse", "bse", "company_ir"].includes(id)
      ) {
        (opts.sources ??= []).push(id);
      }
      i++;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--timeout-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.timeoutMs = parsed;
      i++;
    } else if (arg === "--max-documents" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.maxDocuments = parsed;
      i++;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// HTTP helper (single GET with bounded timeout; no retries — discovery
// probes should be cheap and idempotent).
// ---------------------------------------------------------------------------

interface FetchOutcome {
  ok: boolean;
  status: number | null;
  html: string | null;
  errorMessage: string | null;
}

async function fetchHtml(
  url: string,
  timeoutMs: number
): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        html: null,
        errorMessage: `HTTP ${response.status}`,
      };
    }
    const html = await response.text();
    return { ok: true, status: response.status, html, errorMessage: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: null, html: null, errorMessage: message };
  }
}

// ---------------------------------------------------------------------------
// Tijori discovery
// ---------------------------------------------------------------------------

// Candidate company-page URL patterns to probe in order. We do not know
// the canonical slug per company up front; the discovery probe records
// the first reachable pattern and the failure reasons for the others.
// All slugs are deterministic from the display name; we do not invent
// data.
function buildTijoriCandidates(
  displayName: string,
  nseSymbol: string | null
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (slug: string) => {
    const url = `https://www.tijorifinance.com/company/${slug}/`;
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };
  const long = slugify(displayName);
  const longWithLtd = slugify(`${displayName} Ltd`);
  const longWithLimited = slugify(`${displayName} Limited`);
  push(longWithLtd);
  push(longWithLimited);
  push(long);
  if (nseSymbol) push(nseSymbol.toLowerCase());
  return candidates;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Looks for telltale signs that the response we got is a JavaScript app
// shell rather than a server-rendered page. Tijori's stack is React/Next
// historically, so an empty `<div id="__next">` (or similar) is a strong
// signal that any content we want is rendered client-side.
function looksLikeSpaShell($: cheerio.CheerioAPI, html: string): boolean {
  const root = $("#__next, #root, #app");
  if (root.length === 0) return false;
  // If the root container has no meaningful descendant text, treat the
  // page as a shell.
  const text = root.text().replace(/\s+/g, " ").trim();
  if (text.length > 200) return false;
  // Cross-check: a Next.js / Nuxt page typically embeds JSON state in a
  // <script id="__NEXT_DATA__"> or similar; presence of that on a page
  // with an empty root is a clear SPA fingerprint.
  if (/<script[^>]+id="__NEXT_DATA__"/.test(html)) return true;
  if (/<script[^>]+id="__NUXT_DATA__"/.test(html)) return true;
  return text.length === 0;
}

// Search for anchor / heading hints that the page would carry the
// document categories we care about. We do NOT extract document URLs
// from a SPA shell — those would be fabricated.
interface TijoriHints {
  hasConcall: boolean;
  hasPresentation: boolean;
  hasEarningsRelease: boolean;
  // Raw matches (lower-cased) so the manifest note can quote what we saw.
  evidence: string[];
}

function scanTijoriHints($: cheerio.CheerioAPI): TijoriHints {
  const evidence = new Set<string>();
  let hasConcall = false;
  let hasPresentation = false;
  let hasEarningsRelease = false;

  $("a, h1, h2, h3, h4").each((_i, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (!text) return;
    if (/\bconcall|earnings call|conference call|transcript\b/.test(text)) {
      hasConcall = true;
      evidence.add(text.slice(0, 80));
    }
    if (/investor presentation|investor deck|earnings presentation/.test(text)) {
      hasPresentation = true;
      evidence.add(text.slice(0, 80));
    }
    if (/earnings release|press release|results release/.test(text)) {
      hasEarningsRelease = true;
      evidence.add(text.slice(0, 80));
    }
  });
  return {
    hasConcall,
    hasPresentation,
    hasEarningsRelease,
    evidence: [...evidence].slice(0, 10),
  };
}

interface DiscoveryProbe {
  rows: GuidanceSourceManifestRow[];
  errors: SnapshotError[];
}

async function discoverTijori(
  company: { companyId: string; displayName: string; nseSymbol: string | null },
  options: CliOptions
): Promise<DiscoveryProbe> {
  const fetchedAt = new Date().toISOString();
  const rows: GuidanceSourceManifestRow[] = [];
  const errors: SnapshotError[] = [];
  const candidates = buildTijoriCandidates(company.displayName, company.nseSymbol);

  if (options.dryRun) {
    rows.push(
      makeProbeRow(company, "tijori", null, "discovered", "low", {
        notes: `dry-run: would probe ${candidates.length} Tijori URL pattern(s)`,
      })
    );
    return { rows, errors };
  }

  let landedUrl: string | null = null;
  let landedHtml: string | null = null;
  const tried: string[] = [];

  for (const url of candidates) {
    tried.push(url);
    const result = await fetchHtml(url, options.timeoutMs);
    if (result.ok && result.html) {
      landedUrl = url;
      landedHtml = result.html;
      break;
    }
    // Don't surface every 404 — only the final outcome — but record the
    // last network error if every candidate fails.
    if (
      tried.length === candidates.length &&
      !landedHtml &&
      result.errorMessage
    ) {
      rows.push(
        makeProbeRow(company, "tijori", url, classifyHttpFailure(result), "low", {
          errorMessage: result.errorMessage,
          notes: `Tried ${candidates.length} URL pattern(s); none reachable. Last error: ${result.errorMessage}.`,
        })
      );
      errors.push({
        sourceId: "tijori",
        companyId: company.companyId,
        message: `${company.companyId}: all Tijori candidates failed (${result.errorMessage})`,
        occurredAt: fetchedAt,
      });
      return { rows, errors };
    }
  }

  if (!landedUrl || !landedHtml) {
    // Defensive: shouldn't reach here if candidates were tried, but emit
    // a not_found row so the manifest still records the attempt.
    rows.push(
      makeProbeRow(company, "tijori", null, "not_found", "low", {
        notes: `No reachable Tijori page across ${candidates.length} candidate(s).`,
      })
    );
    return { rows, errors };
  }

  const $ = cheerio.load(landedHtml);
  const isSpa = looksLikeSpaShell($, landedHtml);
  const hints = scanTijoriHints($);

  if (isSpa) {
    rows.push(
      makeProbeRow(company, "tijori", landedUrl, "discovered", "medium", {
        notes:
          "Tijori page reachable but renders as a JavaScript SPA. Static HTML " +
          "carries no transcript / presentation anchors. Headless rendering " +
          "(Playwright) would be required to enumerate documents.",
      })
    );
    return { rows, errors };
  }

  // Static HTML had at least some discoverable hints — emit one row per
  // document category we saw evidence of. Document URLs are NOT extracted
  // here; that's the next phase (and it requires parsing per-category
  // tabs / pagination on Tijori).
  const evidence = hints.evidence.length > 0
    ? `Evidence: ${hints.evidence.join("; ")}`
    : "Static HTML reachable but no obvious document anchors detected.";

  const noteBase = `Tijori page reachable at ${landedUrl}. ${evidence}`;

  if (hints.hasConcall) {
    rows.push(
      makeProbeRow(company, "tijori", landedUrl, "discovered", "medium", {
        documentType: "concall_transcript",
        notes: `${noteBase} (concall section present)`,
      })
    );
  }
  if (hints.hasPresentation) {
    rows.push(
      makeProbeRow(company, "tijori", landedUrl, "discovered", "medium", {
        documentType: "investor_presentation",
        notes: `${noteBase} (investor presentation section present)`,
      })
    );
  }
  if (hints.hasEarningsRelease) {
    rows.push(
      makeProbeRow(company, "tijori", landedUrl, "discovered", "medium", {
        documentType: "earnings_release",
        notes: `${noteBase} (earnings / press release section present)`,
      })
    );
  }
  if (
    !hints.hasConcall &&
    !hints.hasPresentation &&
    !hints.hasEarningsRelease
  ) {
    rows.push(
      makeProbeRow(company, "tijori", landedUrl, "discovered", "low", {
        notes:
          `${noteBase} ` +
          "Page reachable but no transcript / presentation / earnings-release " +
          "anchors found in static HTML — may still exist behind a JS tab.",
      })
    );
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Screener discovery
//
// Screener's per-company page carries a documents section at the bottom
// (annual reports, credit ratings, concalls, sometimes presentations).
// We prefer the consolidated URL since the rest of the dashboard is
// already consolidated-only; both URLs serve identical document blocks
// in practice, but the standalone is kept as a fallback in case
// Screener changes that.
//
// Discovery only: we record the document anchor text, the resolved
// document URL, and a best-effort document-type classification. We do
// NOT download the linked PDFs and do NOT extract guidance text.
// ---------------------------------------------------------------------------

interface DiscoveredDocument {
  documentType: DocumentType;
  title: string;
  documentUrl: string;
  category: string | null; // the <h3> Screener uses ("Annual reports", "Concalls", ...)
  period: string | null;
  publishedDate: string | null;
}

const SCREENER_DOCUMENT_SELECTORS: ReadonlyArray<string> = [
  "#documents",
  "section[data-cookie-section-name='documents']",
  "section.documents",
];

function classifyScreenerLink(
  category: string | null,
  linkText: string,
  href: string
): { type: DocumentType; confidence: DiscoveryConfidence } {
  const haystack = `${category ?? ""} ${linkText} ${href}`.toLowerCase();
  if (/\b(concall|conference call|earnings call|transcript)\b/.test(haystack))
    return { type: "concall_transcript", confidence: "high" };
  if (/\b(investor presentation|investor deck|presentation|\.ppt)\b/.test(haystack))
    return { type: "investor_presentation", confidence: "high" };
  if (/\bannual report\b/.test(haystack))
    return { type: "annual_report", confidence: "high" };
  if (/\b(credit rating|rating)\b/.test(haystack))
    return { type: "credit_rating", confidence: "high" };
  if (/\bearnings release|results release|results announcement\b/.test(haystack))
    return { type: "earnings_release", confidence: "high" };
  if (/\bpress release\b/.test(haystack))
    return { type: "press_release", confidence: "high" };
  // No firm category but Screener listed it under Documents — keep at low
  // confidence rather than dropping the row, so the manifest still records
  // that the link exists.
  return { type: "other", confidence: "low" };
}

// Pull a period token like "Q1FY25", "Jun 2024", "FY24" out of the
// link text. Best-effort: we never invent a period.
function extractPeriodToken(text: string): string | null {
  const t = text.trim();
  const qfy = t.match(/\bQ[1-4]\s*FY\s*\d{2,4}\b/i);
  if (qfy) return qfy[0].toUpperCase().replace(/\s+/g, "");
  const monthYear = t.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i
  );
  if (monthYear) return monthYear[0];
  const fyOnly = t.match(/\bFY\s*\d{2,4}\b/i);
  if (fyOnly) return fyOnly[0].toUpperCase().replace(/\s+/g, "");
  return null;
}

function extractScreenerDocuments(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  maxDocuments: number
): DiscoveredDocument[] {
  // Locate the Documents section. Screener's selectors have churned
  // historically — we try a few in order and bail out of the first that
  // produces anchors.
  let section: cheerio.Cheerio<never> | null = null;
  for (const sel of SCREENER_DOCUMENT_SELECTORS) {
    const candidate = $(sel) as cheerio.Cheerio<never>;
    if (candidate.length > 0) {
      section = candidate;
      break;
    }
  }
  if (!section || section.length === 0) return [];

  const out: DiscoveredDocument[] = [];
  // Walk every anchor inside the section. For each anchor, find the
  // nearest preceding heading (h2/h3/h4) so we can label the category.
  section.find("a[href]").each((_i, el) => {
    if (out.length >= maxDocuments) return false; // stop iteration

    const $a = $(el);
    const href = ($a.attr("href") ?? "").trim();
    if (!href) return;
    const linkText = $a.text().trim().replace(/\s+/g, " ");
    if (!linkText) return;

    // Find the category heading by walking up parents and looking for
    // the previous h2/h3/h4 sibling.
    let category: string | null = null;
    let cursor: cheerio.Cheerio<never> = $a as unknown as cheerio.Cheerio<never>;
    for (let depth = 0; depth < 5 && cursor.length > 0; depth++) {
      const heading = cursor.prevAll("h2, h3, h4").first();
      if (heading.length > 0) {
        category = heading.text().trim().replace(/\s+/g, " ");
        break;
      }
      cursor = cursor.parent() as unknown as cheerio.Cheerio<never>;
    }

    const documentUrl = absoluteUrl(href, baseUrl);
    const { type, confidence } = classifyScreenerLink(
      category,
      linkText,
      documentUrl
    );
    const period = extractPeriodToken(`${linkText} ${category ?? ""}`);

    out.push({
      documentType: type,
      title: linkText,
      documentUrl,
      category,
      period,
      // Real publishedDate would require either a sibling <time> element
      // or a server-rendered date string; Screener publishes dates only
      // for some categories. Leave null when not parseable.
      publishedDate: null,
    });
    // also pin confidence onto the object via a closure variable below
    (out[out.length - 1] as DiscoveredDocument & {
      confidence?: DiscoveryConfidence;
    }).confidence = confidence;
    return undefined;
  });

  return out;
}

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

async function discoverScreener(
  company: {
    companyId: string;
    displayName: string;
    screenerSlug: string | null;
  },
  options: CliOptions
): Promise<DiscoveryProbe> {
  const fetchedAt = new Date().toISOString();
  const rows: GuidanceSourceManifestRow[] = [];
  const errors: SnapshotError[] = [];

  if (!company.screenerSlug) {
    rows.push(
      makeProbeRow(company, "screener", null, "not_found", "low", {
        notes:
          "No screenerSlug configured for this company; cannot probe the " +
          "Screener documents tab.",
      })
    );
    return { rows, errors };
  }

  // Try consolidated first (matches the Step 12 policy), fall back to the
  // standalone URL if the consolidated page is unreachable. Both pages
  // carry the same Documents block in practice.
  const slug = company.screenerSlug;
  const candidateUrls = [
    `https://www.screener.in/company/${slug}/consolidated/`,
    `https://www.screener.in/company/${slug}/`,
  ];

  if (options.dryRun) {
    rows.push(
      makeProbeRow(company, "screener", candidateUrls[0], "discovered", "low", {
        notes: `dry-run: would probe ${candidateUrls.length} Screener URL(s) for documents`,
      })
    );
    return { rows, errors };
  }

  let landedUrl: string | null = null;
  let landedHtml: string | null = null;
  let lastFailure: FetchOutcome | null = null;

  for (const url of candidateUrls) {
    const result = await fetchHtml(url, options.timeoutMs);
    if (result.ok && result.html) {
      landedUrl = url;
      landedHtml = result.html;
      break;
    }
    lastFailure = result;
  }

  if (!landedUrl || !landedHtml) {
    const status = lastFailure
      ? classifyHttpFailure(lastFailure)
      : "error";
    rows.push(
      makeProbeRow(company, "screener", candidateUrls[0], status, "low", {
        errorMessage: lastFailure?.errorMessage ?? null,
        notes:
          `Both Screener URLs unreachable from this run. ` +
          `Last error: ${lastFailure?.errorMessage ?? "unknown"}.`,
      })
    );
    errors.push({
      sourceId: "screener",
      companyId: company.companyId,
      message: `${company.companyId}: screener documents fetch failed (${
        lastFailure?.errorMessage ?? "unknown"
      })`,
      occurredAt: fetchedAt,
    });
    return { rows, errors };
  }

  const $ = cheerio.load(landedHtml);
  const documents = extractScreenerDocuments($, landedUrl, options.maxDocuments);

  if (documents.length === 0) {
    rows.push(
      makeProbeRow(company, "screener", landedUrl, "discovered", "low", {
        notes:
          "Screener page reachable but the Documents section was not " +
          "found in static HTML (selectors: " +
          SCREENER_DOCUMENT_SELECTORS.join(", ") +
          ").",
      })
    );
    return { rows, errors };
  }

  for (const doc of documents) {
    const confidence =
      (doc as DiscoveredDocument & { confidence?: DiscoveryConfidence })
        .confidence ?? "medium";
    rows.push(
      makeProbeRow(company, "screener", landedUrl, "discovered", confidence, {
        documentType: doc.documentType,
        title: doc.title,
        documentUrl: doc.documentUrl,
        period: doc.period,
        publishedDate: doc.publishedDate,
        notes:
          doc.category !== null
            ? `Screener documents section · category="${doc.category}"`
            : "Screener documents section",
      })
    );
  }

  return { rows, errors };
}

function classifyHttpFailure(result: FetchOutcome): DiscoveryStatus {
  if (result.status === 404) return "not_found";
  if (
    result.status === 401 ||
    result.status === 403 ||
    result.status === 429
  ) {
    return "blocked";
  }
  if (result.errorMessage && /abort|timeout/i.test(result.errorMessage))
    return "error";
  return "error";
}

function makeProbeRow(
  company: { companyId: string; displayName: string },
  sourceProvider: GuidanceSourceId | "manual",
  sourceUrl: string | null,
  status: DiscoveryStatus,
  confidence: DiscoveryConfidence,
  extras: Partial<
    Pick<
      GuidanceSourceManifestRow,
      | "documentType"
      | "title"
      | "publishedDate"
      | "notes"
      | "errorMessage"
      | "period"
      | "documentUrl"
    >
  > = {}
): GuidanceSourceManifestRow {
  return {
    companyId: company.companyId,
    companyName: company.displayName,
    period: extras.period ?? null,
    documentType: extras.documentType ?? "other",
    title: extras.title ?? null,
    sourceProvider,
    sourceUrl,
    documentUrl: extras.documentUrl ?? null,
    publishedDate: extras.publishedDate ?? null,
    fetchedAt: new Date().toISOString(),
    status,
    confidence,
    notes: extras.notes ?? null,
    errorMessage: extras.errorMessage ?? null,
  };
}

// ---------------------------------------------------------------------------
// Stub probes for the other sources — discovery-only placeholders. These
// emit a single row per company per source recording that the source
// adapter has not been implemented yet. This keeps the manifest schema
// real, so downstream consumers can see the planned shape without us
// fabricating document URLs.
// ---------------------------------------------------------------------------

function stubProbe(
  source: GuidanceSource,
  company: { companyId: string; displayName: string }
): GuidanceSourceManifestRow {
  return makeProbeRow(
    company,
    source.sourceId,
    source.baseUrl,
    "not_found",
    "low",
    {
      notes:
        `${source.displayName}: discovery adapter not implemented in Step 17. ` +
        `Source notes: ${source.notes}`,
    }
  );
}

// ---------------------------------------------------------------------------
// Snapshot I/O (preserves rows for unattempted (company, source) pairs).
// ---------------------------------------------------------------------------

async function readManifest(): Promise<Manifest | null> {
  const filePath = resolve(SNAPSHOT_DIR, MANIFEST_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  const filePath = resolve(SNAPSHOT_DIR, MANIFEST_FILE);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));

  const all = [...COMPANIES].sort(
    (a, b) => a.fetchPriority - b.fetchPriority
  );
  let companies = options.companyIds
    ? all.filter((c) => options.companyIds!.includes(c.companyId))
    : all;
  if (options.maxCompanies !== null) {
    companies = companies.slice(0, options.maxCompanies);
  }

  const enabledSources: GuidanceSource[] = options.sources
    ? GUIDANCE_SOURCES.filter((s) => options.sources!.includes(s.sourceId))
    : GUIDANCE_SOURCES.filter((s) => s.enabledByDefault);

  const newRows: GuidanceSourceManifestRow[] = [];
  const errors: SnapshotError[] = [];

  for (const company of companies) {
    for (const source of enabledSources) {
      if (source.sourceId === "tijori") {
        const out = await discoverTijori(
          {
            companyId: company.companyId,
            displayName: company.displayName,
            nseSymbol: company.nseSymbol,
          },
          options
        );
        newRows.push(...out.rows);
        errors.push(...out.errors);
      } else if (source.sourceId === "screener") {
        const out = await discoverScreener(
          {
            companyId: company.companyId,
            displayName: company.displayName,
            screenerSlug: company.screenerSlug,
          },
          options
        );
        newRows.push(...out.rows);
        errors.push(...out.errors);
      } else {
        newRows.push(
          stubProbe(source, {
            companyId: company.companyId,
            displayName: company.displayName,
          })
        );
      }
    }
  }

  // Merge: preserve rows for (company, source) pairs we did NOT attempt
  // this run. Per-(company, source) replacement keeps single-company
  // probes from wiping the rest of the manifest.
  const attempted = new Set<string>();
  for (const c of companies) {
    for (const s of enabledSources) {
      attempted.add(`${c.companyId}::${s.sourceId}`);
    }
  }
  const existing = (await readManifest())?.rows ?? [];
  const preserved = existing.filter(
    (r) => !attempted.has(`${r.companyId}::${r.sourceProvider}`)
  );
  const merged = [...preserved, ...newRows];

  const status: SnapshotMeta["status"] =
    merged.length === 0
      ? "empty"
      : errors.length === 0
        ? "ok"
        : merged.length > 0
          ? "partial"
          : "error";

  await writeManifest({
    meta: {
      source: "Guidance source discovery",
      snapshotId: "guidance-source-manifest",
      description:
        "Per-(company, source) discovery probes for management commentary " +
        "documents. Discovery only — no guidance claims are extracted here.",
      generatedAt: new Date().toISOString(),
      rowCount: merged.length,
      status,
      notes:
        `Companies probed: ${companies.length}. Sources probed: ` +
        enabledSources.map((s) => s.sourceId).join(", ") +
        `. Errors: ${errors.length}.`,
      errors,
    },
    rows: merged,
  });

  console.log(
    `[guidance:sources] companies=${companies.length} sources=${enabledSources.length} ` +
      `newRows=${newRows.length} errors=${errors.length} totalRows=${merged.length}`
  );
}

main().catch((err) => {
  console.error("[guidance:sources] failed:", err);
  process.exitCode = 1;
});
