import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { equipmentPreviewPath } from './equipment/contract.mts';
import { AccountAuthProvider } from './auth/AccountAuthProvider';
import { NotificationProvider } from './notifications/Notifications';
import { homePath, navigatePage, recoverHomeEvent } from './navigation';
import { PreferencesProvider } from './PreferencesProvider';
import { ServerDirectoryProvider } from './ServerDirectoryProvider';
import './styles/fonts.css';

const root = document.documentElement;
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);
let navigatedWithinPage = false;
window.addEventListener('popstate', () => { navigatedWithinPage = true; });
if (import.meta.env.DEV && window.location.pathname === equipmentPreviewPath) {
  window.history.replaceState(window.history.state, '', '/');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch(error => {
      console.warn('Capycraft could not prepare the offline page.', error);
    });
  }, { once: true });
}

window.addEventListener('pointerdown', () => {
  root.setAttribute('data-pointer-input', '');
}, { capture: true, passive: true });

window.addEventListener('keydown', event => {
  if (!modifierKeys.has(event.key)) root.removeAttribute('data-pointer-input');
}, { capture: true });

class AppErrorBoundary extends Component<{ children: (recovered: boolean) => ReactNode }> {
  state = { failed: false, recovered: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidMount() {
    window.addEventListener(recoverHomeEvent, this.recoverHome);
  }

  componentWillUnmount() {
    window.removeEventListener(recoverHomeEvent, this.recoverHome);
  }

  private recoverHome = (event: Event) => {
    if (!this.state.failed) return;
    event.preventDefault();
    const params = new URLSearchParams(window.location.search);
    const language = params.get('lang');
    navigatePage(language ? `${homePath}?${new URLSearchParams({ lang: language })}` : homePath);
    this.setState({ failed: false, recovered: true });
  };

  render() {
    if (this.state.failed) {
      return <iframe
        src={navigatedWithinPage ? '/error.html?intro=off' : '/error.html'}
        title="Something went wrong"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }}
      />;
    }
    return this.props.children(this.state.recovered);
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    {recovered => (
      <PreferencesProvider>
        <AccountAuthProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
          <NotificationProvider>
            <ServerDirectoryProvider><App animate={!recovered} /></ServerDirectoryProvider>
          </NotificationProvider>
        </AccountAuthProvider>
      </PreferencesProvider>
    )}
  </AppErrorBoundary>,
);
