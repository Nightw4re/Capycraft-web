import { useEffect, useId, useState } from 'react';
import { MinecraftAccountDialog, minecraftAccountTitle } from '../auth/MinecraftAccountDialog';
import { useAccountAuth } from '../auth/accountAuth';
import { usePreferences } from '../PreferencesProvider';
import { useHeaderDisclosure } from './useHeaderDisclosure';

function AccountAvatar({ name, src }: { name?: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  return <span className="header-account-avatar" aria-hidden="true">
    {src && !failed ? <img src={src} alt="" width={24} height={24} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : initials || <span className="header-sign-in-icon"><span /></span>}
  </span>;
}

export function HeaderSignIn() {
  const id = useId();
  const { text, language } = usePreferences();
  const [dialogSession, setDialogSession] = useState<string>();
  const auth = useAccountAuth();
  const { open, setOpen, root, trigger, closeAndFocus, onBlur, onKeyDown } = useHeaderDisclosure();
  const loading = auth.busy || auth.status === 'initializing';
  const canSignIn = auth.status === 'ready' && !auth.signedIn;
  const accountName = auth.accountName || text.signIn;
  const errors = {
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
        aria-label={canSignIn ? text.signIn : undefined}
        aria-expanded={!canSignIn || open ? open : undefined}
        aria-controls={open ? id : undefined}
        aria-describedby={open && !auth.signedIn ? id : undefined}
        aria-disabled={loading}
        aria-busy={loading}
        onClick={onActivate}
      >
        {auth.signedIn
          ? <AccountAvatar key={auth.avatarUrl} name={auth.accountName} src={auth.avatarUrl} />
          : <span className="header-sign-in-icon" aria-hidden="true"><span /></span>}
        <span className="header-sign-in-label">{auth.signedIn ? accountName : text.signIn}</span>
      </button>
      {open && (auth.signedIn ? (
        <div className="header-sign-in-hint header-popup header-account-menu" id={id}>
          <p className="header-account-name">{accountName}</p>
          {auth.error && <p className="header-account-error" role="status">{hint}</p>}
          <div className="header-account-actions">
            {auth.manageAccount && <button type="button" className="header-sign-out" onClick={() => {
              closeAndFocus();
              auth.manageAccount?.open();
            }}>{auth.manageAccount.label}</button>}
            {auth.sessionId && <button type="button" className="header-sign-out" onClick={() => {
              closeAndFocus();
              setDialogSession(auth.sessionId);
            }}>{minecraftAccountTitle(language)}</button>}
            <button type="button" className="header-sign-out" onClick={onSignOut}>{text.signOut}</button>
          </div>
        </div>
      ) : (
        <p className="header-sign-in-hint header-popup" id={id} role="status">{hint}</p>
      ))}
      {auth.signedIn && auth.sessionId && auth.getToken && dialogSession === auth.sessionId && (
        <MinecraftAccountDialog key={auth.sessionId} getToken={auth.getToken} close={() => setDialogSession(undefined)} />
      )}
    </div>
  );
}
