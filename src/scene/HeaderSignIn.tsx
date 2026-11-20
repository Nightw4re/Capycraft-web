import { useEffect, useId } from 'react';
import { useMicrosoftAuth } from '../auth/MicrosoftAuthProvider';
import { usePreferences } from '../PreferencesProvider';
import { useHeaderDisclosure } from './useHeaderDisclosure';

export function HeaderSignIn() {
  const id = useId();
  const { text } = usePreferences();
  const auth = useMicrosoftAuth();
  const { open, setOpen, root, trigger, closeAndFocus, onBlur, onKeyDown } = useHeaderDisclosure();
  const loading = auth.busy || auth.status === 'initializing';
  const canSignIn = auth.status === 'ready' && !auth.signedIn;
  const accountName = auth.accountName || text.microsoftAccount;
  const errors = {
    cancelled: text.signInCancelled,
    signInFailed: text.signInFailed,
    signOutFailed: text.signOutFailed,
  };
  const hint = auth.error ? errors[auth.error] : auth.status === 'unconfigured' ? text.signInNotConfigured : text.signInUnavailable;

  useEffect(() => {
    if (auth.error) setOpen(true);
  }, [auth.error, setOpen]);

  async function onActivate() {
    if (loading) return;
    if (!canSignIn) {
      setOpen(!open);
      return;
    }

    setOpen(false);
    if (!await auth.signIn()) setOpen(true);
  }

  async function onSignOut() {
    closeAndFocus();
    if (!await auth.signOut()) setOpen(true);
  }

  return (
    <div className="header-sign-in" ref={root} onBlur={onBlur} onKeyDown={onKeyDown}>
      <button
        className="header-sign-in-trigger"
        type="button"
        ref={trigger}
        aria-label={canSignIn ? text.signInMicrosoft : undefined}
        aria-expanded={!canSignIn || open ? open : undefined}
        aria-controls={open ? id : undefined}
        aria-describedby={open && !auth.signedIn ? id : undefined}
        aria-disabled={loading}
        aria-busy={loading}
        onClick={onActivate}
      >
        <span className="header-sign-in-icon" aria-hidden="true"><span /></span>
        <span className="header-sign-in-label">{auth.signedIn ? accountName : text.signIn}</span>
      </button>
      {open && (auth.signedIn ? (
        <div className="header-sign-in-hint header-popup" id={id}>
          <p className="header-account-name">{accountName}</p>
          {auth.error && <p className="header-account-error" role="status">{hint}</p>}
          <button type="button" className="header-sign-out" onClick={onSignOut}>{text.signOut}</button>
        </div>
      ) : (
        <p className="header-sign-in-hint header-popup" id={id} role="status">{hint}</p>
      ))}
    </div>
  );
}
