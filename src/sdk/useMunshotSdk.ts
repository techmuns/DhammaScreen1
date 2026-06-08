// Munshot Dashboard SDK lifecycle hook.
//
// Implements the lifecycle the dashboard skill mandates:
//   1. Load the SDK (script tag in index.html attaches window.MunshotDashboardSDK).
//   2. Create the client during startup.
//   3. Register dashboard metadata via dashboardId / dashboardName.
//   4. Signal readiness (autoReady defaults to true; we also call ready() explicitly).
//   5. Request initial host context.
//   6. Subscribe to host context updates (host.context.update + ticker.select).
//   7. Handle disconnect / error scenarios — surface them via the status state.
//
// When the dashboard is opened outside the Munshot host (dev, preview), the
// hook resolves to `standalone` so the UI keeps working and the SDK panel
// shows a clear "not embedded" reason.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isInsideIframe,
  waitForSdk,
  type HostContext,
  type SdkClient,
  type SdkMessage,
} from "./munshotSdk";

export type SdkStatus =
  | "loading"
  | "standalone"
  | "connecting"
  | "connected"
  | "error";

export interface SdkEvent {
  topic: string;
  at: string;
  data?: unknown;
}

export interface SdkState {
  status: SdkStatus;
  reason: string | null;
  version: string | null;
  channelId: string | null;
  context: HostContext | null;
  lastEvent: SdkEvent | null;
  errorMessage: string | null;
  publish: (topic: string, data?: unknown) => boolean;
  requestContext: () => Promise<void>;
  sendTestTelemetry: () => Promise<boolean>;
}

interface UseMunshotSdkOptions {
  dashboardId: string;
  dashboardName: string;
}

export function useMunshotSdk(options: UseMunshotSdkOptions): SdkState {
  const { dashboardId, dashboardName } = options;
  const [status, setStatus] = useState<SdkStatus>("loading");
  const [reason, setReason] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [context, setContext] = useState<HostContext | null>(null);
  const [lastEvent, setLastEvent] = useState<SdkEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clientRef = useRef<SdkClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function bootstrap() {
      if (!isInsideIframe()) {
        setStatus("standalone");
        setReason(
          "Dashboard is not embedded in a Munshot iframe. SDK integration " +
            "is wired and will activate when this dashboard is opened inside " +
            "the Munshot host."
        );
        return;
      }

      const sdk = await waitForSdk();
      if (cancelled) return;
      if (!sdk) {
        setStatus("standalone");
        setReason(
          "Munshot Dashboard SDK script did not attach within the timeout. " +
            "Check that the SDK URL is reachable and that the page is not " +
            "blocking third-party scripts."
        );
        return;
      }

      setVersion(sdk.version ?? null);

      let client: SdkClient;
      try {
        client = sdk.createClient({
          dashboardId,
          dashboardName,
          // The SDK defaults targetWindow to window.parent inside an iframe.
          // We let it do that — overriding is only needed for fixture tests.
        });
      } catch (err) {
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "SDK init failed"
        );
        return;
      }
      clientRef.current = client;

      setStatus("connecting");
      setReason("Awaiting initial host context.");

      // 4. Signal readiness explicitly even though autoReady is true. Two
      // ready() calls are a no-op on a sane SDK; one missed call is a bug.
      try {
        client.ready();
      } catch (err) {
        // Non-fatal — log and continue. The autoReady=true default means
        // the host will still see us as ready.
        // eslint-disable-next-line no-console
        console.warn("[munshot-sdk] ready() threw", err);
      }

      setChannelId(client.getChannelId());

      // 6. Subscribe to host context + ticker updates before requesting
      // initial context, so we don't miss an update arriving between
      // requestContext() and our subscription.
      try {
        unsubscribers.push(
          client.onTopic("host.context.update", (data) => {
            if (cancelled) return;
            if (isHostContext(data)) {
              setContext(data);
            }
            setLastEvent({
              topic: "host.context.update",
              at: new Date().toISOString(),
              data,
            });
          })
        );
        unsubscribers.push(
          client.onTopic("portfolio.ticker.select", (data) => {
            if (cancelled) return;
            setLastEvent({
              topic: "portfolio.ticker.select",
              at: new Date().toISOString(),
              data,
            });
            const ticker = pickTicker(data);
            if (ticker) {
              setContext((prev) => ({ ...(prev ?? {}), ticker }));
            }
          })
        );
        unsubscribers.push(
          client.onMessage((msg: SdkMessage) => {
            if (cancelled) return;
            // Light passive logging — useful for SDK verification.
            if (msg && typeof msg.topic === "string") {
              setLastEvent({
                topic: msg.topic,
                at: new Date().toISOString(),
                data: msg.data,
              });
            }
          })
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[munshot-sdk] subscription failed", err);
      }

      // 5. Request initial host context.
      try {
        const ctx = await client.requestContext();
        if (cancelled) return;
        if (isHostContext(ctx)) {
          setContext(ctx);
        }
        setStatus("connected");
        setReason(null);
      } catch (err) {
        if (cancelled) return;
        // Host may not respond if it's not the Munshot platform. Stay on
        // "connecting" if a context update arrives later via subscription,
        // but for now mark standalone with a hint.
        setStatus("standalone");
        setReason(
          "Host did not respond to requestContext within the timeout. " +
            "If the dashboard is embedded by Munshot, ensure the host has " +
            "registered this dashboard channel."
        );
        // eslint-disable-next-line no-console
        console.warn("[munshot-sdk] requestContext failed", err);
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      for (const off of unsubscribers) {
        try {
          off();
        } catch {
          // best-effort
        }
      }
      if (clientRef.current) {
        try {
          clientRef.current.destroy();
        } catch {
          // best-effort
        }
        clientRef.current = null;
      }
    };
  }, [dashboardId, dashboardName]);

  const publish = useCallback(
    (topic: string, data?: unknown): boolean => {
      const client = clientRef.current;
      if (!client) return false;
      try {
        client.publish(topic, data);
        return true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[munshot-sdk] publish failed", topic, err);
        return false;
      }
    },
    []
  );

  const requestContext = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const ctx = await client.requestContext();
      if (isHostContext(ctx)) {
        setContext(ctx);
      }
      setLastEvent({
        topic: "host.context.request",
        at: new Date().toISOString(),
        data: ctx,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "requestContext failed";
      setErrorMessage(msg);
      // eslint-disable-next-line no-console
      console.warn("[munshot-sdk] requestContext failed", err);
    }
  }, []);

  const sendTestTelemetry = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current;
    if (!client) return false;
    try {
      client.publish("dashboard.metric", {
        name: "sdk.verify.click",
        value: 1,
        at: new Date().toISOString(),
        dashboardId,
      });
      setLastEvent({
        topic: "dashboard.metric",
        at: new Date().toISOString(),
        data: { name: "sdk.verify.click", value: 1 },
      });
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[munshot-sdk] test telemetry failed", err);
      return false;
    }
  }, [dashboardId]);

  return useMemo<SdkState>(
    () => ({
      status,
      reason,
      version,
      channelId,
      context,
      lastEvent,
      errorMessage,
      publish,
      requestContext,
      sendTestTelemetry,
    }),
    [
      status,
      reason,
      version,
      channelId,
      context,
      lastEvent,
      errorMessage,
      publish,
      requestContext,
      sendTestTelemetry,
    ]
  );
}

function isHostContext(value: unknown): value is HostContext {
  return typeof value === "object" && value !== null;
}

function pickTicker(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  for (const key of ["ticker", "symbol", "nseSymbol", "id"]) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
