import type { ReactNode } from 'react';
import './page-layout.css';

type PageLayoutProps = {
  title?: string;
  header?: ReactNode;
  layout?: 'stack' | 'grid' | 'home';
  children: ReactNode;
};

export function PageLayout({ title, header, layout = 'stack', children }: PageLayoutProps) {
  return (
    <div className="page-layout">
      {header ?? (title && <h1 className="page-layout-title">{title}</h1>)}
      <div className="page-layout-content" data-layout={layout}>{children}</div>
    </div>
  );
}
