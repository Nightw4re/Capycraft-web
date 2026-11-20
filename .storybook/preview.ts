import { createElement } from 'react';
import type { Preview } from '@storybook/react-vite';
import { PreferencesProvider } from '../src/PreferencesProvider';
import { MicrosoftAuthProvider } from '../src/auth/MicrosoftAuthProvider';
import { NotificationProvider } from '../src/notifications/Notifications';
import '../src/styles/fonts.css';

const preview: Preview = {
  decorators: [(Story) => createElement(PreferencesProvider, {
    children: createElement(MicrosoftAuthProvider, {
      children: createElement(NotificationProvider, { children: Story() }),
    }),
  })],
  parameters: {
    layout: 'fullscreen',
  },
};

export default preview;
