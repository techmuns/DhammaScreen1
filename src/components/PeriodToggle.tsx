export type PeriodView = "quarters" | "years";

interface PeriodToggleProps {
  value: PeriodView;
  onChange: (next: PeriodView) => void;
}

export function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div className="period-toggle" role="tablist" aria-label="Period view">
      <button
        type="button"
        role="tab"
        aria-selected={value === "quarters"}
        className={`period-toggle__option ${
          value === "quarters" ? "period-toggle__option--active" : ""
        }`}
        onClick={() => onChange("quarters")}
      >
        Last 5 Quarters
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "years"}
        className={`period-toggle__option ${
          value === "years" ? "period-toggle__option--active" : ""
        }`}
        onClick={() => onChange("years")}
      >
        Last 5 Years
      </button>
    </div>
  );
}
