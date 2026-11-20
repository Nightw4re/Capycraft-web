import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MicrosoftAuthProvider } from './auth/MicrosoftAuthProvider';
import { NotificationProvider } from './notifications/Notifications';
import { PreferencesProvider } from './PreferencesProvider';
import { ServerDirectoryProvider } from './ServerDirectoryProvider';
import './styles/fonts.css';

const root = document.documentElement;
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

window.addEventListener('pointerdown', () => {
  root.setAttribute('data-pointer-input', '');
}, { capture: true, passive: true });

window.addEventListener('keydown', event => {
  if (!modifierKeys.has(event.key)) root.removeAttribute('data-pointer-input');
}, { capture: true });

createRoot(document.getElementById('root')!).render(
  <PreferencesProvider>
    <MicrosoftAuthProvider clientId={import.meta.env.VITE_MICROSOFT_CLIENT_ID}>
      <NotificationProvider>
        <ServerDirectoryProvider><App /></ServerDirectoryProvider>
      </NotificationProvider>
    </MicrosoftAuthProvider>
  </PreferencesProvider>,
);
