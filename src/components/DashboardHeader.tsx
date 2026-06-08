import type { ReactNode } from "react";

interface DashboardHeaderProps {
  title: string;
  ticker?: string | null;
  company?: string | null;
  lastUpdated?: string | null;
  actions?: ReactNode;
}

export function DashboardHeader({
  title,
  ticker,
  company,
  lastUpdated,
  actions,
}: DashboardHeaderProps) {
  return (
    <header className="dashboard-header">
      <div className="dashboard-header__left">
        <h1 className="dashboard-header__title">{title}</h1>
        {ticker ? <TickerPill ticker={ticker} company={company} /> : null}
      </div>
      <div className="dashboard-header__right">
        {lastUpdated ? (
          <span className="dashboard-header__meta" title="Latest snapshot">
            Updated {lastUpdated}
          </span>
        ) : null}
        {actions}
      </div>
    </header>
  );
}

function TickerPill({
  ticker,
  company,
}: {
  ticker: string;
  company?: string | null;
}) {
  return (
    <span className="ticker-pill" title={company ?? ticker}>
      <span className="ticker-pill__dot" />
      {ticker}
      {company ? (
        <span className="ticker-pill__company">- {company}</span>
      ) : null}
    </span>
  );
}
