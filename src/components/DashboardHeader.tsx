import type { ReactNode } from "react";

import type { SdkStatus } from "../sdk/useMunshotSdk";

interface DashboardHeaderProps {
  title: string;
  ticker?: string | null;
  company?: string | null;
  lastUpdated?: string | null;
  sdkStatus?: SdkStatus;
  actions?: ReactNode;
}

const SDK_DOT_LABEL: Record<SdkStatus, string> = {
  loading: "SDK loading",
  standalone: "SDK standalone",
  connecting: "SDK connecting",
  connected: "SDK connected",
  error: "SDK error",
};

const SDK_DOT_MODIFIER: Record<SdkStatus, string> = {
  loading: "connecting",
  standalone: "standalone",
  connecting: "connecting",
  connected: "connected",
  error: "error",
};

export function DashboardHeader({
  title,
  ticker,
  company,
  lastUpdated,
  sdkStatus,
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
        {sdkStatus ? (
          <span
            className={`sdk-dot sdk-dot--${SDK_DOT_MODIFIER[sdkStatus]}`}
            title={SDK_DOT_LABEL[sdkStatus]}
          >
            <span className="sdk-dot__indicator" aria-hidden="true" />
            {SDK_DOT_LABEL[sdkStatus]}
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
