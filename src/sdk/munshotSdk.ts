// Minimal type surface for the Munshot Dashboard SDK
// (window.MunshotDashboardSDK v1.0.0). The SDK ships as a global,
// so we declare the shape here rather than depending on @types.

export interface HostContext {
  user?: {
    id?: string;
    name?: string;
    email?: string;
  } | null;
  organization?: {
    id?: string;
    name?: string;
  } | null;
  session?: {
    id?: string;
    issuedAt?: string;
  } | null;
  ticker?: string | null;
  symbol?: string | null;
  filters?: Record<string, unknown> | null;
  navigation?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface TopicMeta {
  ts?: string;
  source?: string;
  [key: string]: unknown;
}

export interface SdkMessage {
  topic?: string;
  data?: unknown;
  meta?: TopicMeta;
  [key: string]: unknown;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export interface SdkClient {
  ready: () => void;
  destroy: () => void;
  getContext: () => HostContext | null;
  getChannelId: () => string | null;
  requestContext: () => Promise<HostContext>;
  onMessage: (cb: (msg: SdkMessage) => void) => () => void;
  onTopic: (
    topic: string,
    cb: (data: unknown, meta?: TopicMeta) => void
  ) => () => void;
  onRequest: (
    command: string,
    handler: (data: unknown) => Promise<unknown> | unknown
  ) => () => void;
  publish: (topic: string, data?: unknown, metadata?: TopicMeta) => void;
  request: <T = unknown>(
    topic: string,
    data?: unknown,
    options?: RequestOptions
  ) => Promise<T>;
  sendError: (message: string, code?: string, details?: unknown) => void;
}

export interface SdkConfig {
  dashboardId: string;
  dashboardName?: string;
  targetWindow?: Window;
  targetOrigin?: string;
  allowedOrigins?: string[];
  requestTimeoutMs?: number;
  maxPayloadBytes?: number;
  autoReady?: boolean;
  lockOriginOnFirstMessage?: boolean;
}

export interface MunshotDashboardSDK {
  namespace: string;
  version: string;
  createClient: (config: SdkConfig) => SdkClient;
  Client: new (config: SdkConfig) => SdkClient;
}

declare global {
  interface Window {
    MunshotDashboardSDK?: MunshotDashboardSDK;
  }
}

// Wait for the SDK script to attach a global. Returns the SDK or null
// after the timeout (e.g. running outside the Munshot iframe / blocked
// in dev). Polls every 100ms so the perceived delay is minimal.
export function waitForSdk(
  timeoutMs = 4000
): Promise<MunshotDashboardSDK | null> {
  return new Promise((resolve) => {
    if (window.MunshotDashboardSDK) {
      resolve(window.MunshotDashboardSDK);
      return;
    }
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (window.MunshotDashboardSDK) {
        window.clearInterval(interval);
        resolve(window.MunshotDashboardSDK);
      } else if (Date.now() - start > timeoutMs) {
        window.clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

export function isInsideIframe(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}
