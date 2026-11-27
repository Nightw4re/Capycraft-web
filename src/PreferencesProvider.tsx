import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultPreferences, dyeColors, isLanguage, preferencesStorageKey, readButtonColor, translations, type Preferences } from './preferences';
import './styles/theme.css';

type PreferenceContext = Preferences & {
  update: (patch: Partial<Preferences>) => void;
};

const preferenceContext = createContext<PreferenceContext | null>(null);

function readPreferences(storageKey: string, addressWindow: Window): Preferences {
  const urlLanguage = storageKey === preferencesStorageKey
    ? new URLSearchParams(addressWindow.location.search).get('lang')
    : null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    const language = isLanguage(urlLanguage) ? urlLanguage : saved?.language;
    return {
      language: isLanguage(language) ? language : defaultPreferences.language,
      buttonColor: readButtonColor(saved?.buttonColor),
      introAnimation: typeof saved?.introAnimation === 'boolean' ? saved.introAnimation : defaultPreferences.introAnimation,
      advancedItemTooltips: typeof saved?.advancedItemTooltips === 'boolean'
        ? saved.advancedItemTooltips : saved?.tooltipModes?.advanced === true,
      achievementView: saved?.achievementView === 'list' ? 'list' : defaultPreferences.achievementView,
      questView: saved?.questView === 'board' || saved?.questView === 'list' ? saved.questView : defaultPreferences.questView,
    };
  } catch {
    return isLanguage(urlLanguage) ? { ...defaultPreferences, language: urlLanguage } : defaultPreferences;
  }
}

export function PreferencesProvider({
  children, storageKey = preferencesStorageKey, languageOverride, addressWindow = window, includeLanguageInAddress = false,
}: {
  children: ReactNode;
  storageKey?: string;
  languageOverride?: Preferences['language'];
  addressWindow?: Window;
  includeLanguageInAddress?: boolean;
}) {
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey, addressWindow));
  const language = languageOverride ?? preferences.language;

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.style.setProperty('--dye-color', dyeColors[preferences.buttonColor]);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // The controls still work for this visit when browser storage is unavailable.
    }
  }, [preferences, language, storageKey]);

  function update(patch: Partial<Preferences>) {
    if (patch.language && storageKey === preferencesStorageKey && !languageOverride) {
      const url = new URL(addressWindow.location.href);
      if (includeLanguageInAddress || url.searchParams.has('lang')) {
        url.searchParams.set('lang', patch.language);
        addressWindow.history.replaceState(addressWindow.history.state, '', url);
      }
    }
    setPreferences(current => ({ ...current, ...patch }));
  }

  return (
    <preferenceContext.Provider value={{
      ...preferences,
      language,
      update,
    }}>
      {children}
    </preferenceContext.Provider>
  );
}

export function usePreferences() {
  const preferences = useContext(preferenceContext);
  if (!preferences) throw new Error('PreferencesProvider is required');
  return { ...preferences, text: translations[preferences.language] };
}
