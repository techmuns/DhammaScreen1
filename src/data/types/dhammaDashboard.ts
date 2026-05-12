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

export type SnapshotStatus = "ok" | "partial" | "empty" | "stale" | "error";

export interface SnapshotMeta {
  snapshotId: string;
  description: string;
  generatedAt: string | null;
  rowCount: number;
  status: SnapshotStatus;
  notes: string | null;
  source: SourceMeta;
}

export interface Snapshot<TRow> {
  meta: SnapshotMeta;
  rows: TRow[];
}

export interface CompanyMaster {
  companyId: string;
  legalName: string;
  shortName: string;
  nseSymbol: string | null;
  bseCode: string | null;
  sector: string | null;
  industry: string | null;
  fiscalYearEndMonth: number;
  reportingBasisDefault: ReportingBasis;
  irPageUrl: string | null;
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
