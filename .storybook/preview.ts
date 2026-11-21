import { createElement } from 'react';
import type { Preview } from '@storybook/react-vite';
import { PreferencesProvider } from '../src/PreferencesProvider';
import { MicrosoftAuthProvider } from '../src/auth/MicrosoftAuthProvider';
import { NotificationProvider } from '../src/notifications/Notifications';
import { defaultPreferences, isLanguage, languageOptions } from '../src/preferences';
import '../src/styles/fonts.css';

const preview: Preview = {
  globalTypes: {
    language: {
      description: 'Language used by the story preview',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: languageOptions.map(({ value, label }) => ({ value, title: label })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { language: defaultPreferences.language },
  decorators: [(Story, { globals }) => createElement(PreferencesProvider, {
    storageKey: 'capycraft.storybook.preferences',
    languageOverride: isLanguage(globals.language) ? globals.language : defaultPreferences.language,
    children: createElement(MicrosoftAuthProvider, {
      children: createElement(NotificationProvider, { children: Story() }),
    }),
  })],
  parameters: {
    layout: 'fullscreen',
  },
};

export default preview;
