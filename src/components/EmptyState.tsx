interface EmptyStateProps {
  title: string;
  message: string;
  hint?: string;
  icon?: string;
}

export function EmptyState({
  title,
  message,
  hint,
  icon = "◌",
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__message">{message}</p>
      {hint ? <p className="empty-state__hint">{hint}</p> : null}
    </div>
  );
}
