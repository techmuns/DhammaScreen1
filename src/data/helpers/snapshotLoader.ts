// Loads every snapshot JSON at build time and re-exports them as typed
// `Snapshot<T>` objects. UI components import from here, never directly
// from the JSON files, so the cast happens in exactly one place.

import annualJson from "../snapshots/annual-financials.json";
import balanceSheetJson from "../snapshots/balance-sheet.json";
import cashFlowJson from "../snapshots/cash-flow.json";
import companyMasterJson from "../snapshots/company-master.json";
import filingManifestJson from "../snapshots/filing-manifest.json";
import guidanceActualJson from "../snapshots/guidance-actual-comparison.json";
import guidanceCommentaryJson from "../snapshots/guidance-commentary.json";
import quarterlyJson from "../snapshots/quarterly-financials.json";
import screenerImportStatusJson from "../snapshots/screener-import-status.json";
import screenerNormalizedJson from "../snapshots/screener-normalized-financials.json";
import screenerPeerJson from "../snapshots/screener-peer-comparison.json";
import segmentRevenueJson from "../snapshots/segment-revenue.json";
import sourceHealthJson from "../snapshots/source-health.json";

import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  CompanyMaster,
  FilingManifestRow,
  GuidanceActualComparisonRow,
  GuidanceCommentaryRow,
  QuarterlyFinancialRow,
  ScreenerCompanyFinancialRow,
  ScreenerImportStatusRow,
  ScreenerPeerComparisonRow,
  SegmentRevenueRow,
  Snapshot,
  SnapshotMeta,
  SourceHealthRow,
} from "../types/dhammaDashboard";

function asSnapshot<T>(data: unknown): Snapshot<T> {
  return data as Snapshot<T>;
}

export const companyMasterSnapshot =
  asSnapshot<CompanyMaster>(companyMasterJson);
export const quarterlyFinancialsSnapshot =
  asSnapshot<QuarterlyFinancialRow>(quarterlyJson);
export const annualFinancialsSnapshot =
  asSnapshot<AnnualFinancialRow>(annualJson);
export const segmentRevenueSnapshot =
  asSnapshot<SegmentRevenueRow>(segmentRevenueJson);
export const balanceSheetSnapshot =
  asSnapshot<BalanceSheetRow>(balanceSheetJson);
export const cashFlowSnapshot = asSnapshot<CashFlowRow>(cashFlowJson);
export const filingManifestSnapshot =
  asSnapshot<FilingManifestRow>(filingManifestJson);
export const sourceHealthSnapshot =
  asSnapshot<SourceHealthRow>(sourceHealthJson);
export const guidanceCommentarySnapshot =
  asSnapshot<GuidanceCommentaryRow>(guidanceCommentaryJson);
export const guidanceActualSnapshot =
  asSnapshot<GuidanceActualComparisonRow>(guidanceActualJson);
export const screenerImportStatusSnapshot =
  asSnapshot<ScreenerImportStatusRow>(screenerImportStatusJson);
export const screenerNormalizedSnapshot =
  asSnapshot<ScreenerCompanyFinancialRow>(screenerNormalizedJson);
export const screenerPeerSnapshot =
  asSnapshot<ScreenerPeerComparisonRow>(screenerPeerJson);

// Single ordered list used by the data-provenance panel.
export const ALL_SNAPSHOT_METAS: ReadonlyArray<SnapshotMeta> = [
  companyMasterSnapshot.meta,
  filingManifestSnapshot.meta,
  sourceHealthSnapshot.meta,
  quarterlyFinancialsSnapshot.meta,
  annualFinancialsSnapshot.meta,
  segmentRevenueSnapshot.meta,
  balanceSheetSnapshot.meta,
  cashFlowSnapshot.meta,
  guidanceCommentarySnapshot.meta,
  guidanceActualSnapshot.meta,
  screenerImportStatusSnapshot.meta,
  screenerNormalizedSnapshot.meta,
  screenerPeerSnapshot.meta,
];
