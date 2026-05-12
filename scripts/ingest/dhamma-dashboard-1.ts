// Ingestion entry point for Dhamma Dashboard 1.
//
// Run locally:    npm run ingest:dhamma
// Run in CI:      .github/workflows/ingest-dhamma-dashboard-1.yml
//
// Step 2 scope:
//   - Read configured companies + peer groups.
//   - Run source discovery (NSE + BSE) for each company.
//   - Write filing-manifest.json with one row per discovered filing.
//   - Write source-health.json with one row per (source, company) probe.
//   - Keep existing financial snapshots structurally valid; do NOT extract
//     into them yet (extraction stays Audit until a robust parser exists).
//
// CLI flags (all optional):
//   --company <companyId>      filter to one company; repeatable
//   --source <sourceId>        filter to one discovery source; repeatable
//   --max-filings <N>          cap filings per (company, source); default 25
//   --discover-only            (default behaviour today; flag accepted for forward-compat)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPANIES, PEER_GROUPS } from "../config/dhamma-companies";
import {
  DISCOVERY_ADAPTERS,
  placeholderAdapter,
  SOURCE_REGISTRY,
  type DhammaDiscoveryAdapter,
  type DhammaSourceAdapter,
} from "../config/dhamma-sources";
import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  CompanyMaster,
  FilingManifestRow,
  GuidanceCommentaryRow,
  PeerGroup,
  QuarterlyFinancialRow,
  SegmentRevenueRow,
  Snapshot,
  SnapshotError,
  SnapshotMeta,
  SnapshotStatus,
  SourceHealthRow,
  SourceMeta,
} from "../../src/data/types/dhammaDashboard";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(here, "../../src/data/snapshots");

interface CliOptions {
  companyIds: string[] | null;
  sourceIds: string[] | null;
  maxFilings: number;
  discoverOnly: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    companyIds: null,
    sourceIds: null,
    maxFilings: 25,
    discoverOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--company" && next) {
      (opts.companyIds ??= []).push(next.toLowerCase());
      i++;
    } else if (arg === "--source" && next) {
      (opts.sourceIds ??= []).push(next.toLowerCase());
      i++;
    } else if (arg === "--max-filings" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.maxFilings = parsed;
      i++;
    } else if (arg === "--discover-only") {
      opts.discoverOnly = true;
    }
  }
  return opts;
}

interface IngestionConfig {
  companies: CompanyMaster[];
  peerGroups: PeerGroup[];
  adapter: DhammaSourceAdapter;
  discoveryAdapters: DhammaDiscoveryAdapter[];
  options: CliOptions;
}

function deriveStatus(rowCount: number, hasErrors: boolean): SnapshotStatus {
  if (rowCount === 0) {
    return hasErrors ? "error" : "empty";
  }
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
        ? `Some sources failed (${errors.length} errors recorded).`
        : status === "error"
          ? `All sources failed (${errors.length} errors recorded).`
          : null;
  return {
    snapshotId: args.snapshotId,
    description: args.description,
    generatedAt: new Date().toISOString(),
    rowCount: args.rowCount,
    status,
    notes,
    source: args.source,
    errors: errors.length > 0 ? errors : [],
  };
}

async function writeSnapshot<TRow>(
  filename: string,
  snapshot: Snapshot<TRow>
): Promise<void> {
  const filePath = resolve(SNAPSHOT_DIR, filename);
  await mkdir(dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(filePath, serialized, "utf8");
}

interface DiscoveryRun {
  manifestRows: FilingManifestRow[];
  healthRows: SourceHealthRow[];
  errors: SnapshotError[];
}

async function runDiscovery(
  companies: CompanyMaster[],
  adapters: DhammaDiscoveryAdapter[],
  options: CliOptions
): Promise<DiscoveryRun> {
  const manifestRows: FilingManifestRow[] = [];
  const healthRows: SourceHealthRow[] = [];
  const errors: SnapshotError[] = [];

  for (const company of companies) {
    for (const adapter of adapters) {
      if (options.sourceIds && !options.sourceIds.includes(adapter.sourceId)) {
        healthRows.push({
          sourceId: adapter.sourceId,
          companyId: company.companyId,
          checkedAt: new Date().toISOString(),
          status: "not_configured",
          filingsDiscovered: 0,
          latestFilingDate: null,
          errorMessage: null,
          notes: "Skipped by --source filter.",
        });
        continue;
      }

      const fetchedAt = new Date().toISOString();
      const result = await adapter.discover(company, {
        maxFilings: options.maxFilings,
        fetchedAt,
      });

      const status: SourceHealthRow["status"] =
        result.error !== null
          ? result.rows.length === 0
            ? "blocked"
            : "partial"
          : result.rows.length === 0
            ? "ok"
            : "ok";

      let latestFilingDate: string | null = null;
      for (const row of result.rows) {
        if (row.filingDate && (!latestFilingDate || row.filingDate > latestFilingDate)) {
          latestFilingDate = row.filingDate;
        }
      }

      healthRows.push({
        sourceId: adapter.sourceId,
        companyId: company.companyId,
        checkedAt: fetchedAt,
        status,
        filingsDiscovered: result.rows.length,
        latestFilingDate,
        errorMessage: result.error,
        notes:
          result.error !== null
            ? "Source returned an error; see errorMessage."
            : result.rows.length === 0
              ? "Source reachable; no filings matched the discovery filter."
              : null,
      });

      manifestRows.push(...result.rows);

      if (result.error) {
        errors.push({
          sourceId: adapter.sourceId,
          companyId: company.companyId,
          message: result.error,
          occurredAt: fetchedAt,
        });
      }
    }
  }

  return { manifestRows, healthRows, errors };
}

async function gatherRows<TRow>(
  companies: CompanyMaster[],
  fetcher: (company: CompanyMaster) => Promise<TRow[]>
): Promise<TRow[]> {
  const rows: TRow[] = [];
  for (const company of companies) {
    try {
      const result = await fetcher(company);
      rows.push(...result);
    } catch (error) {
      console.warn(
        `[ingest] ${company.companyId}: fetch failed`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return rows;
}

async function runIngestion(config: IngestionConfig): Promise<void> {
  const { companies, peerGroups, adapter, discoveryAdapters, options } =
    config;

  const filteredCompanies = options.companyIds
    ? companies.filter((c) => options.companyIds!.includes(c.companyId))
    : companies;

  if (options.companyIds && filteredCompanies.length === 0) {
    console.warn(
      `[ingest] --company filter matched zero companies (${options.companyIds.join(", ")}). Proceeding with empty set.`
    );
  }

  const placeholderSource: SourceMeta = {
    sourceClass: "nse_bse_filing",
    sourceUrl: null,
    sourceLabel:
      "Discovery adapters wired; financial-row extraction not yet implemented (Audit-status).",
    fetchedAt: new Date().toISOString(),
    publishedAt: null,
    notes:
      "Quarterly/annual financial rows still require a parser. See dhamma-dashboard-1-metric-audit.md.",
  };

  // company-master.json — config-derived.
  await writeSnapshot<CompanyMaster>("company-master.json", {
    meta: buildMeta({
      snapshotId: "company-master",
      description:
        "Master list of tracked Indian companies and their identifiers.",
      rowCount: filteredCompanies.length,
      source: {
        sourceClass: "manual",
        sourceUrl: null,
        sourceLabel: "scripts/config/dhamma-companies.ts",
        fetchedAt: new Date().toISOString(),
        publishedAt: null,
        notes: null,
      },
      notesWhenEmpty:
        "No companies configured. Edit scripts/config/dhamma-companies.ts.",
    }),
    rows: filteredCompanies,
  });

  if (peerGroups.length > 0) {
    console.log(`[ingest] ${peerGroups.length} peer group(s) configured.`);
  }

  // Source discovery.
  const discovery = await runDiscovery(
    filteredCompanies,
    discoveryAdapters,
    options
  );

  await writeSnapshot<FilingManifestRow>("filing-manifest.json", {
    meta: buildMeta({
      snapshotId: "filing-manifest",
      description:
        "Discovered filings per company from NSE / BSE / company IR sources.",
      rowCount: discovery.manifestRows.length,
      source: {
        sourceClass: "nse_bse_filing",
        sourceUrl: null,
        sourceLabel: "NSE corporate-announcements + BSE AnnGetData",
        fetchedAt: new Date().toISOString(),
        publishedAt: null,
        notes: null,
      },
      notesWhenEmpty:
        "No filings discovered. Likely all sources are blocked or returned zero rows; check source-health.json.",
      errors: discovery.errors,
    }),
    rows: discovery.manifestRows,
  });

  await writeSnapshot<SourceHealthRow>("source-health.json", {
    meta: buildMeta({
      snapshotId: "source-health",
      description:
        "Per (sourceId, companyId) probe of source reachability and freshness.",
      rowCount: discovery.healthRows.length,
      source: {
        sourceClass: "derived",
        sourceUrl: null,
        sourceLabel: "Derived from discovery adapter results",
        fetchedAt: new Date().toISOString(),
        publishedAt: null,
        notes: null,
      },
      notesWhenEmpty:
        "No source probes run. Check that companies and discovery adapters are configured.",
    }),
    rows: discovery.healthRows,
  });

  // Financial-row snapshots — Step 2 keeps these as structurally valid but
  // empty. Extraction stays Audit until a robust parser exists.
  if (!options.discoverOnly) {
    const quarterly = await gatherRows<QuarterlyFinancialRow>(
      filteredCompanies,
      (company) => adapter.fetchQuarterlyFinancials(company)
    );
    await writeSnapshot<QuarterlyFinancialRow>("quarterly-financials.json", {
      meta: buildMeta({
        snapshotId: "quarterly-financials",
        description:
          "Last 5 quarters of P&L line items per company, derived from NSE/BSE quarterly filings.",
        rowCount: quarterly.length,
        source: placeholderSource,
        notesWhenEmpty:
          "Discovery is wired; extraction is not. Filings appear in filing-manifest.json but are not parsed into rows yet.",
      }),
      rows: quarterly,
    });

    const annual = await gatherRows<AnnualFinancialRow>(
      filteredCompanies,
      (company) => adapter.fetchAnnualFinancials(company)
    );
    await writeSnapshot<AnnualFinancialRow>("annual-financials.json", {
      meta: buildMeta({
        snapshotId: "annual-financials",
        description:
          "Last 5 fiscal years of P&L line items per company, derived from annual reports / Q4 filings.",
        rowCount: annual.length,
        source: { ...placeholderSource, sourceClass: "annual_report" },
        notesWhenEmpty:
          "Discovery is wired; annual-report extraction is not implemented.",
      }),
      rows: annual,
    });

    const segments = await gatherRows<SegmentRevenueRow>(
      filteredCompanies,
      (company) => adapter.fetchSegmentRevenue(company)
    );
    await writeSnapshot<SegmentRevenueRow>("segment-revenue.json", {
      meta: buildMeta({
        snapshotId: "segment-revenue",
        description:
          "Per-segment revenue rows from the segment disclosure block of NSE/BSE filings.",
        rowCount: segments.length,
        source: placeholderSource,
        notesWhenEmpty:
          "Segment extraction depends on a per-company alias map (pending).",
      }),
      rows: segments,
    });

    const balance = await gatherRows<BalanceSheetRow>(
      filteredCompanies,
      (company) => adapter.fetchBalanceSheet(company)
    );
    await writeSnapshot<BalanceSheetRow>("balance-sheet.json", {
      meta: buildMeta({
        snapshotId: "balance-sheet",
        description:
          "Summary balance sheet rows from quarterly filings and annual reports.",
        rowCount: balance.length,
        source: placeholderSource,
        notesWhenEmpty: "Balance-sheet extraction not yet implemented.",
      }),
      rows: balance,
    });

    const cashFlow = await gatherRows<CashFlowRow>(
      filteredCompanies,
      (company) => adapter.fetchCashFlow(company)
    );
    await writeSnapshot<CashFlowRow>("cash-flow.json", {
      meta: buildMeta({
        snapshotId: "cash-flow",
        description:
          "Condensed cash flow rows: CFO, working capital changes, CFI, CFF.",
        rowCount: cashFlow.length,
        source: { ...placeholderSource, sourceClass: "annual_report" },
        notesWhenEmpty:
          "Most Indian listed companies file CFS half-yearly/annually only.",
      }),
      rows: cashFlow,
    });

    const guidance = await gatherRows<GuidanceCommentaryRow>(
      filteredCompanies,
      (company) => adapter.fetchGuidanceCommentary(company)
    );
    await writeSnapshot<GuidanceCommentaryRow>("guidance-commentary.json", {
      meta: buildMeta({
        snapshotId: "guidance-commentary",
        description:
          "Extracted forward-looking statements from earnings call transcripts.",
        rowCount: guidance.length,
        source: { ...placeholderSource, sourceClass: "concall_transcript" },
        notesWhenEmpty:
          "Transcript extraction is Audit-status and intentionally not wired in Step 2.",
      }),
      rows: guidance,
    });

    await writeSnapshot("guidance-actual-comparison.json", {
      meta: buildMeta({
        snapshotId: "guidance-actual-comparison",
        description:
          "Derived comparison of actual results against prior management commentary.",
        rowCount: 0,
        source: {
          sourceClass: "derived",
          sourceUrl: null,
          sourceLabel:
            "Derived from guidance-commentary + quarterly/annual financials",
          fetchedAt: new Date().toISOString(),
          publishedAt: null,
          notes: null,
        },
        notesWhenEmpty:
          "Derivation pending; depends on guidance-commentary rows.",
      }),
      rows: [],
    });
  }

  console.log(
    `[ingest] done. companies=${filteredCompanies.length}` +
      ` discoverySources=${discoveryAdapters.length}` +
      ` filings=${discovery.manifestRows.length}` +
      ` healthRows=${discovery.healthRows.length}` +
      ` errors=${discovery.errors.length}` +
      ` registeredSources=${SOURCE_REGISTRY.length}`
  );
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  await runIngestion({
    companies: COMPANIES,
    peerGroups: PEER_GROUPS,
    adapter: placeholderAdapter,
    discoveryAdapters: DISCOVERY_ADAPTERS,
    options,
  });
}

main().catch((error) => {
  console.error("[ingest] failed:", error);
  process.exitCode = 1;
});
