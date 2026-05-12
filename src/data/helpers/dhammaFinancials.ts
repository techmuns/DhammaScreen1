// Deterministic helpers for Dashboard 1.
// Rules:
//   - Never invent values. Return `null` when an input is missing or unsafe.
//   - UI components must call these helpers; they must not re-implement formulas.
//   - `formatMissingAsDash` is the single render-time formatter for null values.

import type {
  AnnualFinancialRow,
  AnnualPeriod,
  CompanyMaster,
  FinancialPeriod,
  GuidanceAccuracyStatus,
  PeerGroup,
  QuarterPeriod,
  QuarterlyFinancialRow,
  ScreenerCompanyFinancialRow,
  ScreenerImportStatusRow,
  SegmentRevenueRow,
} from "../types/dhammaDashboard";

export const MISSING_DASH = "—";

type Comparable<T> = T & {
  companyId: string;
  period: FinancialPeriod;
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareQuarterPeriods(a: QuarterPeriod, b: QuarterPeriod): number {
  if (a.fiscalYear !== b.fiscalYear) return a.fiscalYear - b.fiscalYear;
  return a.quarter.localeCompare(b.quarter);
}

function compareAnnualPeriods(a: AnnualPeriod, b: AnnualPeriod): number {
  return a.fiscalYear - b.fiscalYear;
}

export function rowsForCompany<T extends { companyId: string }>(
  rows: readonly T[],
  companyId: string
): T[] {
  return rows.filter((row) => row.companyId === companyId);
}

export function latestQuarter(
  rows: readonly QuarterlyFinancialRow[],
  companyId: string
): QuarterlyFinancialRow | null {
  const filtered = rowsForCompany(rows, companyId);
  if (filtered.length === 0) return null;
  return [...filtered].sort((a, b) =>
    compareQuarterPeriods(a.period, b.period)
  )[filtered.length - 1];
}

export function latestYear(
  rows: readonly AnnualFinancialRow[],
  companyId: string
): AnnualFinancialRow | null {
  const filtered = rowsForCompany(rows, companyId);
  if (filtered.length === 0) return null;
  return [...filtered].sort((a, b) =>
    compareAnnualPeriods(a.period, b.period)
  )[filtered.length - 1];
}

export function lastNQuarters(
  rows: readonly QuarterlyFinancialRow[],
  companyId: string,
  n: number
): QuarterlyFinancialRow[] {
  if (n <= 0) return [];
  const sorted = [...rowsForCompany(rows, companyId)].sort((a, b) =>
    compareQuarterPeriods(a.period, b.period)
  );
  return sorted.slice(-n);
}

export function lastNYears(
  rows: readonly AnnualFinancialRow[],
  companyId: string,
  n: number
): AnnualFinancialRow[] {
  if (n <= 0) return [];
  const sorted = [...rowsForCompany(rows, companyId)].sort((a, b) =>
    compareAnnualPeriods(a.period, b.period)
  );
  return sorted.slice(-n);
}

export function growthYoY(
  current: number | null,
  priorYearSamePeriod: number | null
): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(priorYearSamePeriod)) {
    return null;
  }
  if (priorYearSamePeriod === 0) return null;
  return (current - priorYearSamePeriod) / Math.abs(priorYearSamePeriod);
}

export function growthQoQ(
  current: number | null,
  priorQuarter: number | null
): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(priorQuarter)) {
    return null;
  }
  if (priorQuarter === 0) return null;
  return (current - priorQuarter) / Math.abs(priorQuarter);
}

export function margin(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export interface RevenueMixEntry {
  segmentNameNormalized: string;
  revenue: number;
  share: number;
}

export function revenueMix(
  segmentRows: readonly SegmentRevenueRow[],
  companyId: string,
  period: FinancialPeriod
): RevenueMixEntry[] | null {
  const filtered = segmentRows.filter(
    (row) =>
      row.companyId === companyId &&
      row.period.kind === period.kind &&
      row.period.periodEndDate === period.periodEndDate
  );
  if (filtered.length === 0) return null;

  const validRevenue = filtered
    .map((row) => row.revenue)
    .filter(isFiniteNumber);
  if (validRevenue.length !== filtered.length) return null;

  const total = validRevenue.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;

  return filtered.map((row) => ({
    segmentNameNormalized: row.segmentNameNormalized,
    revenue: row.revenue as number,
    share: (row.revenue as number) / total,
  }));
}

export interface PeerComparisonEntry<TValue = number | null> {
  companyId: string;
  displayName: string;
  value: TValue;
  rank: number | null;
}

export function peerComparison(
  peerGroup: PeerGroup,
  companies: readonly CompanyMaster[],
  valueFor: (companyId: string) => number | null
): PeerComparisonEntry[] {
  const entries: PeerComparisonEntry[] = peerGroup.companyIds.map(
    (companyId) => {
      const company = companies.find((c) => c.companyId === companyId);
      return {
        companyId,
        displayName: company ? company.displayName : companyId,
        value: valueFor(companyId),
        rank: null,
      };
    }
  );

  const ranked = entries
    .filter((entry) => isFiniteNumber(entry.value))
    .sort((a, b) => (b.value as number) - (a.value as number));

  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return entries;
}

export interface GuidanceAccuracyInputs {
  expectedLow: number | null;
  expectedHigh: number | null;
  actualValue: number | null;
  metTolerance?: number;
  partialTolerance?: number;
}

export function guidanceAccuracyStatus(
  input: GuidanceAccuracyInputs
): { status: GuidanceAccuracyStatus; variancePct: number | null } {
  const {
    expectedLow,
    expectedHigh,
    actualValue,
    metTolerance = 0.05,
    partialTolerance = 0.15,
  } = input;

  if (!isFiniteNumber(actualValue)) {
    return { status: "pending", variancePct: null };
  }
  if (!isFiniteNumber(expectedLow) && !isFiniteNumber(expectedHigh)) {
    return { status: "unverifiable", variancePct: null };
  }

  const low = isFiniteNumber(expectedLow) ? expectedLow : expectedHigh;
  const high = isFiniteNumber(expectedHigh) ? expectedHigh : expectedLow;
  if (low === null || high === null) {
    return { status: "unverifiable", variancePct: null };
  }

  const midpoint = (low + high) / 2;
  const variancePct = midpoint === 0 ? null : (actualValue - midpoint) / Math.abs(midpoint);

  if (actualValue >= low && actualValue <= high) {
    return { status: "met", variancePct };
  }
  if (variancePct === null) {
    return { status: "unverifiable", variancePct: null };
  }
  const absVariance = Math.abs(variancePct);
  if (absVariance <= metTolerance) return { status: "met", variancePct };
  if (absVariance <= partialTolerance) return { status: "partial", variancePct };
  return { status: "missed", variancePct };
}

export function formatMissingAsDash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return MISSING_DASH;
  return value;
}

// ---------------------------------------------------------------------------
// Screener-import helpers.
//
// These operate on the import-backed snapshots only. They must never be
// composed with official-snapshot helpers in a way that lets imported
// values silently replace source-backed values.
// ---------------------------------------------------------------------------

export function rowsFromScreenerImport(
  rows: readonly ScreenerCompanyFinancialRow[],
  companyId: string
): ScreenerCompanyFinancialRow[] {
  return rows.filter((row) => row.companyId === companyId);
}

export interface ScreenerSeriesPoint {
  period: string;
  value: number | null;
}

export function screenerMetricSeries(
  rows: readonly ScreenerCompanyFinancialRow[],
  companyId: string,
  metricName: string
): ScreenerSeriesPoint[] {
  return rows
    .filter(
      (row) =>
        row.companyId === companyId &&
        row.metricName === metricName &&
        row.period !== null
    )
    .map((row) => ({ period: row.period as string, value: row.metricValue }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export type OfficialVsScreenerMatch =
  | "match"
  | "partial"
  | "mismatch"
  | "unverifiable";

export interface OfficialVsScreenerResult {
  match: OfficialVsScreenerMatch;
  variancePct: number | null;
}

export function compareOfficialVsScreener(
  official: number | null,
  imported: number | null,
  tolerancePct = 0.02
): OfficialVsScreenerResult {
  if (!isFiniteNumber(official) || !isFiniteNumber(imported)) {
    return { match: "unverifiable", variancePct: null };
  }
  if (official === 0) return { match: "unverifiable", variancePct: null };
  const variancePct = (imported - official) / Math.abs(official);
  const abs = Math.abs(variancePct);
  if (abs <= tolerancePct) return { match: "match", variancePct };
  if (abs <= tolerancePct * 3) return { match: "partial", variancePct };
  return { match: "mismatch", variancePct };
}

export interface ScreenerImportCoverage {
  filesAttempted: number;
  filesOk: number;
  filesPartial: number;
  filesError: number;
  filesSkipped: number;
  filesNotFound: number;
}

export function screenerImportCoverage(
  statusRows: readonly ScreenerImportStatusRow[]
): ScreenerImportCoverage {
  const coverage: ScreenerImportCoverage = {
    filesAttempted: statusRows.length,
    filesOk: 0,
    filesPartial: 0,
    filesError: 0,
    filesSkipped: 0,
    filesNotFound: 0,
  };
  for (const row of statusRows) {
    switch (row.status) {
      case "ok":
        coverage.filesOk++;
        break;
      case "partial":
        coverage.filesPartial++;
        break;
      case "error":
        coverage.filesError++;
        break;
      case "skipped":
        coverage.filesSkipped++;
        break;
      case "not_found":
        coverage.filesNotFound++;
        break;
    }
  }
  return coverage;
}

// Re-exports used by helper consumers; keeps the public surface explicit.
export type { Comparable };
