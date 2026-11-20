import { useId, type ReactNode } from 'react';
import './info-panel.css';

type InfoPanelProps = {
  title?: string;
  children: ReactNode;
};

export function InfoPanel({ title, children }: InfoPanelProps) {
  const headingId = useId();

  return (
    <section className="info-panel" aria-labelledby={title ? headingId : undefined}>
      {title && <h2 id={headingId}>{title}</h2>}
      <div className="info-panel-body">{children}</div>
    </section>
  );
}
