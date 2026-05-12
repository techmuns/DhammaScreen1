// Source endpoints and adapters used by the ingestion script.
// Adapters intentionally not implemented yet; this file declares the contract
// the ingestion pipeline will rely on so that adding a real source later is
// a localized change.

import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  CompanyMaster,
  GuidanceCommentaryRow,
  QuarterlyFinancialRow,
  SegmentRevenueRow,
} from "../../src/data/types/dhammaDashboard";

export type SourceClass =
  | "nse_bse_filing"
  | "investor_presentation"
  | "annual_report"
  | "concall_transcript";

export interface SourceEndpoint {
  sourceClass: SourceClass;
  label: string;
  baseUrl: string | null;
  notes: string | null;
}

export const SOURCE_ENDPOINTS: Record<SourceClass, SourceEndpoint> = {
  nse_bse_filing: {
    sourceClass: "nse_bse_filing",
    label: "NSE/BSE quarterly results",
    baseUrl: null,
    notes:
      "Per-company exchange filing URLs are resolved at fetch time; do not hard-code here.",
  },
  investor_presentation: {
    sourceClass: "investor_presentation",
    label: "Investor presentation",
    baseUrl: null,
    notes: "Usually linked from the company IR page; URLs change every quarter.",
  },
  annual_report: {
    sourceClass: "annual_report",
    label: "Annual report",
    baseUrl: null,
    notes: "Source of truth for full balance sheet and cash flow.",
  },
  concall_transcript: {
    sourceClass: "concall_transcript",
    label: "Concall transcript",
    baseUrl: null,
    notes: "Hosted by company IR or aggregators; coverage is best-effort.",
  },
};

// Adapter contract. Each adapter must:
//   - Return [] (not throw) when the source is unavailable.
//   - Attach SourceMeta with a real URL when one is known.
//   - Never invent zeros or fake values; missing fields stay null.
export interface DhammaSourceAdapter {
  fetchQuarterlyFinancials(
    company: CompanyMaster
  ): Promise<QuarterlyFinancialRow[]>;
  fetchAnnualFinancials(
    company: CompanyMaster
  ): Promise<AnnualFinancialRow[]>;
  fetchSegmentRevenue(
    company: CompanyMaster
  ): Promise<SegmentRevenueRow[]>;
  fetchBalanceSheet(company: CompanyMaster): Promise<BalanceSheetRow[]>;
  fetchCashFlow(company: CompanyMaster): Promise<CashFlowRow[]>;
  fetchGuidanceCommentary(
    company: CompanyMaster
  ): Promise<GuidanceCommentaryRow[]>;
}

// Placeholder adapter — safe defaults so the pipeline runs end-to-end before a
// real source is wired up. Replace with a concrete adapter (e.g. an
// NSE/BSE-filing adapter) in a follow-up commit.
export const placeholderAdapter: DhammaSourceAdapter = {
  async fetchQuarterlyFinancials() {
    return [];
  },
  async fetchAnnualFinancials() {
    return [];
  },
  async fetchSegmentRevenue() {
    return [];
  },
  async fetchBalanceSheet() {
    return [];
  },
  async fetchCashFlow() {
    return [];
  },
  async fetchGuidanceCommentary() {
    return [];
  },
};
