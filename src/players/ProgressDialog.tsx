import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { usePreferences } from '../PreferencesProvider';
import './progress-dialog.css';

export function ProgressDialog({ title, onClose, children, overlay, dialogRef, restoreFocus, suspended = false, kind }: {
  title: ReactNode; onClose: () => void; children: ReactNode; overlay?: ReactNode;
  dialogRef?: RefObject<HTMLDialogElement | null>; restoreFocus?: RefObject<HTMLElement | null>;
  suspended?: boolean; kind: 'quest' | 'advancement';
}) {
  const { text } = usePreferences();
  const internalRef = useRef<HTMLDialogElement>(null);
  const dialog = dialogRef ?? internalRef;
  const headingId = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element || suspended) return;
    element.showModal();
    if (restoreFocus?.current?.isConnected) restoreFocus.current.focus();
    if (restoreFocus) restoreFocus.current = null;
    return () => element.close();
  }, [dialog, restoreFocus, suspended]);

  return <dialog ref={dialog} className="progress-dialog" data-kind={kind} aria-labelledby={headingId}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="progress-dialog-header">
      <h2 className="progress-entry-title" id={headingId}>{title}</h2>
      <button type="button" onClick={onClose} aria-label={text.close}>×</button>
    </header>
    <div className="progress-dialog-body">{children}</div>
    {overlay}
  </dialog>;
}
