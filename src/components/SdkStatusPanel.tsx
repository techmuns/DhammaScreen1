// Visible Munshot SDK status panel.
//
// Renders the live SDK connection state so the integration can be
// verified without opening DevTools. The panel shows:
//   - Connection status pill (Connected / Standalone / Connecting / Error)
//   - SDK version + dashboard ID + channel ID
//   - Host context summary (user, organization, session, ticker)
//   - Last topic received with timestamp
//   - "Publish test telemetry" — emits a dashboard.metric event
//   - "Request context" — calls requestContext() and updates the panel
//
// Use this panel during embedding QA to confirm the dashboard is talking
// to the Munshot host correctly.

import { useState } from "react";

import type { SdkState, SdkStatus } from "../sdk/useMunshotSdk";

interface SdkStatusPanelProps {
  sdk: SdkState;
  dashboardId: string;
}

const STATUS_PILL: Record<SdkStatus, { label: string; tone: string }> = {
  loading: { label: "Loading SDK", tone: "neutral" },
  connecting: { label: "Connecting", tone: "warn" },
  connected: { label: "Connected", tone: "ok" },
  standalone: { label: "Standalone", tone: "neutral" },
  error: { label: "Error", tone: "bad" },
};

export function SdkStatusPanel({ sdk, dashboardId }: SdkStatusPanelProps) {
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const pill = STATUS_PILL[sdk.status];
  const hostUser = sdk.context?.user;
  const hostOrg = sdk.context?.organization;
  const hostSession = sdk.context?.session;
  const hostTicker =
    typeof sdk.context?.ticker === "string"
      ? sdk.context.ticker
      : typeof sdk.context?.symbol === "string"
        ? sdk.context.symbol
        : null;

  async function handleTelemetry() {
    const ok = await sdk.sendTestTelemetry();
    setActionMessage(
      ok
        ? "Published dashboard.metric · sdk.verify.click"
        : "Cannot publish — SDK is not connected"
    );
  }

  async function handleRequestContext() {
    if (sdk.status === "standalone" || sdk.status === "loading") {
      setActionMessage("Cannot request context — SDK is not connected");
      return;
    }
    await sdk.requestContext();
    setActionMessage("Context requested");
  }

  return (
    <div className="sdk-status">
      <div className="sdk-status__head">
        <span
          className={`sdk-status__pill sdk-status__pill--${pill.tone}`}
          data-testid="sdk-status-pill"
        >
          <span className="sdk-status__pill-dot" />
          {pill.label}
        </span>
        <span className="sdk-status__version">
          v{sdk.version ?? "—"}
        </span>
      </div>

      {sdk.reason ? (
        <p className="sdk-status__reason">{sdk.reason}</p>
      ) : null}
      {sdk.errorMessage ? (
        <p className="sdk-status__reason sdk-status__reason--error">
          {sdk.errorMessage}
        </p>
      ) : null}

      <dl className="sdk-status__grid">
        <DetailRow label="Dashboard ID" value={dashboardId} mono />
        <DetailRow
          label="Channel ID"
          value={sdk.channelId ?? "—"}
          mono
        />
        <DetailRow
          label="Host user"
          value={hostUser?.name ?? hostUser?.email ?? hostUser?.id ?? "—"}
        />
        <DetailRow label="Host org" value={hostOrg?.name ?? hostOrg?.id ?? "—"} />
        <DetailRow
          label="Session"
          value={hostSession?.id ?? "—"}
          mono
        />
        <DetailRow label="Host ticker" value={hostTicker ?? "—"} />
      </dl>

      <div className="sdk-status__last">
        <span className="sdk-status__last-label">Last event</span>
        {sdk.lastEvent ? (
          <>
            <code className="sdk-status__last-topic">
              {sdk.lastEvent.topic}
            </code>
            <span className="sdk-status__last-at">
              {formatRelative(sdk.lastEvent.at)}
            </span>
          </>
        ) : (
          <span className="sdk-status__last-empty">No events yet</span>
        )}
      </div>

      <div className="sdk-status__actions">
        <button
          type="button"
          className="sdk-status__action"
          onClick={handleTelemetry}
          disabled={sdk.status !== "connected"}
        >
          Publish test telemetry
        </button>
        <button
          type="button"
          className="sdk-status__action sdk-status__action--ghost"
          onClick={handleRequestContext}
          disabled={
            sdk.status === "standalone" || sdk.status === "loading"
          }
        >
          Request context
        </button>
      </div>

      {actionMessage ? (
        <p className="sdk-status__action-result" role="status">
          {actionMessage}
        </p>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="sdk-status__row-label">{label}</dt>
      <dd
        className={
          "sdk-status__row-value" +
          (mono ? " sdk-status__row-value--mono" : "")
        }
        title={value}
      >
        {value}
      </dd>
    </>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString();
}
