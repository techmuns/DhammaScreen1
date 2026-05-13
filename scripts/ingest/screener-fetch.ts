// Automated Screener fetcher for Dhamma Dashboard 1.
//
// Run:        npm run ingest:screener:fetch
// Sources:    https://www.screener.in/company/<slug>/
// Writes:
//   - src/data/snapshots/screener-fetch-status.json (per-company status)
//   - src/data/snapshots/screener-normalized-financials.json (shared with manual import; tagged sourceMethod="fetch")
//   - src/data/snapshots/screener-peer-comparison.json (shared; tagged sourceMethod="fetch")
//
// Co-existence rule: this script preserves all rows tagged
// `sourceMethod === "import"` and only touches rows tagged
// `sourceMethod === "fetch"`. The manual-import script does the opposite.
//
// Hard rules (do not relax without re-reading the plan doc):
//   - The dashboard UI must NEVER call Screener directly. This script is
//     the only entry point that touches the network.
//   - No CAPTCHA bypass, no login walls, no credentials in code.
//   - On HTTP error / parse error / Screener structure change, write a
//     status row with the failure reason and move on. Never crash, never
//     fake values, never fall back to fabricated rows.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";

import { COMPANIES } from "../config/dhamma-companies";
import type {
  CompanyMaster,
  ScreenerCompanyFinancialRow,
  ScreenerFetchStatus,
  ScreenerFetchStatusRow,
  ScreenerPeerComparisonRow,
  ScreenerPeriodType,
  ScreenerSheetType,
  Snapshot,
  SnapshotError,
  SnapshotMeta,
  SourceMeta,
} from "../../src/data/types/dhammaDashboard";
import {
  canonicalizeScreenerMetric,
  parseScreenerPeriod,
} from "../../src/data/helpers/screenerMapping";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(here, "../../src/data/snapshots");

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) DhammaScreen/0.1 Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
};

type PeerMode = "static" | "headless" | "auto";

interface CliOptions {
  companyIds: string[] | null;
  maxCompanies: number | null;
  sections: string[] | null;
  dryRun: boolean;
  timeoutMs: number;
  delayMs: number;
  peerMode: PeerMode;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    companyIds: null,
    maxCompanies: null,
    sections: null,
    dryRun: false,
    timeoutMs: 20_000,
    delayMs: 2_500,
    peerMode: "auto",
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
    } else if (arg === "--section" && next) {
      (opts.sections ??= []).push(next.toLowerCase());
      i++;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--timeout-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.timeoutMs = parsed;
      i++;
    } else if (arg === "--delay-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 0) opts.delayMs = parsed;
      i++;
    } else if (arg === "--peer-mode" && next) {
      if (next === "static" || next === "headless" || next === "auto") {
        opts.peerMode = next;
      }
      i++;
    }
  }
  return opts;
}

// Section IDs map to canonical sheet types so the existing UI / helpers
// see rows in a shape identical to the manual-import path.
interface SectionSpec {
  id: string;
  sectionKey: string;
  sheetType: ScreenerSheetType;
  periodType: ScreenerPeriodType;
}

const SECTIONS: SectionSpec[] = [
  { id: "quarters", sectionKey: "quarters", sheetType: "quarterly_results", periodType: "quarter" },
  { id: "profit-loss", sectionKey: "profit_and_loss", sheetType: "profit_and_loss", periodType: "year" },
  { id: "balance-sheet", sectionKey: "balance_sheet", sheetType: "balance_sheet", periodType: "year" },
  { id: "cash-flow", sectionKey: "cash_flow", sheetType: "cash_flow", periodType: "year" },
  { id: "ratios", sectionKey: "ratios", sheetType: "ratios", periodType: "year" },
  { id: "peers", sectionKey: "peers", sheetType: "peer_comparison", periodType: "unknown" },
];

// ---------------------------------------------------------------------------
// Snapshot I/O — preserves rows from the other sourceMethod on write.
// ---------------------------------------------------------------------------

function deriveStatus(rowCount: number, hasErrors: boolean) {
  if (rowCount === 0) return hasErrors ? "error" : "empty";
  return hasErrors ? "partial" : "ok";
}

function buildMeta(args: {
  snapshotId: string;
  description: string;
  rowCount: number;
  source: SourceMeta;
  notesWhenEmpty: string;
  errors?: SnapshotError[];
}): SnapshotMeta {
  const errors = args.errors ?? [];
  const status = deriveStatus(args.rowCount, errors.length > 0);
  const notes =
    status === "empty"
      ? args.notesWhenEmpty
      : status === "partial"
        ? `Some companies failed (${errors.length} errors recorded).`
        : status === "error"
          ? `All companies failed (${errors.length} errors recorded).`
          : null;
  return {
    snapshotId: args.snapshotId,
    description: args.description,
    generatedAt: new Date().toISOString(),
    rowCount: args.rowCount,
    status,
    notes,
    source: args.source,
    errors,
  };
}

async function readSnapshot<TRow>(
  filename: string
): Promise<Snapshot<TRow> | null> {
  const filePath = resolve(SNAPSHOT_DIR, filename);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as Snapshot<TRow>;
  } catch {
    return null;
  }
}

async function writeSnapshot<TRow>(
  filename: string,
  snapshot: Snapshot<TRow>
): Promise<void> {
  const filePath = resolve(SNAPSHOT_DIR, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// HTTP fetch with one retry and explicit timeout.
// ---------------------------------------------------------------------------

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        lastErr = new Error(`HTTP ${response.status}`);
        if (response.status === 429 || response.status >= 500) {
          // transient → retry once with a short backoff
          await sleep(1500);
          continue;
        }
        throw lastErr;
      }
      return await response.text();
    } catch (err) {
      lastErr = err;
      // Only retry on AbortError / network-shaped errors; otherwise bail.
      if (attempt === 0) {
        await sleep(1500);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------------------------------------------------------------------------
// HTML → typed rows.
// ---------------------------------------------------------------------------

interface ParsedTable {
  headers: string[];
  rows: Array<{ label: string; values: string[] }>;
}

function extractTable(
  $: cheerio.CheerioAPI,
  sectionId: string
): ParsedTable | null {
  // Screener's "Peers" section is usually a `#peers` block that contains a
  // <div id="peers-table-placeholder"> populated by JS at runtime. A static
  // HTTP fetch therefore sees no rows there. Try the obvious ID first, then
  // a small set of fallback selectors, then bail.
  const selectors = [`#${sectionId}`];
  if (sectionId === "peers") {
    selectors.push("#peers-table-placeholder", "section.peers");
  } else {
    selectors.push(`section[data-cookie-section-name='${sectionId}']`);
  }

  let table = $().filter(() => false); // empty wrapped set with correct type
  for (const sel of selectors) {
    const section = $(sel);
    if (section.length === 0) continue;
    const t = section.find("table").first();
    if (t.length > 0) {
      table = t;
      break;
    }
  }
  if (table.length === 0) return null;

  const headers = table
    .find("thead th")
    .map((_i, el) => $(el).text().trim().replace(/\s+/g, " "))
    .get();

  const rows: ParsedTable["rows"] = [];
  table.find("tbody tr").each((_i, tr) => {
    const cells = $(tr).find("td");
    if (cells.length === 0) return;
    const label = $(cells[0])
      .text()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*\+\s*$/, "") // strip Screener's "+" expand affordance
      .trim();
    if (!label) return;
    const values = cells
      .slice(1)
      .map((_j, el) => $(el).text().trim().replace(/\s+/g, " "))
      .get();
    rows.push({ label, values });
  });

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Peer-table extraction (separate from the generic extractTable above).
//
// Screener's peer table differs from the per-company statement tables:
//   - The first cell is usually "S.No." (1., 2., …), not a metric name.
//   - The peer-company name lives in a cell containing an <a href="/company/...">
//     link, which can be at column index 1 (or later).
//   - The peer table is normally NOT in the main company page's static HTML —
//     it's injected by JS into `<div id="peers-table-placeholder">`. We
//     therefore have to fall back to a Screener-internal endpoint to fetch
//     the actual <table> HTML.
// ---------------------------------------------------------------------------

interface PeerParsedTable {
  headers: string[];
  rows: Array<{ name: string; cells: Record<string, string> }>;
}

function extractPeerTableFromSection(
  $: cheerio.CheerioAPI,
  section: cheerio.Cheerio<never>
): PeerParsedTable | null {
  // section can either be a <table> directly or a container that holds one.
  const table = section.is("table") ? section : section.find("table").first();
  if (table.length === 0) return null;

  const headers = table
    .find("thead th")
    .map((_i, el) => $(el).text().trim().replace(/\s+/g, " "))
    .get();
  if (headers.length === 0) return null;

  const rows: PeerParsedTable["rows"] = [];
  table.find("tbody tr").each((_i, tr) => {
    const cellEls = $(tr).find("td");
    if (cellEls.length === 0) return;

    // Find the cell whose <a href="/company/..."> link names the peer.
    let nameIdx = -1;
    let name = "";
    for (let i = 0; i < cellEls.length; i++) {
      const link = $(cellEls[i]).find("a[href*='/company/']").first();
      if (link.length > 0) {
        name = link.text().trim();
        nameIdx = i;
        break;
      }
    }
    // Fallback: assume column 1 (after S.No.) is the name when no link is
    // present (e.g. a JS-rendered fragment that has been re-serialized).
    if (nameIdx === -1 && cellEls.length >= 2) {
      nameIdx = 1;
      name = $(cellEls[1]).text().trim();
    }
    if (!name) return;

    const cells: Record<string, string> = {};
    for (let i = 0; i < cellEls.length; i++) {
      if (i === nameIdx) continue;
      const header = headers[i];
      if (!header) continue;
      const trimmed = $(cellEls[i]).text().trim().replace(/\s+/g, " ");
      if (trimmed) cells[header] = trimmed;
    }
    rows.push({ name, cells });
  });

  return rows.length === 0 ? null : { headers, rows };
}

function tryExtractPeerTable(
  $: cheerio.CheerioAPI,
  selectors: string[]
): PeerParsedTable | null {
  for (const sel of selectors) {
    const section = $(sel) as cheerio.Cheerio<never>;
    if (section.length === 0) continue;
    const result = extractPeerTableFromSection($, section);
    if (result) return result;
  }
  return null;
}

// Try a few well-known places where Screener might publish its numeric
// warehouse company id (used by its peer endpoint). The slug (e.g. "TCS")
// is the human-readable URL key; the warehouse id is the integer
// primary key.
function extractWarehouseId(
  $: cheerio.CheerioAPI,
  html: string
): string | null {
  const fromPlaceholder = $("#peers-table-placeholder").attr("data-warehouse-id");
  if (fromPlaceholder && /^\d+$/.test(fromPlaceholder)) return fromPlaceholder;
  const fromAny = $("[data-warehouse-id]").first().attr("data-warehouse-id");
  if (fromAny && /^\d+$/.test(fromAny)) return fromAny;
  const fromPath = html.match(/\/company\/(\d{4,})\//);
  if (fromPath) return fromPath[1];
  return null;
}

interface PeerSectionOutcome {
  rows: ScreenerPeerComparisonRow[];
  sourceUrlUsed: string | null;
  strategy: "inline" | "warehouse-api" | "peers-fragment" | "headless" | null;
  notes: string | null;
}

interface PeerSectionArgs {
  company: CompanyMaster;
  mainPageHtml: string;
  main$: cheerio.CheerioAPI;
  mainPageUrl: string;
  fetchedAt: string;
  options: CliOptions;
}

// Strategies A + B + C: static HTTP, no browser. Cheap, runs first.
async function fetchPeerSectionStatic(
  args: PeerSectionArgs
): Promise<PeerSectionOutcome> {
  const {
    company,
    mainPageHtml,
    main$,
    mainPageUrl,
    fetchedAt,
    options,
  } = args;

  // Strategy A: peer table is sometimes server-rendered on the main page.
  const inline = tryExtractPeerTable(main$, [
    "#peers",
    "#peers-table-placeholder",
    "section.peers",
  ]);
  if (inline) {
    return {
      rows: peerTableToRows(company, inline, mainPageUrl, fetchedAt),
      sourceUrlUsed: mainPageUrl,
      strategy: "inline",
      notes: null,
    };
  }

  // Strategy B: warehouse-id-keyed peer endpoint.
  const warehouseId = extractWarehouseId(main$, mainPageHtml);
  if (warehouseId) {
    for (const apiUrl of [
      `https://www.screener.in/api/company/${warehouseId}/peers/`,
      `https://www.screener.in/company/${warehouseId}/peers/`,
    ]) {
      try {
        const apiHtml = await fetchHtml(apiUrl, options.timeoutMs);
        const $api = cheerio.load(apiHtml);
        const table = tryExtractPeerTable($api, ["body", "table", "#peers"]);
        if (table) {
          return {
            rows: peerTableToRows(company, table, apiUrl, fetchedAt),
            sourceUrlUsed: apiUrl,
            strategy: "warehouse-api",
            notes: null,
          };
        }
      } catch {
        // try next URL
      }
    }
  }

  // Strategy C: /company/<slug>/peers/ fragment endpoint.
  const slugUrl = mainPageUrl.replace(/\/$/, "") + "/peers/";
  try {
    const slugHtml = await fetchHtml(slugUrl, options.timeoutMs);
    const $slug = cheerio.load(slugHtml);
    const table = tryExtractPeerTable($slug, ["#peers", "body", "table"]);
    if (table) {
      return {
        rows: peerTableToRows(company, table, slugUrl, fetchedAt),
        sourceUrlUsed: slugUrl,
        strategy: "peers-fragment",
        notes: null,
      };
    }
  } catch {
    // fall through
  }

  return {
    rows: [],
    sourceUrlUsed: null,
    strategy: null,
    notes:
      "Peer table not in main HTML; warehouse-id API and /peers/ fragment both unavailable. Likely client-side-rendered.",
  };
}

// Strategy D: headless Chromium. Used only when static path returns no rows
// and peerMode allows it. Playwright is imported lazily so the cold path
// (peerMode=static, or Playwright not installed) never touches the dep.
//
// Respectful rules enforced here:
//   - No CAPTCHA bypass, no login, no credentials.
//   - One page per company, bounded by --timeout-ms.
//   - Browser closed in `finally`; the script exits cleanly even on crash.
//   - If Playwright is missing OR Chromium is missing OR the page never
//     renders a peer table, we record the failure reason and return.
async function fetchPeerSectionHeadless(
  args: PeerSectionArgs
): Promise<PeerSectionOutcome> {
  const { company, mainPageUrl, fetchedAt, options } = args;

  let pw: typeof import("playwright") | null = null;
  try {
    pw = await import("playwright");
  } catch (err) {
    return {
      rows: [],
      sourceUrlUsed: null,
      strategy: null,
      notes:
        "Headless unavailable: Playwright import failed (" +
        (err instanceof Error ? err.message : String(err)) +
        "). Run `npm install` to add it.",
    };
  }

  let browser: Awaited<
    ReturnType<typeof import("playwright")["chromium"]["launch"]>
  > | null = null;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    return {
      rows: [],
      sourceUrlUsed: null,
      strategy: null,
      notes:
        "Headless unavailable: Chromium launch failed (" +
        (err instanceof Error ? err.message : String(err)) +
        "). Run `npx playwright install --with-deps chromium` once.",
    };
  }

  try {
    const context = await browser.newContext({
      userAgent: BROWSER_HEADERS["User-Agent"],
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });
    const page = await context.newPage();

    try {
      await page.goto(mainPageUrl, {
        waitUntil: "networkidle",
        timeout: options.timeoutMs,
      });
    } catch (err) {
      return {
        rows: [],
        sourceUrlUsed: null,
        strategy: null,
        notes:
          "Headless fetch did not reach " +
          mainPageUrl +
          " (" +
          (err instanceof Error ? err.message : String(err)) +
          "). May be CAPTCHA, rate limit, or network block.",
      };
    }

    // Bounded wait for the peer table to render. 10s is enough; the goto
    // already waited for network-idle, so the table is usually present
    // by now if it's coming at all.
    await page
      .waitForSelector(
        "#peers table tbody tr, #peers-table-placeholder table tbody tr",
        { timeout: 10_000 }
      )
      .catch(() => {
        /* parse anyway; the table may have a different anchor */
      });

    const html = await page.content();
    const $ = cheerio.load(html);
    const table = tryExtractPeerTable($, [
      "#peers",
      "#peers-table-placeholder",
      "section.peers",
    ]);

    if (!table) {
      return {
        rows: [],
        sourceUrlUsed: null,
        strategy: null,
        notes:
          "Headless: page loaded but no peer table rendered within timeout. CAPTCHA / login wall / structure change.",
      };
    }

    return {
      rows: peerTableToRows(company, table, mainPageUrl, fetchedAt),
      sourceUrlUsed: mainPageUrl,
      strategy: "headless",
      notes: null,
    };
  } catch (err) {
    return {
      rows: [],
      sourceUrlUsed: null,
      strategy: null,
      notes:
        "Headless fetch crashed: " +
        (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    await browser.close().catch(() => {
      /* best-effort */
    });
  }
}

// Orchestrator: route by --peer-mode.
//   static   → A / B / C only
//   headless → D only (skip A/B/C)
//   auto     → A / B / C, then D on failure (default)
async function fetchPeerSection(
  args: PeerSectionArgs
): Promise<PeerSectionOutcome> {
  const mode = args.options.peerMode;
  if (mode !== "headless") {
    const staticResult = await fetchPeerSectionStatic(args);
    if (staticResult.rows.length > 0) return staticResult;
    if (mode === "static") return staticResult;
  }
  return fetchPeerSectionHeadless(args);
}

function peerTableToRows(
  company: CompanyMaster,
  table: PeerParsedTable,
  sourceUrl: string,
  fetchedAt: string
): ScreenerPeerComparisonRow[] {
  const out: ScreenerPeerComparisonRow[] = [];
  for (const peer of table.rows) {
    for (const [header, cellValue] of Object.entries(peer.cells)) {
      const canonical = canonicalizeScreenerMetric(header);
      const { value, unit } = parseScreenerNumber(cellValue);
      out.push({
        companyId: company.companyId,
        companyName: company.displayName,
        peerCompanyName: peer.name,
        sourceMethod: "fetch",
        sourceFile: `screener-fetch:${company.companyId}`,
        sourceSheet: "peers",
        sourceUrl,
        sheetType: "peer_comparison",
        period: null,
        periodSortKey: null,
        periodType: "unknown",
        metricName: header,
        metricCanonical: canonical,
        metricValue: value,
        unit,
        currency: null,
        sourceLabel: `Screener fetch · ${sourceUrl}`,
        importedAt: fetchedAt,
        confidence: value === null ? "low" : "high",
        notes: null,
      });
    }
  }
  return out;
}

// Same heuristic as the manual-import parser; kept duplicated rather than
// shared because the import script's parser deals with .xlsx specifics.
function parseScreenerNumber(raw: string): {
  value: number | null;
  unit: string | null;
} {
  const s = raw.trim();
  if (s === "" || s === "-" || s.toLowerCase() === "n/a") {
    return { value: null, unit: null };
  }
  let unit: string | null = null;
  if (/%$/.test(s)) unit = "percent";
  else if (/\bcr\.?\b/i.test(s)) unit = "crore";
  else if (/\blakh\b/i.test(s)) unit = "lakh";
  const negativeFromParens = /^\(.*\)$/.test(s);
  const cleaned = s
    .replace(/[()]/g, "")
    .replace(/[%,]/g, "")
    .replace(/\b(cr\.?|lakh|bn|mn|rs\.?|inr|₹)\b/gi, "")
    .trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, unit };
  return { value: negativeFromParens ? -n : n, unit };
}

interface BuildArgs {
  company: CompanyMaster;
  section: SectionSpec;
  table: ParsedTable;
  fetchedAt: string;
  sourceUrl: string;
}

interface BuildResult {
  rows: ScreenerCompanyFinancialRow[];
  peerRows: ScreenerPeerComparisonRow[];
}

function buildRows(args: BuildArgs): BuildResult {
  const { company, section, table, fetchedAt, sourceUrl } = args;
  const periods = table.headers.slice(1).map((s) => s.trim());

  const sourceLabel = `Screener fetch · ${sourceUrl}`;
  const sourceFile = `screener-fetch:${company.companyId}`;
  const sourceSheet = section.sectionKey;

  if (section.sheetType === "peer_comparison") {
    const peerRows: ScreenerPeerComparisonRow[] = [];
    for (const row of table.rows) {
      const peerName = row.label;
      for (let c = 0; c < row.values.length; c++) {
        const metricName = periods[c];
        if (!metricName) continue;
        const canonical = canonicalizeScreenerMetric(metricName);
        const { value, unit } = parseScreenerNumber(row.values[c]);
        peerRows.push({
          companyId: company.companyId,
          companyName: company.displayName,
          peerCompanyName: peerName,
          sourceMethod: "fetch",
          sourceFile,
          sourceSheet,
          sourceUrl,
          sheetType: section.sheetType,
          period: null,
          periodSortKey: null,
          periodType: "unknown",
          metricName,
          metricCanonical: canonical,
          metricValue: value,
          unit,
          currency: null,
          sourceLabel,
          importedAt: fetchedAt,
          confidence: value === null ? "low" : "high",
          notes: null,
        });
      }
    }
    return { rows: [], peerRows };
  }

  const rows: ScreenerCompanyFinancialRow[] = [];
  for (const row of table.rows) {
    const metricName = row.label;
    const canonical = canonicalizeScreenerMetric(metricName);
    for (let c = 0; c < row.values.length; c++) {
      const period = periods[c];
      if (!period) continue;
      const parsedPeriod = parseScreenerPeriod(period);
      const { value, unit } = parseScreenerNumber(row.values[c]);
      rows.push({
        companyId: company.companyId,
        companyName: company.displayName,
        sourceMethod: "fetch",
        sourceFile,
        sourceSheet,
        sourceUrl,
        sheetType: section.sheetType,
        period: parsedPeriod?.display ?? period,
        periodSortKey: parsedPeriod?.sortKey ?? null,
        periodType: section.periodType,
        metricName,
        metricCanonical: canonical,
        metricValue: value,
        unit,
        currency: null,
        sourceLabel,
        importedAt: fetchedAt,
        confidence: value === null ? "low" : "high",
        notes: null,
      });
    }
  }
  return { rows, peerRows: [] };
}

// ---------------------------------------------------------------------------
// Per-company orchestration.
// ---------------------------------------------------------------------------

interface FetchOutcome {
  status: ScreenerFetchStatusRow;
  rows: ScreenerCompanyFinancialRow[];
  peerRows: ScreenerPeerComparisonRow[];
  error: SnapshotError | null;
}

async function fetchCompany(
  company: CompanyMaster,
  options: CliOptions
): Promise<FetchOutcome> {
  const fetchedAt = new Date().toISOString();

  if (!company.fetchEnabled || !company.screenerSlug) {
    return {
      status: emptyStatus(company, fetchedAt, "skipped", "fetch disabled or slug missing"),
      rows: [],
      peerRows: [],
      error: null,
    };
  }

  const url =
    company.screenerUrl ??
    `https://www.screener.in/company/${company.screenerSlug}/`;

  if (options.dryRun) {
    return {
      status: emptyStatus(
        company,
        fetchedAt,
        "skipped",
        `dry-run: would fetch ${url}`
      ),
      rows: [],
      peerRows: [],
      error: null,
    };
  }

  let html: string;
  try {
    html = await fetchHtml(url, options.timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: {
        companyId: company.companyId,
        companyName: company.displayName,
        screenerSlug: company.screenerSlug,
        screenerUrl: url,
        fetchedAt,
        status: classifyHttpFailure(message),
        sectionsFetched: [],
        rowsWritten: 0,
        latestPeriod: null,
        errorMessage: message,
        notes: null,
      },
      rows: [],
      peerRows: [],
      error: {
        sourceId: "screener",
        companyId: company.companyId,
        message: `${company.companyId}: ${message}`,
        occurredAt: fetchedAt,
      },
    };
  }

  const $ = cheerio.load(html);

  const sectionsToRun = options.sections
    ? SECTIONS.filter((s) => options.sections!.includes(s.sectionKey))
    : SECTIONS;

  const allRows: ScreenerCompanyFinancialRow[] = [];
  const allPeerRows: ScreenerPeerComparisonRow[] = [];
  const sectionsFetched: string[] = [];
  let latestPeriod: string | null = null;

  for (const section of sectionsToRun) {
    if (section.id === "peers") continue; // dedicated path below
    const table = extractTable($, section.id);
    if (!table) continue;
    const built = buildRows({
      company,
      section,
      table,
      fetchedAt,
      sourceUrl: url,
    });
    if (built.rows.length === 0 && built.peerRows.length === 0) continue;
    sectionsFetched.push(section.sectionKey);
    allRows.push(...built.rows);
    allPeerRows.push(...built.peerRows);
    for (const row of built.rows) {
      if (row.periodSortKey && (!latestPeriod || row.periodSortKey > latestPeriod)) {
        latestPeriod = row.periodSortKey;
      }
    }
  }

  // Peers section — multi-strategy fetch (inline → warehouse API → /peers/ → headless).
  let peerStrategy: PeerSectionOutcome["strategy"] = null;
  let peerNote: string | null = null;
  if (sectionsToRun.some((s) => s.id === "peers")) {
    const peerOutcome = await fetchPeerSection({
      company,
      mainPageHtml: html,
      main$: $,
      mainPageUrl: url,
      fetchedAt,
      options,
    });
    if (peerOutcome.rows.length > 0) {
      sectionsFetched.push("peers");
      allPeerRows.push(...peerOutcome.rows);
      peerStrategy = peerOutcome.strategy;
    } else {
      peerNote = peerOutcome.notes;
    }
  }

  const totalRows = allRows.length + allPeerRows.length;
  const missingSections = sectionsToRun
    .filter((s) => !sectionsFetched.includes(s.sectionKey))
    .map((s) => s.sectionKey);
  const finalStatus: ScreenerFetchStatus =
    totalRows === 0
      ? "error"
      : missingSections.length === 0
        ? "ok"
        : "partial";

  // Compose a more specific note when only peers is missing.
  let statusNotes: string | null = null;
  if (finalStatus === "partial") {
    if (missingSections.length === 1 && missingSections[0] === "peers") {
      statusNotes = peerNote ?? "Peer table not extractable from Screener.";
    } else {
      statusNotes = `Missing sections: ${missingSections.join(", ")}`;
    }
  } else if (finalStatus === "ok" && peerStrategy) {
    statusNotes = `Peer data via ${peerStrategy}.`;
  }

  return {
    status: {
      companyId: company.companyId,
      companyName: company.displayName,
      screenerSlug: company.screenerSlug,
      screenerUrl: url,
      fetchedAt,
      status: finalStatus,
      sectionsFetched,
      rowsWritten: totalRows,
      latestPeriod,
      errorMessage:
        finalStatus === "error"
          ? "No expected tables found in page HTML — Screener structure may have changed."
          : null,
      notes: statusNotes,
    },
    rows: allRows,
    peerRows: allPeerRows,
    error:
      finalStatus === "error"
        ? {
            sourceId: "screener",
            companyId: company.companyId,
            message: `${company.companyId}: page returned no expected tables`,
            occurredAt: fetchedAt,
          }
        : null,
  };
}

function emptyStatus(
  company: CompanyMaster,
  fetchedAt: string,
  status: ScreenerFetchStatus,
  notes: string
): ScreenerFetchStatusRow {
  return {
    companyId: company.companyId,
    companyName: company.displayName,
    screenerSlug: company.screenerSlug,
    screenerUrl: company.screenerUrl,
    fetchedAt,
    status,
    sectionsFetched: [],
    rowsWritten: 0,
    latestPeriod: null,
    errorMessage: null,
    notes,
  };
}

function classifyHttpFailure(message: string): ScreenerFetchStatus {
  if (/HTTP\s+4(0[3-4]|29)/i.test(message)) return "blocked";
  if (/abort|timeout/i.test(message)) return "error";
  return "error";
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

  const allFetchRows: ScreenerCompanyFinancialRow[] = [];
  const allFetchPeerRows: ScreenerPeerComparisonRow[] = [];
  const statusRows: ScreenerFetchStatusRow[] = [];
  const errors: SnapshotError[] = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    if (i > 0 && !options.dryRun) await sleep(options.delayMs);
    const outcome = await fetchCompany(company, options);
    statusRows.push(outcome.status);
    allFetchRows.push(...outcome.rows);
    allFetchPeerRows.push(...outcome.peerRows);
    if (outcome.error) errors.push(outcome.error);
  }

  // Merge: preserve `sourceMethod === "import"` rows; replace `"fetch"` rows.
  const sharedSource: SourceMeta = {
    sourceClass: "manual",
    sourceUrl: "https://www.screener.in/company/",
    sourceLabel: "Screener fetch + manual import (shared snapshot)",
    fetchedAt: new Date().toISOString(),
    publishedAt: null,
    notes:
      "Rows tagged sourceMethod='fetch' are managed by screener-fetch.ts; rows tagged 'import' are managed by screener-export.ts.",
  };

  // Only touch fetch rows for companies attempted this run. Rows for other
  // companies — whether method=fetch or method=import — pass through
  // untouched. This means `--company tcs` (even if blocked) leaves
  // Infosys / HCLTech / Wipro rows alone.
  const attemptedCompanyIds = new Set(companies.map((c) => c.companyId));
  const existingFinancials =
    (await readSnapshot<ScreenerCompanyFinancialRow>(
      "screener-normalized-financials.json"
    )) ?? null;
  const preservedFinancials = (existingFinancials?.rows ?? []).filter(
    (row) =>
      row.sourceMethod !== "fetch" || !attemptedCompanyIds.has(row.companyId)
  );
  const mergedFinancials = [...preservedFinancials, ...allFetchRows];

  await writeSnapshot<ScreenerCompanyFinancialRow>(
    "screener-normalized-financials.json",
    {
      meta: buildMeta({
        snapshotId: "screener-normalized-financials",
        description:
          "Normalized rows from client-provided Screener exports — import-backed, NOT source-backed.",
        rowCount: mergedFinancials.length,
        source: sharedSource,
        notesWhenEmpty:
          "No Screener exports have been provided yet. Drop files into data/manual/screener/ or run `npm run ingest:screener:fetch`.",
        errors,
      }),
      rows: mergedFinancials,
    }
  );

  const existingPeer =
    (await readSnapshot<ScreenerPeerComparisonRow>(
      "screener-peer-comparison.json"
    )) ?? null;
  // Same per-company preservation rule as the financials merge above.
  const preservedPeer = (existingPeer?.rows ?? []).filter(
    (row) =>
      row.sourceMethod !== "fetch" || !attemptedCompanyIds.has(row.companyId)
  );
  const mergedPeer = [...preservedPeer, ...allFetchPeerRows];

  await writeSnapshot<ScreenerPeerComparisonRow>(
    "screener-peer-comparison.json",
    {
      meta: buildMeta({
        snapshotId: "screener-peer-comparison",
        description:
          "Peer-comparison rows from Screener (fetched or imported).",
        rowCount: mergedPeer.length,
        source: sharedSource,
        notesWhenEmpty:
          "No Screener peer comparison data yet (fetch blocked or no manual export with a Peer sheet).",
        errors,
      }),
      rows: mergedPeer,
    }
  );

  await writeSnapshot<ScreenerFetchStatusRow>(
    "screener-fetch-status.json",
    {
      meta: buildMeta({
        snapshotId: "screener-fetch-status",
        description: "Per-company health of the automated Screener fetcher.",
        rowCount: statusRows.length,
        source: {
          sourceClass: "manual",
          sourceUrl: "https://www.screener.in/company/",
          sourceLabel: "Screener automated fetch",
          fetchedAt: new Date().toISOString(),
          publishedAt: null,
          notes:
            "Cached. Dashboard reads these rows; the UI never live-fetches.",
        },
        notesWhenEmpty:
          "No companies attempted. Check --company filter or config.",
        errors,
      }),
      rows: statusRows,
    }
  );

  const okCount = statusRows.filter((r) => r.status === "ok").length;
  const partialCount = statusRows.filter((r) => r.status === "partial").length;
  const blockedCount = statusRows.filter((r) => r.status === "blocked").length;
  const errorCount = statusRows.filter((r) => r.status === "error").length;
  console.log(
    `[screener:fetch] companies=${companies.length}` +
      ` ok=${okCount} partial=${partialCount} blocked=${blockedCount}` +
      ` error=${errorCount}` +
      ` financialsRows=${allFetchRows.length}` +
      ` peerRows=${allFetchPeerRows.length}`
  );
}

main().catch((error) => {
  console.error("[screener:fetch] failed:", error);
  process.exitCode = 1;
});
