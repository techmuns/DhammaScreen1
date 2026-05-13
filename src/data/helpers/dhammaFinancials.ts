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

// ---------------------------------------------------------------------------
// Data provenance — used both by UI badges and by resolution helpers below.
// ---------------------------------------------------------------------------

export type DataProvenance =
  | "official-filing"
  | "screener-fetch"
  | "screener-import"
  | "audit"
  | "pending";

// ---------------------------------------------------------------------------
// Screener-source resolution helpers.
//
// These let the UI pick "official-filing first, Screener-import second,
// dash otherwise" without writing the rule in every component.
// ---------------------------------------------------------------------------

export interface ScreenerLatestMetric {
  value: number | null;
  periodLabel: string | null;
  sourceFile: string | null;
  sourceSheet: string | null;
}

export function screenerLatestMetric(
  rows: readonly ScreenerCompanyFinancialRow[],
  companyId: string,
  canonical: string,
  periodType?: "quarter" | "year",
  sourceMethod?: "fetch" | "import"
): ScreenerLatestMetric | null {
  const filtered = rows.filter(
    (row) =>
      row.companyId === companyId &&
      row.metricCanonical === canonical &&
      (periodType ? row.periodType === periodType : true) &&
      (sourceMethod ? row.sourceMethod === sourceMethod : true) &&
      row.periodSortKey !== null
  );
  if (filtered.length === 0) return null;
  const sorted = [...filtered].sort((a, b) =>
    (a.periodSortKey ?? "").localeCompare(b.periodSortKey ?? "")
  );
  const latest = sorted[sorted.length - 1];
  return {
    value: isFiniteNumber(latest.metricValue) ? latest.metricValue : null,
    periodLabel: latest.period,
    sourceFile: latest.sourceFile,
    sourceSheet: latest.sourceSheet,
  };
}

export interface ScreenerPeriodSlice {
  period: string;
  periodSortKey: string;
  sourceFile: string;
  sourceMethod: "fetch" | "import";
  values: Record<string, number | null>;
}

// Group rows for a given (company × sheetType) into one slice per period,
// each slice mapping canonical-metric → value. Returns the last `n`
// periods sorted ascending.
export function screenerStatementRows(
  rows: readonly ScreenerCompanyFinancialRow[],
  companyId: string,
  sheetType: ScreenerCompanyFinancialRow["sheetType"],
  n: number,
  sourceMethod?: "fetch" | "import"
): ScreenerPeriodSlice[] {
  const byKey = new Map<string, ScreenerPeriodSlice>();
  for (const row of rows) {
    if (
      row.companyId !== companyId ||
      row.sheetType !== sheetType ||
      (sourceMethod && row.sourceMethod !== sourceMethod) ||
      !row.periodSortKey ||
      !row.period ||
      !row.metricCanonical
    ) {
      continue;
    }
    let slice = byKey.get(row.periodSortKey);
    if (!slice) {
      slice = {
        period: row.period,
        periodSortKey: row.periodSortKey,
        sourceFile: row.sourceFile,
        sourceMethod: row.sourceMethod,
        values: {},
      };
      byKey.set(row.periodSortKey, slice);
    }
    slice.values[row.metricCanonical] = isFiniteNumber(row.metricValue)
      ? row.metricValue
      : null;
  }
  return [...byKey.values()]
    .sort((a, b) => a.periodSortKey.localeCompare(b.periodSortKey))
    .slice(-n);
}

// One row per peer company, with canonical metrics as columns.
export interface ScreenerPeerRow {
  peerCompanyName: string;
  sourceFile: string;
  sourceMethod: "fetch" | "import";
  values: Record<string, number | null>;
}

export function screenerPeerRows(
  rows: readonly {
    peerCompanyName: string;
    sourceFile: string;
    sourceMethod: "fetch" | "import";
    metricCanonical: string | null;
    metricValue: number | null;
  }[],
  sourceMethod?: "fetch" | "import"
): ScreenerPeerRow[] {
  const byPeer = new Map<string, ScreenerPeerRow>();
  for (const row of rows) {
    if (!row.metricCanonical) continue;
    if (sourceMethod && row.sourceMethod !== sourceMethod) continue;
    const key = row.peerCompanyName.trim();
    if (!key) continue;
    let peer = byPeer.get(key);
    if (!peer) {
      peer = {
        peerCompanyName: key,
        sourceFile: row.sourceFile,
        sourceMethod: row.sourceMethod,
        values: {},
      };
      byPeer.set(key, peer);
    }
    peer.values[row.metricCanonical] = isFiniteNumber(row.metricValue)
      ? row.metricValue
      : null;
  }
  return [...byPeer.values()];
}

export interface KpiResolution {
  value: number | null;
  provenance: DataProvenance;
  periodLabel: string | null;
}

// Pick official → screener-fetch → screener-import → pending.
// Period label is passed through from whichever source won.
export function resolveKpi(args: {
  official: { value: number | null; periodLabel: string | null };
  screenerFetch?: ScreenerLatestMetric | null;
  screenerImport?: ScreenerLatestMetric | null;
}): KpiResolution {
  if (isFiniteNumber(args.official.value)) {
    return {
      value: args.official.value,
      provenance: "official-filing",
      periodLabel: args.official.periodLabel,
    };
  }
  if (args.screenerFetch && isFiniteNumber(args.screenerFetch.value)) {
    return {
      value: args.screenerFetch.value,
      provenance: "screener-fetch",
      periodLabel: args.screenerFetch.periodLabel,
    };
  }
  if (args.screenerImport && isFiniteNumber(args.screenerImport.value)) {
    return {
      value: args.screenerImport.value,
      provenance: "screener-import",
      periodLabel: args.screenerImport.periodLabel,
    };
  }
  return { value: null, provenance: "pending", periodLabel: null };
}

// Used by tables to decide which dataset to render. Returns the source
// that has the most non-null cells for the given (company × sheetType),
// preferring `official` on ties.
export function dataSourceForMetric(args: {
  hasOfficial: boolean;
  hasScreenerFetch?: boolean;
  hasScreenerImport?: boolean;
}): DataProvenance {
  if (args.hasOfficial) return "official-filing";
  if (args.hasScreenerFetch) return "screener-fetch";
  if (args.hasScreenerImport) return "screener-import";
  return "pending";
}

// ---------------------------------------------------------------------------
// KPI peer benchmarking.
//
// Peer comparison is folded INTO the KPI cards rather than rendered as a
// standalone table. For each KPI, we line up the selected company against
// every other company in the same peerGroupId, compute a peer average and
// a rank, and tag the position (above / below / in-line / pending).
// ---------------------------------------------------------------------------

export function peerGroupForCompany(
  companies: ReadonlyArray<CompanyMaster>,
  companyId: string
): string | null {
  const c = companies.find((c) => c.companyId === companyId);
  return c?.peerGroupId ?? null;
}

// Returns the companyIds in the same peer group as the input, including
// the input itself. Falls back to `[companyId]` if no peer group exists.
export function companiesInPeerGroup(
  companies: ReadonlyArray<CompanyMaster>,
  companyId: string
): string[] {
  const peerGroupId = peerGroupForCompany(companies, companyId);
  if (!peerGroupId) return [companyId];
  return companies
    .filter((c) => c.peerGroupId === peerGroupId)
    .map((c) => c.companyId);
}

interface MetricLookupResult {
  value: number | null;
  period: string | null;
  sourceMethod: "fetch" | "import" | null;
}

// Latest value for (company × metric × periodType) from the Screener rows.
export function latestScreenerValue(
  rows: ReadonlyArray<ScreenerCompanyFinancialRow>,
  companyId: string,
  canonical: string,
  periodType: "year" | "quarter"
): MetricLookupResult {
  const filtered = rows
    .filter(
      (r) =>
        r.companyId === companyId &&
        r.metricCanonical === canonical &&
        r.periodType === periodType &&
        r.periodSortKey !== null
    )
    .sort((a, b) =>
      (a.periodSortKey ?? "").localeCompare(b.periodSortKey ?? "")
    );
  if (filtered.length === 0) {
    return { value: null, period: null, sourceMethod: null };
  }
  const latest = filtered[filtered.length - 1];
  return {
    value: isFiniteNumber(latest.metricValue) ? latest.metricValue : null,
    period: latest.period,
    sourceMethod: latest.sourceMethod,
  };
}

// Year-on-year growth in percentage points. For periodType=year, compares
// the latest annual value to the prior annual value. For periodType=quarter,
// compares the latest quarter to the same quarter four periods back.
// Returns null when either endpoint is missing or the prior value is zero.
export function latestYoYGrowth(
  rows: ReadonlyArray<ScreenerCompanyFinancialRow>,
  companyId: string,
  canonical: string,
  periodType: "year" | "quarter"
): { value: number | null; period: string | null } {
  const filtered = rows
    .filter(
      (r) =>
        r.companyId === companyId &&
        r.metricCanonical === canonical &&
        r.periodType === periodType &&
        r.periodSortKey !== null &&
        isFiniteNumber(r.metricValue)
    )
    .sort((a, b) =>
      (a.periodSortKey ?? "").localeCompare(b.periodSortKey ?? "")
    );
  if (filtered.length < 2) return { value: null, period: null };
  const latest = filtered[filtered.length - 1];
  const lookback = periodType === "quarter" ? 4 : 1;
  const priorIdx = filtered.length - 1 - lookback;
  if (priorIdx < 0) return { value: null, period: latest.period };
  const prior = filtered[priorIdx];
  if (!isFiniteNumber(prior.metricValue) || prior.metricValue === 0) {
    return { value: null, period: latest.period };
  }
  const growth =
    ((latest.metricValue as number) - prior.metricValue) /
    Math.abs(prior.metricValue);
  // Return as percentage points (e.g. 0.124 → 12.4)
  return { value: growth * 100, period: latest.period };
}

export type PeerBenchmarkPosition =
  | "above"
  | "below"
  | "in-line"
  | "pending";

export interface PeerBenchmarkPeerEntry {
  companyId: string;
  displayName: string;
  value: number | null;
  period: string | null;
  isSelf: boolean;
}

export interface PeerBenchmark {
  selfCompanyId: string;
  selfValue: number | null;
  selfPeriod: string | null;
  peerEntries: PeerBenchmarkPeerEntry[];
  peerAverage: number | null;
  rank: number | null;
  rankOf: number;
  position: PeerBenchmarkPosition;
}

// Builds a peer benchmark for one (company × metric) cell.
//   kind="value"     → latestScreenerValue per peer
//   kind="growth-yoy"→ latestYoYGrowth   per peer
// Peer average = arithmetic mean over peers with a finite value (self
// included). Rank = 1 means highest; "—" when self has no value.
// `inLineTolerance` is a relative fraction (default 5%) used to bucket
// the position label as above / below / in-line.
export function buildPeerBenchmark(args: {
  companies: ReadonlyArray<CompanyMaster>;
  screenerRows: ReadonlyArray<ScreenerCompanyFinancialRow>;
  companyId: string;
  canonical: string;
  kind: "value" | "growth-yoy";
  periodType: "year" | "quarter";
  inLineTolerance?: number;
}): PeerBenchmark {
  const peerIds = companiesInPeerGroup(args.companies, args.companyId);
  const peerEntries: PeerBenchmarkPeerEntry[] = peerIds.map((pid) => {
    const co = args.companies.find((c) => c.companyId === pid);
    const displayName = co?.displayName ?? pid;
    const lookup =
      args.kind === "growth-yoy"
        ? latestYoYGrowth(args.screenerRows, pid, args.canonical, args.periodType)
        : latestScreenerValue(
            args.screenerRows,
            pid,
            args.canonical,
            args.periodType
          );
    return {
      companyId: pid,
      displayName,
      value: lookup.value,
      period: lookup.period,
      isSelf: pid === args.companyId,
    };
  });

  const finiteValues = peerEntries
    .filter((e) => isFiniteNumber(e.value))
    .map((e) => e.value as number);
  const peerAverage =
    finiteValues.length > 0
      ? finiteValues.reduce((a, b) => a + b, 0) / finiteValues.length
      : null;

  const ranked = [...peerEntries]
    .filter((e) => isFiniteNumber(e.value))
    .sort((a, b) => (b.value as number) - (a.value as number));
  const rankIdx = ranked.findIndex((e) => e.companyId === args.companyId);
  const rank = rankIdx >= 0 ? rankIdx + 1 : null;

  const selfEntry = peerEntries.find((e) => e.companyId === args.companyId);
  const selfValue = selfEntry?.value ?? null;
  const selfPeriod = selfEntry?.period ?? null;

  const tolerance = args.inLineTolerance ?? 0.05;
  let position: PeerBenchmarkPosition = "pending";
  if (isFiniteNumber(selfValue) && isFiniteNumber(peerAverage)) {
    if (peerAverage === 0) {
      position = "in-line";
    } else {
      const ratio = (selfValue - peerAverage) / Math.abs(peerAverage);
      if (Math.abs(ratio) <= tolerance) position = "in-line";
      else if (ratio > 0) position = "above";
      else position = "below";
    }
  }

  return {
    selfCompanyId: args.companyId,
    selfValue,
    selfPeriod,
    peerEntries,
    peerAverage,
    rank,
    rankOf: ranked.length,
    position,
  };
}

export function positionLabel(position: PeerBenchmarkPosition): string {
  switch (position) {
    case "above":
      return "Above peer average";
    case "below":
      return "Below peer average";
    case "in-line":
      return "In line with peers";
    case "pending":
      return "Data pending";
  }
}

// Re-exports used by helper consumers; keeps the public surface explicit.
export type { Comparable };

// ---------------------------------------------------------------------------
// UI render helpers.
//
// These exist so components never re-implement formatting or null-handling.
// All metric formatting in the UI must go through one of these functions.
// ---------------------------------------------------------------------------

export interface SnapshotShape {
  meta: { status: string; rowCount: number; generatedAt: string | null };
}

export function snapshotStatus(snapshot: SnapshotShape): string {
  return snapshot.meta.status;
}

export function snapshotRowCount(snapshot: SnapshotShape): number {
  return snapshot.meta.rowCount;
}

export function tableValueOrDash(
  value: number | null | undefined,
  format?: (n: number) => string
): string {
  if (!isFiniteNumber(value)) return MISSING_DASH;
  return format ? format(value) : String(value);
}

export function formatNumberCompact(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function formatPercent(n: number, decimals = 1): string {
  // Inputs are unit-fractions (0.21 → "21.0%"). Use formatPercentRaw for
  // values that are already expressed in percentage points.
  return `${(n * 100).toFixed(decimals)}%`;
}

export function formatPercentRaw(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatGenerationTimestamp(iso: string | null): string {
  if (!iso) return MISSING_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MISSING_DASH;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function latestGeneratedAt(
  snapshots: ReadonlyArray<SnapshotShape>
): string | null {
  let latest: string | null = null;
  for (const snap of snapshots) {
    const ts = snap.meta.generatedAt;
    if (ts && (!latest || ts > latest)) latest = ts;
  }
  return latest;
}

export function provenanceLabel(provenance: DataProvenance): string {
  switch (provenance) {
    case "official-filing":
      return "Official filing";
    case "screener-fetch":
      return "Screener fetch";
    case "screener-import":
      return "Screener import";
    case "audit":
      return "Audit";
    case "pending":
      return "Pending";
  }
}
