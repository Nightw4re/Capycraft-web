import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type AuthStatus = 'unconfigured' | 'initializing' | 'unavailable' | 'ready';
type AuthError = 'cancelled' | 'signInFailed' | 'signOutFailed';

type MicrosoftAuth = {
  status: AuthStatus;
  signedIn: boolean;
  accountName: string | undefined;
  busy: boolean;
  error: AuthError | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
};

const microsoftAuthContext = createContext<MicrosoftAuth | null>(null);
const applicationId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function createMicrosoftClient(clientId: string) {
  const { BrowserCacheLocation, createStandardPublicClientApplication } = await import('@azure/msal-browser');
  return createStandardPublicClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/consumers',
      redirectUri: new URL('/auth-redirect.html', window.location.origin).href,
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
  });
}

function signInError(error: unknown): AuthError {
  return typeof error === 'object' && error !== null && 'errorCode' in error && error.errorCode === 'user_cancelled'
    ? 'cancelled' : 'signInFailed';
}

export function MicrosoftAuthProvider({ clientId = '', children }: { clientId?: string; children: ReactNode }) {
  const id = clientId.trim();
  const canInitialize = applicationId.test(id) && window.isSecureContext;
  const [client, setClient] = useState<IPublicClientApplication | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const inProgress = useRef(false);

  useEffect(() => {
    if (!canInitialize) return;
    let disposed = false;

    void createMicrosoftClient(id).then(async instance => {
      const result = await instance.handleRedirectPromise().catch(cause => {
        if (!disposed) setError(signInError(cause));
        return null;
      });
      if (disposed) return;
      const accounts = instance.getAllAccounts();
      const active = result?.account ?? instance.getActiveAccount() ?? (accounts.length === 1 ? accounts[0] : null);
      instance.setActiveAccount(active);
      setAccount(active);
      setClient(instance);
    }).catch(() => {
      if (!disposed) setInitializationFailed(true);
    });

    return () => { disposed = true; };
  }, [canInitialize, id]);

  async function signIn() {
    if (!client || inProgress.current) return false;
    inProgress.current = true;
    setBusy(true);
    setError(null);

    try {
      await client.loginRedirect({ scopes: ['openid', 'profile'], prompt: 'select_account' });
      return true;
    } catch (cause) {
      setError(signInError(cause));
      return false;
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  async function signOut() {
    if (!client || inProgress.current) return false;
    inProgress.current = true;
    setBusy(true);
    setError(null);

    try {
      await client.clearCache();
      client.setActiveAccount(null);
      setAccount(null);
      return true;
    } catch {
      setError('signOutFailed');
      return false;
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  let status: AuthStatus = 'initializing';
  if (!id) status = 'unconfigured';
  else if (!canInitialize || initializationFailed) status = 'unavailable';
  else if (client) status = 'ready';

  return (
    <microsoftAuthContext.Provider value={{ status, signedIn: Boolean(account), accountName: account?.name,
      busy, error, signIn, signOut }}>
      {children}
    </microsoftAuthContext.Provider>
  );
}

export function useMicrosoftAuth() {
  const auth = useContext(microsoftAuthContext);
  if (!auth) throw new Error('MicrosoftAuthProvider is required');
  return auth;
}
