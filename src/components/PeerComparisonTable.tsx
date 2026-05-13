import {
  formatNumberCompact,
  formatPercent,
  formatPercentRaw,
  growthYoY,
  latestQuarter,
  margin,
  screenerPeerRows,
  tableValueOrDash,
  type ScreenerPeerRow,
} from "../data/helpers/dhammaFinancials";
import {
  companyMasterSnapshot,
  quarterlyFinancialsSnapshot,
  screenerPeerSnapshot,
} from "../data/helpers/snapshotLoader";
import {
  metricLabel,
  type CanonicalMetric,
} from "../data/helpers/screenerMapping";
import { EmptyState } from "./EmptyState";
import { SourceBadge } from "./SourceBadge";

interface PeerComparisonTableProps {
  companyId: string | null;
}

interface OfficialPeerRow {
  companyId: string;
  displayName: string;
  revenueGrowthYoY: number | null;
  ebitdaMargin: number | null;
  patMargin: number | null;
  epsGrowthYoY: number | null;
  hasData: boolean;
}

function buildOfficialPeers(): OfficialPeerRow[] {
  return companyMasterSnapshot.rows.map((company) => {
    const latest = latestQuarter(
      quarterlyFinancialsSnapshot.rows,
      company.companyId
    );
    const all = quarterlyFinancialsSnapshot.rows
      .filter((row) => row.companyId === company.companyId)
      .sort((a, b) =>
        a.period.periodEndDate.localeCompare(b.period.periodEndDate)
      );
    const priorYearIdx = all.length - 5;
    const priorYear = priorYearIdx >= 0 ? all[priorYearIdx] : null;
    return {
      companyId: company.companyId,
      displayName: company.displayName,
      revenueGrowthYoY: growthYoY(
        latest?.revenue ?? null,
        priorYear?.revenue ?? null
      ),
      ebitdaMargin: margin(latest?.ebitda ?? null, latest?.revenue ?? null),
      patMargin: margin(
        latest?.patAttributableToOwners ?? latest?.pat ?? null,
        latest?.revenue ?? null
      ),
      epsGrowthYoY: growthYoY(
        latest?.epsBasic ?? null,
        priorYear?.epsBasic ?? null
      ),
      hasData: latest !== null,
    };
  });
}

// Columns we render when the table is sourced from Screener. Ordered by
// what Screener's "Peer Comparison" sheet usually exposes.
const SCREENER_PEER_COLUMNS: { canonical: CanonicalMetric; format: (n: number) => string }[] = [
  { canonical: "market_cap", format: formatNumberCompact },
  { canonical: "current_price", format: formatNumberCompact },
  { canonical: "stock_pe", format: (n) => n.toFixed(2) },
  { canonical: "roce", format: formatPercentRaw },
  { canonical: "roe", format: formatPercentRaw },
  { canonical: "revenue", format: formatNumberCompact },
  { canonical: "pat", format: formatNumberCompact },
];

export function PeerComparisonTable({ companyId }: PeerComparisonTableProps) {
  const officialPeers = buildOfficialPeers();
  const officialHasAny = officialPeers.some((r) => r.hasData);

  if (officialHasAny) {
    return renderOfficialPeers(officialPeers, companyId);
  }

  const screenerPeers = screenerPeerRows(screenerPeerSnapshot.rows);
  if (screenerPeers.length > 0) {
    return renderScreenerPeers(screenerPeers, companyId);
  }

  return (
    <section className="peer-section" aria-label="Peer comparison">
      <div className="section-head">
        <h2 className="section-title">Peer comparison</h2>
        <SourceBadge provenance="pending" />
      </div>
      <EmptyState
        title="No peer comparison data available yet"
        message="Add official filings or Screener exports to populate this table."
        hint={
          officialPeers.length > 0
            ? `Peer group: ${officialPeers.map((r) => r.displayName).join(", ")}`
            : "No peers configured."
        }
      />
    </section>
  );
}

function renderOfficialPeers(
  rows: OfficialPeerRow[],
  focusedCompanyId: string | null
) {
  return (
    <section className="peer-section" aria-label="Peer comparison">
      <div className="section-head">
        <h2 className="section-title">Peer comparison</h2>
        <SourceBadge provenance="official-filing" />
      </div>
      <div className="table-wrap">
        <table className="data-table data-table--peer">
          <thead>
            <tr>
              <th>Company</th>
              <th>Revenue growth (YoY)</th>
              <th>EBITDA margin</th>
              <th>PAT margin</th>
              <th>EPS growth (YoY)</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.companyId}
                className={row.companyId === focusedCompanyId ? "row--focus" : ""}
              >
                <td>{row.displayName}</td>
                <td className="num">
                  {tableValueOrDash(row.revenueGrowthYoY, formatPercent)}
                </td>
                <td className="num">
                  {tableValueOrDash(row.ebitdaMargin, formatPercent)}
                </td>
                <td className="num">
                  {tableValueOrDash(row.patMargin, formatPercent)}
                </td>
                <td className="num">
                  {tableValueOrDash(row.epsGrowthYoY, formatPercent)}
                </td>
                <td>
                  <SourceBadge
                    provenance={row.hasData ? "official-filing" : "pending"}
                  />
                </td>
                <td>{row.hasData ? "ok" : "pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="section-note">
        Values shown only for companies whose quarterly filings have been
        ingested. Missing values render as an em-dash, never zero.
      </p>
    </section>
  );
}

function renderScreenerPeers(
  rows: ScreenerPeerRow[],
  focusedCompanyId: string | null
) {
  const sourceFile = rows[0]?.sourceFile ?? "";
  // Only render columns where at least one peer has a value.
  const activeColumns = SCREENER_PEER_COLUMNS.filter(({ canonical }) =>
    rows.some((row) => row.values[canonical] !== undefined && row.values[canonical] !== null)
  );

  return (
    <section className="peer-section" aria-label="Peer comparison">
      <div className="section-head">
        <h2 className="section-title">Peer comparison</h2>
        <SourceBadge provenance="screener-import" />
        <span className="section-subtitle">Source: {sourceFile}</span>
      </div>
      <div className="table-wrap">
        <table className="data-table data-table--peer">
          <thead>
            <tr>
              <th>Company</th>
              {activeColumns.map(({ canonical }) => (
                <th key={canonical}>{metricLabel(canonical)}</th>
              ))}
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const focused =
                focusedCompanyId !== null &&
                row.peerCompanyName.toLowerCase().includes(focusedCompanyId.toLowerCase());
              return (
                <tr
                  key={row.peerCompanyName}
                  className={focused ? "row--focus" : ""}
                >
                  <td>{row.peerCompanyName}</td>
                  {activeColumns.map(({ canonical, format }) => (
                    <td key={canonical} className="num">
                      {tableValueOrDash(row.values[canonical] ?? null, format)}
                    </td>
                  ))}
                  <td>
                    <SourceBadge provenance="screener-import" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="section-note">
        Imported from Screener export. Values are point-in-time snapshots,
        not growth metrics. Reconcile against official filings before any
        production use.
      </p>
    </section>
  );
}
