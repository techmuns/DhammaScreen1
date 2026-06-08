import type { CSSProperties, ReactNode } from "react";

interface WidgetCardProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  bodyPadding?: "padded" | "flush";
  span?: 1 | 2;
  style?: CSSProperties;
}

export function WidgetCard({
  title,
  subtitle,
  actions,
  children,
  bodyPadding = "flush",
  span = 1,
  style,
}: WidgetCardProps) {
  const className =
    "widget-card" + (span === 2 ? " widget--span-2" : "");
  const bodyClass =
    "widget-card__body widget-card__body--" + bodyPadding;
  return (
    <article className={className} style={style}>
      <header className="widget-card__header">
        <div className="widget-card__titles">
          <h3 className="widget-card__title">{title}</h3>
          {subtitle ? (
            <p className="widget-card__subtitle">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="widget-card__actions">{actions}</div>
        ) : null}
      </header>
      <div className={bodyClass}>{children}</div>
    </article>
  );
}
