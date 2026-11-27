import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';
import { csCZ, deDE, enUS, esES, frFR, jaJP, ukUA } from '@clerk/localizations';
import { usePreferences } from '../PreferencesProvider';
import { useState, type ReactNode } from 'react';
import { accountAuthContext, type AccountAuth } from './accountAuth';

const localizations = { cs: csCZ, de: deDE, en: enUS, es: esES, fr: frFR, ja: jaJP, uk: ukUA };
const appearance = {
  variables: {
    borderRadius: '0px',
    fontFamily: 'var(--font-body)',
    fontSize: 'clamp(0.875rem, 2vw, 1rem)',
    fontWeight: { medium: 600 },
    colorBackground: '#000',
    colorForeground: '#fff',
    colorMutedForeground: 'var(--muted-text-color)',
    colorPrimary: 'var(--panel-accent)',
    colorPrimaryForeground: '#000',
  },
};

export function AccountAuthProvider({ publishableKey, children }: { publishableKey?: string; children: ReactNode }) {
  const key = publishableKey?.trim();
  return key ? <ConfiguredClerk publishableKey={key}>{children}</ConfiguredClerk> : children;
}

function ConfiguredClerk({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  const { language } = usePreferences();
  return (
    <ClerkProvider publishableKey={publishableKey} localization={localizations[language]} appearance={appearance}>
      <ClerkAccount>{children}</ClerkAccount>
    </ClerkProvider>
  );
}

function ClerkAccount({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const { sessionId, getToken } = useAuth();
  const { language } = usePreferences();
  const { isLoaded, isSignedIn, user } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountAuth['error']>(null);
  const discord = user?.externalAccounts.find(account => account.provider === 'discord');
  return <accountAuthContext.Provider value={{
    status: isLoaded ? 'ready' : 'initializing',
    signedIn: isSignedIn === true,
    sessionId: sessionId ?? undefined,
    getToken,
    manageAccount: {
      label: localizations[language].userButton?.action__manageAccount ?? 'Manage account',
      open: () => clerk.openUserProfile(),
    },
    accountName: user?.fullName || user?.username || discord?.username || undefined,
    avatarUrl: discord?.imageUrl || (user?.hasImage ? user.imageUrl : undefined),
    busy,
    error,
    async signIn() {
      setError(null);
      try {
        clerk.openSignIn();
        return true;
      } catch {
        setError('signInFailed');
        return false;
      }
    },
    async signOut() {
      setError(null);
      setBusy(true);
      try {
        await clerk.signOut();
        return true;
      } catch {
        setError('signOutFailed');
        return false;
      } finally {
        setBusy(false);
      }
    },
  }}>{children}</accountAuthContext.Provider>;
}
