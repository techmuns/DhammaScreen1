// Types shared across snapshots, helpers, and (later) UI for Dashboard 1.
// Keep these conservative: every metric field is nullable so missing data
// always renders as a dash, never as a fake zero.

export type Currency = "INR";

export type ReportingBasis = "consolidated" | "standalone";

export type FiscalQuarter = "Q1" | "Q2" | "Q3" | "Q4";

export interface QuarterPeriod {
  kind: "quarter";
  fiscalYear: number;
  quarter: FiscalQuarter;
  periodEndDate: string;
}

export interface AnnualPeriod {
  kind: "annual";
  fiscalYear: number;
  periodEndDate: string;
}

export type FinancialPeriod = QuarterPeriod | AnnualPeriod;

export type SourceReliability = "primary" | "secondary" | "audit";

export type SourceType = "exchange" | "company_ir" | "transcript" | "manual";

export interface SourceMeta {
  sourceClass:
    | "nse_bse_filing"
    | "investor_presentation"
    | "annual_report"
    | "concall_transcript"
    | "derived"
    | "manual";
  sourceUrl: string | null;
  sourceLabel: string | null;
  fetchedAt: string | null;
  publishedAt: string | null;
  notes: string | null;
}

export interface SourceRegistryEntry {
  sourceId: string;
  sourceName: string;
  baseUrl: string | null;
  sourceType: SourceType;
  reliability: SourceReliability;
  supportsDiscovery: boolean;
  supportsDownload: boolean;
  notes: string | null;
}

export type SnapshotStatus = "ok" | "partial" | "empty" | "stale" | "error";

export interface SnapshotError {
  sourceId: string | null;
  companyId: string | null;
  message: string;
  occurredAt: string;
}

export interface SnapshotMeta {
  snapshotId: string;
  description: string;
  generatedAt: string | null;
  rowCount: number;
  status: SnapshotStatus;
  notes: string | null;
  source: SourceMeta;
  errors?: SnapshotError[];
}

export interface Snapshot<TRow> {
  meta: SnapshotMeta;
  rows: TRow[];
}

export type Exchange = "NSE" | "BSE";

export interface CompanyExchangeListing {
  exchange: Exchange;
  symbol: string;
}

export type CompanyStatus = "active" | "pilot" | "watch" | "inactive";

export interface CompanyMaster {
  companyId: string;
  displayName: string;
  legalName: string;
  nseSymbol: string | null;
  bseCode: string | null;
  exchanges: CompanyExchangeListing[];
  country: string;
  sector: string | null;
  industry: string | null;
  peerGroupId: string | null;
  fiscalYearEndMonth: number;
  reportingBasisDefault: ReportingBasis;
  irPageUrl: string | null;
  status: CompanyStatus;
  notes: string | null;
}

export interface PeerGroup {
  peerGroupId: string;
  label: string;
  description: string | null;
  companyIds: string[];
  notes: string | null;
}

interface FinancialRowBase {
  companyId: string;
  reportingBasis: ReportingBasis;
  currency: Currency;
  unit: "absolute" | "lakh" | "crore" | "million" | "billion";
  source: SourceMeta;
}

export interface QuarterlyFinancialRow extends FinancialRowBase {
  period: QuarterPeriod;
  revenue: number | null;
  otherIncome: number | null;
  ebitda: number | null;
  depreciation: number | null;
  ebit: number | null;
  financeCost: number | null;
  pbt: number | null;
  tax: number | null;
  pat: number | null;
  patAttributableToOwners: number | null;
  epsBasic: number | null;
  epsDiluted: number | null;
}

export interface AnnualFinancialRow extends FinancialRowBase {
  period: AnnualPeriod;
  revenue: number | null;
  otherIncome: number | null;
  ebitda: number | null;
  depreciation: number | null;
  ebit: number | null;
  financeCost: number | null;
  pbt: number | null;
  tax: number | null;
  pat: number | null;
  patAttributableToOwners: number | null;
  epsBasic: number | null;
  epsDiluted: number | null;
}

export interface SegmentRevenueRow extends FinancialRowBase {
  period: FinancialPeriod;
  segmentName: string;
  segmentNameNormalized: string;
  revenue: number | null;
  segmentResult: number | null;
  capitalEmployed: number | null;
}

export interface BalanceSheetRow extends FinancialRowBase {
  period: FinancialPeriod;
  totalAssets: number | null;
  totalEquity: number | null;
  totalEquityAttributableToOwners: number | null;
  minorityInterest: number | null;
  borrowingsLongTerm: number | null;
  borrowingsShortTerm: number | null;
  borrowingsTotal: number | null;
  cashAndEquivalents: number | null;
  netDebt: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  workingCapital: number | null;
}

export interface CashFlowRow extends FinancialRowBase {
  period: FinancialPeriod;
  cfo: number | null;
  workingCapitalChanges: number | null;
  cfi: number | null;
  cff: number | null;
  netChangeInCash: number | null;
}

export type GuidanceMetric =
  | "revenue"
  | "ebitda"
  | "ebitda_margin"
  | "pat"
  | "pat_margin"
  | "capex"
  | "volume"
  | "other";

export type GuidanceDirection =
  | "absolute"
  | "growth_yoy"
  | "growth_qoq"
  | "margin_target"
  | "qualitative";

export interface GuidanceCommentaryRow {
  companyId: string;
  commentaryId: string;
  saidInPeriod: FinancialPeriod;
  targetPeriod: FinancialPeriod | null;
  metric: GuidanceMetric;
  direction: GuidanceDirection;
  rawQuote: string;
  numericLow: number | null;
  numericHigh: number | null;
  numericUnit: "percent" | "absolute" | null;
  speaker: string | null;
  source: SourceMeta;
}

export type GuidanceAccuracyStatus =
  | "met"
  | "missed"
  | "partial"
  | "unverifiable"
  | "pending";

export interface GuidanceActualComparisonRow {
  companyId: string;
  commentaryId: string;
  metric: GuidanceMetric;
  targetPeriod: FinancialPeriod;
  expectedLow: number | null;
  expectedHigh: number | null;
  actualValue: number | null;
  status: GuidanceAccuracyStatus;
  variancePct: number | null;
  evaluatedAt: string | null;
  source: SourceMeta;
  notes: string | null;
}

// Source discovery: a manifest of filings located for each company.
// A row is created at `discovered` even if we haven't downloaded the
// document yet; status moves forward (`downloaded`, `parsed`) as the
// pipeline matures. `error` rows record what went wrong without
// blocking the rest of the pipeline.

export type FilingType =
  | "quarterly_result"
  | "annual_report"
  | "investor_presentation"
  | "concall_transcript"
  | "guidance_commentary"
  | "other";

export type FilingPeriodType = "quarter" | "year" | "unknown";

export type FilingDocFileType =
  | "pdf"
  | "xlsx"
  | "xls"
  | "xml"
  | "html"
  | "zip"
  | "unknown";

export type FilingStatus =
  | "discovered"
  | "downloaded"
  | "parsed"
  | "skipped"
  | "error";

export interface FilingManifestRow {
  companyId: string;
  companyName: string;
  sourceId: string;
  filingType: FilingType;
  periodType: FilingPeriodType;
  period: string | null;
  filingDate: string | null;
  title: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  fileType: FilingDocFileType | null;
  status: FilingStatus;
  fetchedAt: string | null;
  errorMessage: string | null;
  sourceReliability: SourceReliability;
}

// Source health: one row per (sourceId, companyId) probe, so we can
// see at a glance which sources are reachable for which companies
// before assuming any UI metric is trustworthy.

export type SourceHealthStatus =
  | "ok"
  | "partial"
  | "blocked"
  | "error"
  | "not_configured";

export interface SourceHealthRow {
  sourceId: string;
  companyId: string | null;
  checkedAt: string | null;
  status: SourceHealthStatus;
  filingsDiscovered: number;
  latestFilingDate: string | null;
  errorMessage: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Screener-compatible import path.
//
// Rows in this section are IMPORT-BACKED, not source-backed. They come from
// client-provided Screener-style exports dropped into data/manual/screener/.
// They live in their own snapshot files (`screener-*.json`) and must never
// be merged into the official financial snapshots.
// ---------------------------------------------------------------------------

export type ScreenerSheetType =
  | "quarterly_results"
  | "profit_and_loss"
  | "balance_sheet"
  | "cash_flow"
  | "ratios"
  | "peer_comparison"
  | "unknown";

export type ScreenerImportConfidence = "high" | "medium" | "low";

export type ScreenerPeriodType = "quarter" | "year" | "unknown";

export interface ScreenerImportMeta {
  importId: string;
  sourceFile: string;
  sourceSheet: string | null;
  sheetType: ScreenerSheetType | null;
  importedAt: string;
  rowCount: number;
  notes: string | null;
}

// Base shape used by every per-sheet specialized row.
export interface ScreenerCompanyFinancialRow {
  companyId: string;
  companyName: string;
  sourceFile: string;
  sourceSheet: string | null;
  sheetType: ScreenerSheetType;
  period: string | null;
  periodType: ScreenerPeriodType;
  metricName: string;
  metricValue: number | null;
  unit: string | null;
  currency: string | null;
  sourceLabel: string | null;
  importedAt: string;
  confidence: ScreenerImportConfidence;
  notes: string | null;
}

export type ScreenerQuarterlyRow = ScreenerCompanyFinancialRow;
export type ScreenerAnnualProfitLossRow = ScreenerCompanyFinancialRow;
export type ScreenerBalanceSheetRow = ScreenerCompanyFinancialRow;
export type ScreenerCashFlowRow = ScreenerCompanyFinancialRow;
export type ScreenerRatioRow = ScreenerCompanyFinancialRow;

export interface ScreenerPeerComparisonRow extends ScreenerCompanyFinancialRow {
  peerCompanyName: string;
}

export type ScreenerImportFileStatus =
  | "ok"
  | "partial"
  | "skipped"
  | "error"
  | "not_found";

export interface ScreenerImportStatusRow {
  sourceFile: string;
  sourceSheet: string | null;
  sheetType: ScreenerSheetType | null;
  companyId: string | null;
  status: ScreenerImportFileStatus;
  rowCount: number;
  importedAt: string;
  notes: string | null;
  errorMessage: string | null;
}
