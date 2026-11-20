import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './notifications.css';

type Tone = 'success' | 'error';
type Notice = { message: string; tone: Tone; sequence: number; dialog?: HTMLDialogElement | null };
const notificationContext = createContext<((message: string, tone: Tone, dialog?: HTMLDialogElement | null) => void) | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((message: string, tone: Tone, dialog?: HTMLDialogElement | null) => {
    setNotice(previous => ({ message, tone, dialog, sequence: (previous?.sequence ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), notice.tone === 'success' ? 5000 : 7000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const region = <div className="notification-region" role="status" aria-atomic="true">
    {notice && <p key={notice.sequence} data-tone={notice.tone}>{notice.message}</p>}
  </div>;

  return (
    <notificationContext.Provider value={notify}>
      {children}
      {notice?.dialog?.open ? createPortal(region, notice.dialog) : region}
    </notificationContext.Provider>
  );
}

export function useNotifications() {
  const notify = useContext(notificationContext);
  if (!notify) throw new Error('NotificationProvider is required');
  return notify;
}
