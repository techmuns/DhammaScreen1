// Source registry, discovery adapters, and the existing financial-row
// adapter contract.
//
// The discovery adapters here are deliberately conservative:
//   - They attempt the public, non-paid corporate-announcement endpoints.
//   - They use realistic browser headers but DO NOT pretend to be a real
//     browser session (no cookie warming, no captcha solving).
//   - On any non-2xx, timeout, or unparseable response, they return
//     `{ rows: [], error: <message> }`. They never throw, they never fake
//     a row.
//
// This file deliberately does not try to download or parse the underlying
// PDF/XBRL documents. That is "extraction" and stays Audit-status in
// dashboard-1-metric-audit.md until a robust extractor exists.

import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  CompanyMaster,
  FilingManifestRow,
  FilingType,
  GuidanceCommentaryRow,
  QuarterlyFinancialRow,
  SegmentRevenueRow,
  SourceRegistryEntry,
} from "../../src/data/types/dhammaDashboard";

export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  {
    sourceId: "nse",
    sourceName: "National Stock Exchange of India — corporate announcements",
    baseUrl: "https://www.nseindia.com",
    sourceType: "exchange",
    reliability: "primary",
    supportsDiscovery: true,
    supportsDownload: true,
    notes:
      "Public API at /api/corporate-announcements. Bot-protected: requires browser-like headers and may rate-limit/block from data-center IPs.",
  },
  {
    sourceId: "bse",
    sourceName: "BSE — corporate announcements (AnnGetData)",
    baseUrl: "https://api.bseindia.com",
    sourceType: "exchange",
    reliability: "primary",
    supportsDiscovery: true,
    supportsDownload: true,
    notes:
      "Public JSON endpoint at /BseIndiaAPI/api/AnnGetData/w. Generally more permissive than NSE.",
  },
  {
    sourceId: "company_ir",
    sourceName: "Company investor relations page",
    baseUrl: null,
    sourceType: "company_ir",
    reliability: "secondary",
    supportsDiscovery: false,
    supportsDownload: true,
    notes:
      "Per-company IR pages are useful as a fallback for presentations and transcripts, but layouts vary and URLs are not stable.",
  },
  {
    sourceId: "manual",
    sourceName: "Manual source URL fallback",
    baseUrl: null,
    sourceType: "manual",
    reliability: "audit",
    supportsDiscovery: false,
    supportsDownload: false,
    notes:
      "Reserved for analyst-curated URLs when automated discovery is blocked. Treat as audit-quality only.",
  },
];

// ---------------------------------------------------------------------------
// Existing financial-row adapter contract (Step 1).
// Kept intact so the rest of the pipeline still compiles. Discovery adapters
// are a separate path; extraction (which would populate these) stays Audit.
// ---------------------------------------------------------------------------

export type SourceClass =
  | "nse_bse_filing"
  | "investor_presentation"
  | "annual_report"
  | "concall_transcript";

export interface DhammaSourceAdapter {
  fetchQuarterlyFinancials(
    company: CompanyMaster
  ): Promise<QuarterlyFinancialRow[]>;
  fetchAnnualFinancials(company: CompanyMaster): Promise<AnnualFinancialRow[]>;
  fetchSegmentRevenue(company: CompanyMaster): Promise<SegmentRevenueRow[]>;
  fetchBalanceSheet(company: CompanyMaster): Promise<BalanceSheetRow[]>;
  fetchCashFlow(company: CompanyMaster): Promise<CashFlowRow[]>;
  fetchGuidanceCommentary(
    company: CompanyMaster
  ): Promise<GuidanceCommentaryRow[]>;
}

export const placeholderAdapter: DhammaSourceAdapter = {
  async fetchQuarterlyFinancials() {
    return [];
  },
  async fetchAnnualFinancials() {
    return [];
  },
  async fetchSegmentRevenue() {
    return [];
  },
  async fetchBalanceSheet() {
    return [];
  },
  async fetchCashFlow() {
    return [];
  },
  async fetchGuidanceCommentary() {
    return [];
  },
};

// ---------------------------------------------------------------------------
// Discovery adapters.
// Return type:
//   - rows: FilingManifestRow[]   one row per filing surfaced
//   - error: string | null        non-null = source was unreachable / bad shape
// Adapters NEVER throw.
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  rows: FilingManifestRow[];
  error: string | null;
}

export interface DiscoveryOptions {
  maxFilings: number;
  fetchedAt: string;
}

export interface DhammaDiscoveryAdapter {
  sourceId: string;
  discover(
    company: CompanyMaster,
    opts: DiscoveryOptions
  ): Promise<DiscoveryResult>;
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const REQUEST_TIMEOUT_MS = 15_000;

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

function classifyFilingType(rawTitle: string | null): FilingType {
  if (!rawTitle) return "other";
  const t = rawTitle.toLowerCase();
  if (
    t.includes("financial result") ||
    t.includes("quarterly result") ||
    /(q[1-4]|quarter)/.test(t)
  ) {
    return "quarterly_result";
  }
  if (t.includes("annual report")) return "annual_report";
  if (t.includes("investor presentation") || t.includes("earnings presentation")) {
    return "investor_presentation";
  }
  if (t.includes("transcript") || t.includes("earnings call")) {
    return "concall_transcript";
  }
  if (t.includes("guidance") || t.includes("outlook")) {
    return "guidance_commentary";
  }
  return "other";
}

function fileTypeFromUrl(
  url: string | null
): FilingManifestRow["fileType"] {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "unknown";
}

// --- BSE discovery -----------------------------------------------------------
// Endpoint: GET /BseIndiaAPI/api/AnnGetData/w
// Query:    strCat=Result   strScrip=<bseCode>   strType=C
// Response: { Table: [ { NEWSID, HEADLINE, ATTACHMENTNAME, NEWS_DT, ... } ], ... }

export const bseDiscoveryAdapter: DhammaDiscoveryAdapter = {
  sourceId: "bse",
  async discover(company, opts) {
    if (!company.bseCode) {
      return {
        rows: [],
        error: "BSE code not configured for this company.",
      };
    }
    const toDate = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - 365 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const url =
      "https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w" +
      `?pageno=1&strCat=Result&strPrevDate=${fromDate}` +
      `&strScrip=${encodeURIComponent(company.bseCode)}` +
      `&strSearch=P&strToDate=${toDate}&strType=C`;

    try {
      const response = await fetch(url, {
        headers: { ...BROWSER_HEADERS, Referer: "https://www.bseindia.com/" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          rows: [],
          error: `BSE HTTP ${response.status}`,
        };
      }
      const json = (await response.json()) as {
        Table?: Array<Record<string, unknown>>;
      };
      const table = Array.isArray(json.Table) ? json.Table : [];
      const rows: FilingManifestRow[] = table
        .slice(0, opts.maxFilings)
        .map((entry) => {
          const headline = (entry.HEADLINE as string | undefined) ?? null;
          const attachment =
            (entry.ATTACHMENTNAME as string | undefined) ?? null;
          const documentUrl = attachment
            ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attachment}`
            : null;
          const newsDt = (entry.NEWS_DT as string | undefined) ?? null;
          const filingDate = newsDt ? newsDt.slice(0, 10) : null;
          return {
            companyId: company.companyId,
            companyName: company.displayName,
            sourceId: "bse",
            filingType: classifyFilingType(headline),
            periodType: "unknown",
            period: null,
            filingDate,
            title: headline,
            sourceUrl: "https://www.bseindia.com/corporates/ann.html",
            documentUrl,
            fileType: fileTypeFromUrl(documentUrl),
            status: "discovered",
            fetchedAt: opts.fetchedAt,
            errorMessage: null,
            sourceReliability: "primary",
          };
        });
      return { rows, error: null };
    } catch (err) {
      return { rows: [], error: `BSE fetch failed: ${safeErrorMessage(err)}` };
    }
  },
};

// --- NSE discovery -----------------------------------------------------------
// Endpoint: GET /api/corporate-announcements
// Query:    index=equities  symbol=<nseSymbol>
// Response: array of announcements with desc, attchmntFile, an_dt, ...
//
// NSE aggressively rate-limits non-browser clients. Discovery here is
// best-effort; expect to see `blocked` in source-health when running from
// data-center IPs.

export const nseDiscoveryAdapter: DhammaDiscoveryAdapter = {
  sourceId: "nse",
  async discover(company, opts) {
    if (!company.nseSymbol) {
      return {
        rows: [],
        error: "NSE symbol not configured for this company.",
      };
    }
    const url =
      "https://www.nseindia.com/api/corporate-announcements" +
      `?index=equities&symbol=${encodeURIComponent(company.nseSymbol)}`;

    try {
      const response = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          Referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(company.nseSymbol)}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          rows: [],
          error: `NSE HTTP ${response.status}`,
        };
      }
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          rows: [],
          error: "NSE response was not JSON (likely a block page).",
        };
      }
      const list = Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : Array.isArray((parsed as { data?: unknown }).data)
          ? ((parsed as { data: Array<Record<string, unknown>> }).data)
          : [];

      const rows: FilingManifestRow[] = list
        .filter((entry) => {
          const desc = (entry.desc as string | undefined) ?? "";
          return /financial result|quarterly result|annual report|investor presentation|earnings call|transcript/i.test(
            desc
          );
        })
        .slice(0, opts.maxFilings)
        .map((entry) => {
          const desc = (entry.desc as string | undefined) ?? null;
          const attachment =
            (entry.attchmntFile as string | undefined) ?? null;
          const announcedAt = (entry.an_dt as string | undefined) ?? null;
          const filingDate = announcedAt
            ? announcedAt.slice(0, 10)
            : null;
          return {
            companyId: company.companyId,
            companyName: company.displayName,
            sourceId: "nse",
            filingType: classifyFilingType(desc),
            periodType: "unknown",
            period: null,
            filingDate,
            title: desc,
            sourceUrl: `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(company.nseSymbol ?? "")}`,
            documentUrl: attachment,
            fileType: fileTypeFromUrl(attachment),
            status: "discovered",
            fetchedAt: opts.fetchedAt,
            errorMessage: null,
            sourceReliability: "primary",
          };
        });
      return { rows, error: null };
    } catch (err) {
      return { rows: [], error: `NSE fetch failed: ${safeErrorMessage(err)}` };
    }
  },
};

export const DISCOVERY_ADAPTERS: DhammaDiscoveryAdapter[] = [
  nseDiscoveryAdapter,
  bseDiscoveryAdapter,
];
