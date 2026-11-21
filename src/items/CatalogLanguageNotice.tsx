import { useEffect, useState } from 'react';
import { usePreferences } from '../PreferencesProvider';
import '../notifications/notifications.css';

const preferenceKey = 'capycraft.hideCatalogLanguageNotice';

function readPreference() {
  try {
    return window.localStorage.getItem(preferenceKey) === 'true';
  } catch {
    return false;
  }
}

export function CatalogLanguageNotice({ active }: { active: boolean }) {
  const { text } = usePreferences();
  const [status, setStatus] = useState<'unseen' | 'shown' | 'closed'>(() => readPreference() ? 'closed' : 'unseen');
  const [hiddenOnReload, setHiddenOnReload] = useState(false);

  useEffect(() => {
    if (active && status === 'unseen') setStatus('shown');
    if (!active && status === 'shown') setStatus('closed');
  }, [active, status]);

  if (!active || status === 'closed') return null;
  return <div className="notification-region catalog-language-notice">
    <div className="catalog-language-message">
      <p role="status">{text.itemCatalogLanguage}</p>
      <button type="button" aria-label={text.close} onClick={() => setStatus('closed')}>×</button>
      <label>
        <input type="checkbox" checked={hiddenOnReload} onChange={event => {
          const checked = event.target.checked;
          setHiddenOnReload(checked);
          try {
            if (checked) window.localStorage.setItem(preferenceKey, 'true');
            else window.localStorage.removeItem(preferenceKey);
          } catch {
            // The notice can still be closed for the current visit.
          }
        }} />
        {text.itemCatalogLanguageHide}
      </label>
    </div>
  </div>;
}
