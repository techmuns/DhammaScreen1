// Canonical metric and period mapping for Screener-style imports.
//
// Screener uses inconsistent labels across sheets ("Sales" / "Revenue",
// "Net Profit" / "Profit", "Mar 2024" / "TTM"). This module is the one
// place that maps those labels onto stable internal names so every other
// helper and UI component can switch on `CanonicalMetric` instead of
// raw strings.
//
// Anything not in the alias table stays `null` — the UI will show it as
// a dash rather than guess.

export type CanonicalMetric =
  // P&L
  | "revenue"
  | "operating_profit"
  | "opm"
  | "other_income"
  | "interest"
  | "depreciation"
  | "pbt"
  | "pat"
  | "eps"
  // Balance sheet
  | "share_capital"
  | "reserves"
  | "borrowings"
  | "other_liabilities"
  | "total_liabilities"
  | "fixed_assets"
  | "cwip"
  | "investments"
  | "other_assets"
  | "total_assets"
  // Cash flow
  | "cfo"
  | "cfi"
  | "cff"
  | "net_cash_flow"
  // Ratios
  | "debtor_days"
  | "inventory_days"
  | "days_payable"
  | "ccc"
  | "working_capital_days"
  | "roce"
  | "roe"
  | "free_cash_flow"
  // Peer comparison
  | "market_cap"
  | "current_price"
  | "stock_pe"
  | "ev_ebitda";

interface AliasEntry {
  canonical: CanonicalMetric;
  patterns: RegExp[];
}

// Order matters: more specific patterns must come before more general ones
// (e.g. "operating profit" before "profit").
const ALIAS_TABLE: AliasEntry[] = [
  // P&L
  { canonical: "operating_profit", patterns: [/^operating\s+profit$/i] },
  { canonical: "opm", patterns: [/^opm\s*%?$/i, /^operating\s+margin\s*%?$/i] },
  {
    canonical: "revenue",
    patterns: [
      /^sales$/i,
      /^revenue(?:\s+from\s+operations)?$/i,
      /^net\s+sales$/i,
      // Peer table columns: "Sales Qtr Rs.Cr.", "Sales Last Year Rs.Cr."
      /^sales\s+qtr(?:\s+rs\.?\s*cr\.?)?$/i,
      /^sales\s+last\s+year(?:\s+rs\.?\s*cr\.?)?$/i,
    ],
  },
  { canonical: "other_income", patterns: [/^other\s+income$/i] },
  { canonical: "interest", patterns: [/^interest$/i, /^finance\s+cost$/i] },
  { canonical: "depreciation", patterns: [/^depreciation$/i] },
  { canonical: "pbt", patterns: [/^profit\s+before\s+tax$/i, /^pbt$/i] },
  {
    canonical: "pat",
    patterns: [
      /^net\s+profit$/i,
      /^profit\s+for\s+the\s+period$/i,
      /^profit$/i,
      /^pat$/i,
      // Peer table columns: "NP Qtr Rs.Cr.", "Net Profit Qtr Rs.Cr."
      /^np\s+qtr(?:\s+rs\.?\s*cr\.?)?$/i,
      /^net\s+profit\s+qtr(?:\s+rs\.?\s*cr\.?)?$/i,
    ],
  },
  { canonical: "eps", patterns: [/^eps(?:\s+in\s+rs\.?)?$/i] },

  // Balance sheet
  {
    canonical: "share_capital",
    patterns: [/^share\s+capital$/i, /^equity\s+capital$/i],
  },
  { canonical: "reserves", patterns: [/^reserves$/i] },
  { canonical: "borrowings", patterns: [/^borrowings$/i] },
  { canonical: "other_liabilities", patterns: [/^other\s+liabilities$/i] },
  { canonical: "total_liabilities", patterns: [/^total\s+liabilities$/i] },
  {
    canonical: "fixed_assets",
    patterns: [/^fixed\s+assets$/i, /^net\s+block$/i],
  },
  {
    canonical: "cwip",
    patterns: [/^cwip$/i, /^capital\s+work[- ]in[- ]progress$/i],
  },
  { canonical: "investments", patterns: [/^investments$/i] },
  { canonical: "other_assets", patterns: [/^other\s+assets$/i] },
  { canonical: "total_assets", patterns: [/^total\s+assets$/i] },

  // Cash flow
  {
    canonical: "cfo",
    patterns: [/^cash\s+from\s+operating\s+activity$/i, /^cfo$/i],
  },
  {
    canonical: "cfi",
    patterns: [/^cash\s+from\s+investing\s+activity$/i, /^cfi$/i],
  },
  {
    canonical: "cff",
    patterns: [/^cash\s+from\s+financing\s+activity$/i, /^cff$/i],
  },
  { canonical: "net_cash_flow", patterns: [/^net\s+cash\s+flow$/i] },

  // Ratios
  { canonical: "debtor_days", patterns: [/^debtor\s+days$/i] },
  { canonical: "inventory_days", patterns: [/^inventory\s+days$/i] },
  { canonical: "days_payable", patterns: [/^days\s+payable$/i] },
  { canonical: "ccc", patterns: [/^cash\s+conversion\s+cycle$/i] },
  {
    canonical: "working_capital_days",
    patterns: [/^working\s+capital\s+days$/i],
  },
  { canonical: "roce", patterns: [/^roce\s*%?$/i] },
  { canonical: "roe", patterns: [/^roe\s*%?$/i] },
  {
    canonical: "free_cash_flow",
    patterns: [/^free\s+cash\s+flow$/i, /^fcf$/i],
  },

  // Peer comparison
  {
    canonical: "market_cap",
    patterns: [/^mar(?:ket)?\s*cap(?:\s+rs.*)?$/i, /^mcap(?:\s+rs.*)?$/i],
  },
  {
    canonical: "current_price",
    patterns: [/^c(?:urrent)?\s*p(?:rice)?\s*(?:rs\.?)?$/i, /^cmp(?:\s+rs\.?)?$/i],
  },
  { canonical: "stock_pe", patterns: [/^stock\s+p\/?e$/i, /^p\/?e$/i] },
  { canonical: "ev_ebitda", patterns: [/^ev\s*\/?\s*ebitda$/i] },
];

export function canonicalizeScreenerMetric(
  raw: string
): CanonicalMetric | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const entry of ALIAS_TABLE) {
    for (const pattern of entry.patterns) {
      if (pattern.test(trimmed)) return entry.canonical;
    }
  }
  return null;
}

const MONTH_TO_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface ParsedScreenerPeriod {
  sortKey: string;
  display: string;
}

// Accepts "Mar 2024", "Jun. 2024", "TTM". Returns null for anything else.
// `sortKey` is `YYYY-MM`; TTM is parked at the end with `9999-99`.
export function parseScreenerPeriod(
  raw: string
): ParsedScreenerPeriod | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^ttm$/i.test(s)) return { sortKey: "9999-99", display: "TTM" };
  const match = s.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{4})$/i
  );
  if (!match) return null;
  const month = MONTH_TO_NUM[match[1].slice(0, 3).toLowerCase()];
  const year = Number.parseInt(match[2], 10);
  if (!month || !Number.isFinite(year)) return null;
  return {
    sortKey: `${year}-${String(month).padStart(2, "0")}`,
    display: s,
  };
}

const METRIC_LABELS: Record<CanonicalMetric, string> = {
  revenue: "Revenue / Sales",
  operating_profit: "Operating Profit",
  opm: "OPM",
  other_income: "Other Income",
  interest: "Interest",
  depreciation: "Depreciation",
  pbt: "Profit before tax",
  pat: "Net Profit",
  eps: "EPS",
  share_capital: "Share Capital",
  reserves: "Reserves",
  borrowings: "Borrowings",
  other_liabilities: "Other Liabilities",
  total_liabilities: "Total Liabilities",
  fixed_assets: "Fixed Assets",
  cwip: "CWIP",
  investments: "Investments",
  other_assets: "Other Assets",
  total_assets: "Total Assets",
  cfo: "CFO",
  cfi: "CFI",
  cff: "CFF",
  net_cash_flow: "Net Cash Flow",
  debtor_days: "Debtor Days",
  inventory_days: "Inventory Days",
  days_payable: "Days Payable",
  ccc: "Cash Conversion Cycle",
  working_capital_days: "Working Capital Days",
  roce: "ROCE",
  roe: "ROE",
  free_cash_flow: "Free Cash Flow",
  market_cap: "Market Cap",
  current_price: "Current Price",
  stock_pe: "Stock P/E",
  ev_ebitda: "EV / EBITDA",
};

export function metricLabel(canonical: CanonicalMetric): string {
  return METRIC_LABELS[canonical];
}
