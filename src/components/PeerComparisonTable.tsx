import {
  formatPercent,
  growthYoY,
  latestQuarter,
  margin,
  tableValueOrDash,
} from "../data/helpers/dhammaFinancials";
import {
  companyMasterSnapshot,
  quarterlyFinancialsSnapshot,
} from "../data/helpers/snapshotLoader";
import { EmptyState } from "./EmptyState";
import { SourceBadge } from "./SourceBadge";

interface PeerComparisonTableProps {
  companyId: string | null;
}

interface PeerRow {
  companyId: string;
  displayName: string;
  revenueGrowthYoY: number | null;
  ebitdaMargin: number | null;
  patMargin: number | null;
  epsGrowthYoY: number | null;
  hasData: boolean;
}

function buildPeerRows(): PeerRow[] {
  return companyMasterSnapshot.rows.map((company) => {
    const latest = latestQuarter(
      quarterlyFinancialsSnapshot.rows,
      company.companyId
    );
    // To compute YoY we need the prior-year same quarter row.
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

export function PeerComparisonTable({ companyId }: PeerComparisonTableProps) {
  const rows = buildPeerRows();
  const anyData = rows.some((r) => r.hasData);

  if (rows.length === 0) {
    return (
      <section className="peer-section" aria-label="Peer comparison">
        <h2 className="section-title">Peer comparison</h2>
        <EmptyState
          title="No peers configured"
          message="No companies in scripts/config/dhamma-companies.ts."
        />
      </section>
    );
  }

  if (!anyData) {
    return (
      <section className="peer-section" aria-label="Peer comparison">
        <div className="section-head">
          <h2 className="section-title">Peer comparison</h2>
          <SourceBadge provenance="pending" />
        </div>
        <EmptyState
          title="No peer comparison data available yet"
          message="Add official filings or Screener exports to populate this table."
          hint={`Peer group: ${rows.map((r) => r.displayName).join(", ")}`}
        />
      </section>
    );
  }

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
                className={row.companyId === companyId ? "row--focus" : ""}
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
