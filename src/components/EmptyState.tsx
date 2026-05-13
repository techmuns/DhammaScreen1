interface EmptyStateProps {
  title: string;
  message: string;
  hint?: string;
}

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__message">{message}</p>
      {hint ? <p className="empty-state__hint">{hint}</p> : null}
    </div>
  );
}
