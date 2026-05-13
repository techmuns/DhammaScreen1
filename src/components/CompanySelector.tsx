import type { CompanyMaster } from "../data/types/dhammaDashboard";

interface CompanySelectorProps {
  companies: ReadonlyArray<CompanyMaster>;
  value: string | null;
  onChange: (companyId: string) => void;
}

export function CompanySelector({
  companies,
  value,
  onChange,
}: CompanySelectorProps) {
  if (companies.length === 0) {
    return (
      <div className="company-selector company-selector--empty">
        <label className="company-selector__label">Company</label>
        <span className="company-selector__empty">
          No companies configured. Edit{" "}
          <code>scripts/config/dhamma-companies.ts</code>.
        </span>
      </div>
    );
  }

  return (
    <div className="company-selector">
      <label className="company-selector__label" htmlFor="company-selector">
        Company
      </label>
      <select
        id="company-selector"
        className="company-selector__select"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {companies.map((company) => (
          <option key={company.companyId} value={company.companyId}>
            {company.displayName}
            {company.nseSymbol ? ` · NSE:${company.nseSymbol}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
