import {
  formatGenerationTimestamp,
  latestGeneratedAt,
} from "../data/helpers/dhammaFinancials";
import { ALL_SNAPSHOT_METAS } from "../data/helpers/snapshotLoader";

export function DashboardHeader() {
  const lastUpdated = formatGenerationTimestamp(
    latestGeneratedAt(ALL_SNAPSHOT_METAS.map((meta) => ({ meta })))
  );

  return (
    <header className="dashboard-header">
      <div className="dashboard-header__brand">
        <span className="dashboard-header__eyebrow">Dhamma Capital</span>
        <h1 className="dashboard-header__title">Earnings Dashboard</h1>
        <p className="dashboard-header__subtitle">
          Dashboard 1 · Earnings, financial quality, peer comparison,
          guidance accuracy
        </p>
      </div>
      <div className="dashboard-header__meta">
        <span className="dashboard-header__meta-label">Last updated</span>
        <span className="dashboard-header__meta-value">{lastUpdated}</span>
      </div>
    </header>
  );
}
