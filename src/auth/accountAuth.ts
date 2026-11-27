import { createContext, useContext } from 'react';

export type AccountAuth = {
  status: 'unconfigured' | 'initializing' | 'ready';
  signedIn: boolean;
  accountName?: string;
  avatarUrl?: string;
  sessionId?: string;
  getToken?: () => Promise<string | null>;
  manageAccount?: { label: string; open: () => void };
  busy: boolean;
  error: 'signInFailed' | 'signOutFailed' | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
};

const unavailable = async () => false;
export const accountAuthContext = createContext<AccountAuth>({
  status: 'unconfigured', signedIn: false, busy: false, error: null,
  signIn: unavailable, signOut: unavailable,
});

export const useAccountAuth = () => useContext(accountAuthContext);
