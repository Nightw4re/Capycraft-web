import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultPreferences, dyeColors, readButtonColor, translations, type Preferences } from './preferences';
import './styles/theme.css';

const storageKey = 'capycraft.preferences';

type PreferenceContext = Preferences & {
  update: (patch: Partial<Preferences>) => void;
};

const preferenceContext = createContext<PreferenceContext | null>(null);

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    const language = saved?.language;
    return {
      language: language === 'cs' || language === 'en' ? language : defaultPreferences.language,
      buttonColor: readButtonColor(saved?.buttonColor),
      introAnimation: typeof saved?.introAnimation === 'boolean' ? saved.introAnimation : defaultPreferences.introAnimation,
    };
  } catch {
    return defaultPreferences;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);

  useEffect(() => {
    document.documentElement.lang = preferences.language;
    document.documentElement.style.setProperty('--dye-color', dyeColors[preferences.buttonColor]);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // The controls still work for this visit when browser storage is unavailable.
    }
  }, [preferences]);

  return (
    <preferenceContext.Provider value={{
      ...preferences,
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
