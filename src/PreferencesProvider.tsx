import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultPreferences, dyeColors, isLanguage, readButtonColor, translations, type Preferences } from './preferences';
import './styles/theme.css';

const defaultStorageKey = 'capycraft.preferences';

type PreferenceContext = Preferences & {
  update: (patch: Partial<Preferences>) => void;
};

const preferenceContext = createContext<PreferenceContext | null>(null);

function readPreferences(storageKey: string): Preferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    const language = saved?.language;
    const savedModes = saved?.tooltipModes;
    let tooltipModes = defaultPreferences.tooltipModes;
    if (savedModes?.advanced === true) {
      tooltipModes = { advanced: true };
    } else if (savedModes?.advanced === false && typeof savedModes.shortcut === 'string' && savedModes.shortcut) {
      tooltipModes = { advanced: false, shortcut: savedModes.shortcut };
    }

    return {
      language: isLanguage(language) ? language : defaultPreferences.language,
      buttonColor: readButtonColor(saved?.buttonColor),
      introAnimation: typeof saved?.introAnimation === 'boolean' ? saved.introAnimation : defaultPreferences.introAnimation,
      tooltipModes,
    };
  } catch {
    return defaultPreferences;
  }
}

export function PreferencesProvider({
  children, storageKey = defaultStorageKey, languageOverride,
}: { children: ReactNode; storageKey?: string; languageOverride?: Preferences['language'] }) {
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
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

  return (
    <preferenceContext.Provider value={{
      ...preferences,
      language,
      update: patch => setPreferences(current => ({ ...current, ...patch })),
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
