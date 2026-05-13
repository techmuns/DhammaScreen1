// Screener-compatible export parser for Dhamma Dashboard 1.
//
// Run:        npm run ingest:screener
// Reads:      data/manual/screener/<companyId>.{xlsx,csv}
// Writes:
//   - src/data/snapshots/screener-import-status.json
//   - src/data/snapshots/screener-normalized-financials.json
//   - src/data/snapshots/screener-peer-comparison.json
//
// Rules:
//   - Output is IMPORT-BACKED. Never merged into the official financial
//     snapshots; UI must mark these rows separately.
//   - No automatic scraping of screener.in. Files must be supplied by the
//     client / analyst.
//   - Missing values stay null. No fake zeros, no fake percentages.
//   - When no files are present, exit cleanly with `status: "empty"`.
//   - exceljs is lazy-loaded so the cold "no files" path doesn't even
//     touch the dep.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Snapshot,
  SnapshotError,
  SnapshotMeta,
  SnapshotStatus,
  SourceMeta,
  ScreenerCompanyFinancialRow,
  ScreenerImportConfidence,
  ScreenerImportFileStatus,
  ScreenerImportStatusRow,
  ScreenerPeerComparisonRow,
  ScreenerPeriodType,
  ScreenerSheetType,
} from "../../src/data/types/dhammaDashboard";
import {
  canonicalizeScreenerMetric,
  parseScreenerPeriod,
} from "../../src/data/helpers/screenerMapping";

const here = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = resolve(here, "../../data/manual/screener");
const SNAPSHOT_DIR = resolve(here, "../../src/data/snapshots");

const SUPPORTED_EXTENSIONS = new Set([".xlsx", ".csv"]);

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

function deriveStatus(rowCount: number, hasErrors: boolean): SnapshotStatus {
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
        ? `Some files failed (${errors.length} errors recorded).`
        : status === "error"
          ? `All files failed (${errors.length} errors recorded).`
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

async function writeSnapshot<TRow>(
  filename: string,
  snapshot: Snapshot<TRow>
): Promise<void> {
  const filePath = resolve(SNAPSHOT_DIR, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Cell / sheet classification
// ---------------------------------------------------------------------------

function classifySheetName(name: string): ScreenerSheetType {
  const n = name.toLowerCase().trim();
  if (n.includes("peer")) return "peer_comparison";
  if (n.includes("quarter")) return "quarterly_results";
  if (n.includes("ratio")) return "ratios";
  if (n.includes("balance")) return "balance_sheet";
  if (n.includes("cash flow") || n.includes("cashflow")) return "cash_flow";
  if (n.includes("profit") || n.includes("p&l") || n.includes("p & l")) {
    return "profit_and_loss";
  }
  return "unknown";
}

function periodTypeForSheet(
  sheetType: ScreenerSheetType
): ScreenerPeriodType {
  switch (sheetType) {
    case "quarterly_results":
      return "quarter";
    case "profit_and_loss":
    case "balance_sheet":
    case "cash_flow":
    case "ratios":
      return "year";
    case "peer_comparison":
    case "unknown":
      return "unknown";
  }
}

// For .csv, the filename can carry a sheet-type hint after a double
// underscore: `tcs__quarters.csv`, `tcs__profit-and-loss.csv`. The first
// token before `__` is the companyId; the rest (with `-` and `_`
// replaced by spaces) feeds back into `classifySheetName`.
function companyIdFromFilename(filename: string): string {
  const base = basename(filename, extname(filename));
  const head = base.split("__")[0] ?? base;
  return head.trim().toLowerCase();
}

function csvSheetNameFromFilename(filename: string): string {
  const base = basename(filename, extname(filename));
  const parts = base.split("__");
  if (parts.length < 2) return base;
  return parts.slice(1).join(" ").replace(/[-_]+/g, " ");
}

// Screener cells often include "%", "Rs.", "Cr.", commas, etc.
// Return null if the cell does not parse to a finite number.
function parseScreenerNumber(raw: unknown): {
  value: number | null;
  unit: string | null;
} {
  if (raw === null || raw === undefined) return { value: null, unit: null };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: raw, unit: null } : { value: null, unit: null };
  }
  const s = String(raw).trim();
  if (s === "" || s === "-" || s.toLowerCase() === "n/a") {
    return { value: null, unit: null };
  }
  let unit: string | null = null;
  if (/%$/.test(s)) unit = "percent";
  else if (/\bcr\.?\b/i.test(s)) unit = "crore";
  else if (/\blakh\b/i.test(s)) unit = "lakh";
  else if (/\bbn\b/i.test(s)) unit = "billion";
  else if (/\bmn\b/i.test(s)) unit = "million";
  // Strip currency symbols, units, commas, surrounding parens (negative).
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

// ---------------------------------------------------------------------------
// File readers
// ---------------------------------------------------------------------------

interface ParsedSheet {
  sheetName: string;
  rows: string[][];
}

// Minimal CSV parser: handles quoted fields with embedded commas and
// double-quote escapes. Good enough for Screener-style exports.
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readCsvFile(filePath: string): Promise<ParsedSheet[]> {
  const content = await readFile(filePath, "utf8");
  const rows = parseCsv(content);
  return [{ sheetName: csvSheetNameFromFilename(filePath), rows }];
}

async function readXlsxFile(filePath: string): Promise<ParsedSheet[]> {
  // Lazy import so the cold path (no files / only CSVs) never loads exceljs.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: ParsedSheet[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const raw = row.values as Array<unknown>;
      // exceljs returns 1-indexed; index 0 is null padding.
      const trimmed = raw.slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && v !== null) {
          const rich = v as { result?: unknown; text?: unknown };
          if (rich.result !== undefined) return String(rich.result);
          if (rich.text !== undefined) return String(rich.text);
          return "";
        }
        return String(v);
      });
      rows.push(trimmed);
    });
    sheets.push({ sheetName: sheet.name, rows });
  });
  return sheets;
}

async function readSpreadsheet(filePath: string): Promise<ParsedSheet[]> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".xlsx") return readXlsxFile(filePath);
  if (ext === ".csv") return readCsvFile(filePath);
  throw new Error(`Unsupported file extension: ${ext}`);
}

// ---------------------------------------------------------------------------
// Sheet → row normalization
// ---------------------------------------------------------------------------

interface NormalizedSheetResult {
  rows: ScreenerCompanyFinancialRow[];
  peerRows: ScreenerPeerComparisonRow[];
  status: ScreenerImportFileStatus;
  notes: string | null;
}

function normalizeSheet(args: {
  companyId: string;
  companyName: string;
  sourceFile: string;
  sheet: ParsedSheet;
  importedAt: string;
}): NormalizedSheetResult {
  const { companyId, companyName, sourceFile, sheet, importedAt } = args;
  const sheetType = classifySheetName(sheet.sheetName);
  const periodType = periodTypeForSheet(sheetType);

  if (sheet.rows.length < 2) {
    return {
      rows: [],
      peerRows: [],
      status: "skipped",
      notes: "Sheet has no body rows.",
    };
  }

  // Convention: first row is the period header (or peer header), first
  // column is the metric name. Both header cells and metric cells may
  // be blank in Screener exports; skip those cleanly.
  const header = sheet.rows[0];
  const periods = header.slice(1).map((p) => (p ?? "").toString().trim());

  if (sheetType === "peer_comparison") {
    const peerRows: ScreenerPeerComparisonRow[] = [];
    for (let r = 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      const peerName = (row[0] ?? "").toString().trim();
      if (!peerName) continue;
      for (let c = 1; c < row.length; c++) {
        const metricName = periods[c - 1];
        if (!metricName) continue;
        const { value, unit } = parseScreenerNumber(row[c]);
        const canonical = canonicalizeScreenerMetric(metricName);
        peerRows.push({
          companyId,
          companyName,
          peerCompanyName: peerName,
          sourceFile,
          sourceSheet: sheet.sheetName,
          sheetType,
          period: null,
          periodSortKey: null,
          periodType: "unknown",
          metricName,
          metricCanonical: canonical,
          metricValue: value,
          unit,
          currency: null,
          sourceLabel: `Screener export: ${sourceFile} / ${sheet.sheetName}`,
          importedAt,
          confidence: classifyConfidence(value),
          notes: null,
        });
      }
    }
    return {
      rows: [],
      peerRows,
      status: peerRows.length === 0 ? "skipped" : "ok",
      notes: peerRows.length === 0 ? "Peer-comparison sheet had no parseable cells." : null,
    };
  }

  const rows: ScreenerCompanyFinancialRow[] = [];
  for (let r = 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const metricName = (row[0] ?? "").toString().trim();
    if (!metricName) continue;
    const canonical = canonicalizeScreenerMetric(metricName);
    for (let c = 1; c < row.length; c++) {
      const period = periods[c - 1];
      if (!period) continue;
      const parsedPeriod = parseScreenerPeriod(period);
      const { value, unit } = parseScreenerNumber(row[c]);
      rows.push({
        companyId,
        companyName,
        sourceFile,
        sourceSheet: sheet.sheetName,
        sheetType,
        period: parsedPeriod?.display ?? period,
        periodSortKey: parsedPeriod?.sortKey ?? null,
        periodType,
        metricName,
        metricCanonical: canonical,
        metricValue: value,
        unit,
        currency: null,
        sourceLabel: `Screener export: ${sourceFile} / ${sheet.sheetName}`,
        importedAt,
        confidence: classifyConfidence(value),
        notes: null,
      });
    }
  }

  return {
    rows,
    peerRows: [],
    status: rows.length === 0 ? "skipped" : "ok",
    notes: rows.length === 0 ? "No parseable rows in sheet." : null,
  };
}

function classifyConfidence(
  value: number | null
): ScreenerImportConfidence {
  // Anything that parsed to a finite number is "high"; everything else
  // is "low". "medium" is reserved for ambiguous unit parses (future work).
  return value === null ? "low" : "high";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function listInputFiles(): Promise<string[]> {
  if (!existsSync(INPUT_DIR)) return [];
  const entries = await readdir(INPUT_DIR);
  return entries
    .filter((name) => SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((name) => join(INPUT_DIR, name));
}

async function main(): Promise<void> {
  const importedAt = new Date().toISOString();
  const files = await listInputFiles();

  const sourceMeta: SourceMeta = {
    sourceClass: "manual",
    sourceUrl: null,
    sourceLabel: "data/manual/screener/ — client-provided exports",
    fetchedAt: importedAt,
    publishedAt: null,
    notes: "Import-backed. Never merged into the official financial snapshots.",
  };

  if (files.length === 0) {
    // Cold path: write empty snapshots and exit cleanly.
    await writeSnapshot<ScreenerImportStatusRow>("screener-import-status.json", {
      meta: buildMeta({
        snapshotId: "screener-import-status",
        description:
          "Status of each parsed sheet from client-provided Screener exports in data/manual/screener/.",
        rowCount: 0,
        source: sourceMeta,
        notesWhenEmpty:
          "No Screener exports have been provided yet. Drop files into data/manual/screener/ then run `npm run ingest:screener`.",
      }),
      rows: [],
    });
    await writeSnapshot<ScreenerCompanyFinancialRow>(
      "screener-normalized-financials.json",
      {
        meta: buildMeta({
          snapshotId: "screener-normalized-financials",
          description:
            "Normalized rows from client-provided Screener exports — import-backed, NOT source-backed.",
          rowCount: 0,
          source: sourceMeta,
          notesWhenEmpty:
            "No Screener exports have been provided yet. Drop files into data/manual/screener/.",
        }),
        rows: [],
      }
    );
    await writeSnapshot<ScreenerPeerComparisonRow>(
      "screener-peer-comparison.json",
      {
        meta: buildMeta({
          snapshotId: "screener-peer-comparison",
          description:
            "Peer-comparison rows extracted from Screener exports' Peer Comparison sheets.",
          rowCount: 0,
          source: sourceMeta,
          notesWhenEmpty:
            "No Screener exports with a Peer Comparison sheet have been provided yet.",
        }),
        rows: [],
      }
    );
    console.log("[screener] no files in data/manual/screener/. Wrote empty snapshots.");
    return;
  }

  const allNormalized: ScreenerCompanyFinancialRow[] = [];
  const allPeer: ScreenerPeerComparisonRow[] = [];
  const statusRows: ScreenerImportStatusRow[] = [];
  const errors: SnapshotError[] = [];

  for (const filePath of files) {
    const sourceFile = basename(filePath);
    const companyId = companyIdFromFilename(filePath);

    let sheets: ParsedSheet[];
    try {
      sheets = await readSpreadsheet(filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      statusRows.push({
        sourceFile,
        sourceSheet: null,
        sheetType: null,
        companyId,
        status: "error",
        rowCount: 0,
        importedAt,
        notes: "Failed to open spreadsheet.",
        errorMessage: message,
      });
      errors.push({
        sourceId: null,
        companyId,
        message: `screener-export ${sourceFile}: ${message}`,
        occurredAt: importedAt,
      });
      continue;
    }

    for (const sheet of sheets) {
      const sheetType = classifySheetName(sheet.sheetName);
      const normalized = normalizeSheet({
        companyId,
        companyName: companyId,
        sourceFile,
        sheet,
        importedAt,
      });
      allNormalized.push(...normalized.rows);
      allPeer.push(...normalized.peerRows);
      statusRows.push({
        sourceFile,
        sourceSheet: sheet.sheetName,
        sheetType,
        companyId,
        status: normalized.status,
        rowCount: normalized.rows.length + normalized.peerRows.length,
        importedAt,
        notes: normalized.notes,
        errorMessage: null,
      });
    }
  }

  await writeSnapshot<ScreenerImportStatusRow>("screener-import-status.json", {
    meta: buildMeta({
      snapshotId: "screener-import-status",
      description:
        "Status of each parsed sheet from client-provided Screener exports in data/manual/screener/.",
      rowCount: statusRows.length,
      source: sourceMeta,
      notesWhenEmpty: "No Screener exports were provided.",
      errors,
    }),
    rows: statusRows,
  });

  await writeSnapshot<ScreenerCompanyFinancialRow>(
    "screener-normalized-financials.json",
    {
      meta: buildMeta({
        snapshotId: "screener-normalized-financials",
        description:
          "Normalized rows from client-provided Screener exports — import-backed, NOT source-backed.",
        rowCount: allNormalized.length,
        source: sourceMeta,
        notesWhenEmpty: "No parseable financial rows in provided files.",
        errors,
      }),
      rows: allNormalized,
    }
  );

  await writeSnapshot<ScreenerPeerComparisonRow>(
    "screener-peer-comparison.json",
    {
      meta: buildMeta({
        snapshotId: "screener-peer-comparison",
        description:
          "Peer-comparison rows extracted from Screener exports' Peer Comparison sheets.",
        rowCount: allPeer.length,
        source: sourceMeta,
        notesWhenEmpty: "No Peer Comparison sheets found in provided files.",
        errors,
      }),
      rows: allPeer,
    }
  );

  console.log(
    `[screener] files=${files.length} normalizedRows=${allNormalized.length}` +
      ` peerRows=${allPeer.length} statusRows=${statusRows.length}` +
      ` errors=${errors.length}`
  );
}

main().catch((error) => {
  console.error("[screener] failed:", error);
  process.exitCode = 1;
});
