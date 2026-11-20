import { useEffect, useState } from 'react';

export function ItemLoadingHint({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 350);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <span className="item-loading-hint" role="status">
      {visible && <><span className="item-loading-indicator" aria-hidden="true" /><span>{label}</span></>}
    </span>
  );
}
