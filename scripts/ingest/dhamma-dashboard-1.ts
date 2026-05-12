// Ingestion entry point for Dhamma Dashboard 1.
//
// Run locally:    npm run ingest:dhamma
// Run in CI:      .github/workflows/ingest-dhamma-dashboard-1.yml
//
// Today this script is a scaffold:
//   - It reads configured companies + peer groups.
//   - It calls the placeholder adapter, which returns empty arrays.
//   - It writes well-formed snapshots with `status: "empty"` and notes
//     indicating the source has not been wired yet.
//
// When a real adapter is added (e.g. NSE/BSE filings), swap
// `placeholderAdapter` for the new adapter in `runIngestion`.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPANIES, PEER_GROUPS } from "../config/dhamma-companies";
import {
  placeholderAdapter,
  type DhammaSourceAdapter,
} from "../config/dhamma-sources";
import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  CompanyMaster,
  GuidanceCommentaryRow,
  PeerGroup,
  QuarterlyFinancialRow,
  SegmentRevenueRow,
  Snapshot,
  SnapshotMeta,
  SnapshotStatus,
  SourceMeta,
} from "../../src/data/types/dhammaDashboard";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(here, "../../src/data/snapshots");

interface IngestionConfig {
  companies: CompanyMaster[];
  peerGroups: PeerGroup[];
  adapter: DhammaSourceAdapter;
}

function deriveStatus(rowCount: number): SnapshotStatus {
  return rowCount === 0 ? "empty" : "ok";
}

function buildMeta(args: {
  snapshotId: string;
  description: string;
  rowCount: number;
  source: SourceMeta;
  notesWhenEmpty: string;
}): SnapshotMeta {
  const status = deriveStatus(args.rowCount);
  return {
    snapshotId: args.snapshotId,
    description: args.description,
    generatedAt: new Date().toISOString(),
    rowCount: args.rowCount,
    status,
    notes: status === "empty" ? args.notesWhenEmpty : null,
    source: args.source,
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
      // Never let one company's failure block the pipeline. Log and continue.
      // Snapshot status will reflect partial coverage; UI renders dashes.
      console.warn(
        `[ingest] ${company.companyId}: fetch failed`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return rows;
}

async function runIngestion(config: IngestionConfig): Promise<void> {
  const { companies, peerGroups, adapter } = config;
  const adapterSource: SourceMeta = {
    sourceClass: "nse_bse_filing",
    sourceUrl: null,
    sourceLabel: "Placeholder adapter — no real source wired yet",
    fetchedAt: new Date().toISOString(),
    publishedAt: null,
    notes:
      "Replace placeholderAdapter in scripts/ingest/dhamma-dashboard-1.ts with a real adapter.",
  };

  // Company master is derived from config, not from a remote source.
  await writeSnapshot<CompanyMaster>("company-master.json", {
    meta: buildMeta({
      snapshotId: "company-master",
      description:
        "Master list of tracked Indian companies and their identifiers.",
      rowCount: companies.length,
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
    rows: companies,
  });

  // Peer groups are also config-driven; not a separate snapshot file today.
  // Tracked here so that when we add `peer-groups.json` later, the ingestion
  // already knows about them.
  if (peerGroups.length > 0) {
    console.log(`[ingest] ${peerGroups.length} peer group(s) configured.`);
  }

  const quarterly = await gatherRows<QuarterlyFinancialRow>(
    companies,
    (company) => adapter.fetchQuarterlyFinancials(company)
  );
  await writeSnapshot<QuarterlyFinancialRow>("quarterly-financials.json", {
    meta: buildMeta({
      snapshotId: "quarterly-financials",
      description:
        "Last 5 quarters of P&L line items per company, derived from NSE/BSE quarterly filings.",
      rowCount: quarterly.length,
      source: adapterSource,
      notesWhenEmpty:
        "Adapter not yet wired; run will produce empty rows until a real source is configured.",
    }),
    rows: quarterly,
  });

  const annual = await gatherRows<AnnualFinancialRow>(companies, (company) =>
    adapter.fetchAnnualFinancials(company)
  );
  await writeSnapshot<AnnualFinancialRow>("annual-financials.json", {
    meta: buildMeta({
      snapshotId: "annual-financials",
      description:
        "Last 5 fiscal years of P&L line items per company, derived from annual reports / Q4 filings.",
      rowCount: annual.length,
      source: { ...adapterSource, sourceClass: "annual_report" },
      notesWhenEmpty: "Adapter not yet wired.",
    }),
    rows: annual,
  });

  const segments = await gatherRows<SegmentRevenueRow>(companies, (company) =>
    adapter.fetchSegmentRevenue(company)
  );
  await writeSnapshot<SegmentRevenueRow>("segment-revenue.json", {
    meta: buildMeta({
      snapshotId: "segment-revenue",
      description:
        "Per-segment revenue rows from the segment disclosure block of NSE/BSE filings.",
      rowCount: segments.length,
      source: adapterSource,
      notesWhenEmpty:
        "Adapter not yet wired; segment normalization map also pending.",
    }),
    rows: segments,
  });

  const balance = await gatherRows<BalanceSheetRow>(companies, (company) =>
    adapter.fetchBalanceSheet(company)
  );
  await writeSnapshot<BalanceSheetRow>("balance-sheet.json", {
    meta: buildMeta({
      snapshotId: "balance-sheet",
      description:
        "Summary balance sheet rows from quarterly filings and annual reports.",
      rowCount: balance.length,
      source: adapterSource,
      notesWhenEmpty: "Adapter not yet wired.",
    }),
    rows: balance,
  });

  const cashFlow = await gatherRows<CashFlowRow>(companies, (company) =>
    adapter.fetchCashFlow(company)
  );
  await writeSnapshot<CashFlowRow>("cash-flow.json", {
    meta: buildMeta({
      snapshotId: "cash-flow",
      description:
        "Condensed cash flow rows: CFO, working capital changes, CFI, CFF.",
      rowCount: cashFlow.length,
      source: { ...adapterSource, sourceClass: "annual_report" },
      notesWhenEmpty:
        "Most Indian listed companies do not file a quarterly CFS; expect half-yearly/annual coverage when wired.",
    }),
    rows: cashFlow,
  });

  const guidance = await gatherRows<GuidanceCommentaryRow>(
    companies,
    (company) => adapter.fetchGuidanceCommentary(company)
  );
  await writeSnapshot<GuidanceCommentaryRow>("guidance-commentary.json", {
    meta: buildMeta({
      snapshotId: "guidance-commentary",
      description:
        "Extracted forward-looking statements from earnings call transcripts.",
      rowCount: guidance.length,
      source: { ...adapterSource, sourceClass: "concall_transcript" },
      notesWhenEmpty:
        "Transcript ingestion is Audit-status; not wired until extraction is reviewed.",
    }),
    rows: guidance,
  });

  // guidance-actual-comparison is derived downstream; emit an empty snapshot
  // shell so consumers can rely on the file existing.
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
        "Derivation not yet implemented; pending guidance ingestion.",
    }),
    rows: [],
  });

  console.log(
    `[ingest] done. companies=${companies.length} ` +
      `quarterly=${quarterly.length} annual=${annual.length} ` +
      `segments=${segments.length} balance=${balance.length} ` +
      `cashFlow=${cashFlow.length} guidance=${guidance.length}`
  );
}

async function main(): Promise<void> {
  await runIngestion({
    companies: COMPANIES,
    peerGroups: PEER_GROUPS,
    adapter: placeholderAdapter,
  });
}

main().catch((error) => {
  console.error("[ingest] failed:", error);
  process.exitCode = 1;
});
