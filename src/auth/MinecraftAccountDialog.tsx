import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Language } from '../preferences';
import { usePreferences } from '../PreferencesProvider';
import { ServerPicker } from '../scene/ServerPicker';
import { useServerDirectory } from '../ServerDirectoryProvider';
import { accountPath, linkCodePattern, type Account, type MinecraftLink } from './account.mts';
import '../items/items.css';
import './minecraft-account.css';

const copy = {
  en: {
    title: 'Minecraft accounts', close: 'Close', loading: 'Loading Minecraft accounts…', retry: 'Try again',
    loadUnavailable: 'Minecraft account links could not be loaded. Try again.',
    unavailable: 'Minecraft account linking is unavailable. Try again with the same code.',
    webcraftUnavailable: 'The Minecraft server may be offline or unreachable. Try again with the same code.',
    signIn: 'Your session ended. Sign in again to continue.',
    disabled: 'Account linking hasn’t been set up on any Minecraft server yet. The code field will appear once linking is enabled.',
    joinServer: 'Join the Minecraft server to get your link code.',
    server: 'Minecraft server', code: 'Minecraft link code', link: 'Link Minecraft account', linking: 'Linking…',
    instruction: 'Run /webcraft link in game and paste the private code here within five minutes.',
    invalid: 'Enter the 16-character code from Minecraft.',
    expired: 'This code is invalid or has expired. Run /webcraft link for a new code.',
    conflict: 'This Capycraft account is already linked on that server.',
    claimed: 'That Minecraft account is already linked to another Capycraft account on this server.',
    limited: (seconds: number) => `Too many attempts. Try again in ${seconds} s.`,
    linked: 'Minecraft account linked.',
  },
  cs: {
    title: 'Účty Minecraft', close: 'Zavřít', loading: 'Načítání účtů Minecraftu…', retry: 'Zkusit znovu',
    loadUnavailable: 'Propojení s Minecraftem se nepodařilo načíst. Zkuste to znovu.',
    unavailable: 'Propojení s Minecraftem je nedostupné. Zkuste to znovu se stejným kódem.',
    webcraftUnavailable: 'Server Minecraftu může být vypnutý nebo nedostupný. Zkuste to znovu se stejným kódem.',
    signIn: 'Platnost přihlášení skončila. Přihlaste se znovu.',
    disabled: 'Propojení účtů zatím není nastavené na žádném serveru Minecraftu. Pole pro kód se zobrazí po zapnutí párování.',
    joinServer: 'Pro získání kódu se připojte k serveru Minecraftu.',
    server: 'Server Minecraft', code: 'Propojovací kód z Minecraftu', link: 'Propojit účet Minecraft', linking: 'Propojuji…',
    instruction: 'Ve hře zadejte příkaz /webcraft link a do pěti minut sem vložte soukromý kód.',
    invalid: 'Zadejte šestnáctiznakový kód z Minecraftu.',
    expired: 'Kód je neplatný nebo vypršel. Nový kód získáte příkazem /webcraft link.',
    conflict: 'Tento účet Capycraft už je na daném serveru propojený.',
    claimed: 'Tento účet Minecraft je na daném serveru už propojený s jiným účtem Capycraft.',
    limited: (seconds: number) => `Příliš mnoho pokusů. Zkuste to znovu za ${seconds} s.`,
    linked: 'Účet Minecraft byl propojen.',
  },
};

export function minecraftAccountTitle(language: Language) {
  return language === 'cs' ? copy.cs.title : copy.en.title;
}

export function MinecraftAccountDialog({ close, getToken }: { close: () => void; getToken: () => Promise<string | null> }) {
  const { language } = usePreferences();
  const { servers } = useServerDirectory();
  const text = language === 'cs' ? copy.cs : copy.en;
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [account, setAccount] = useState<Account>();
  const [loadError, setLoadError] = useState<'signIn' | 'loadUnavailable'>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selected, setSelected] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Exclude<keyof typeof text, 'limited'> | number>();
  const available = account?.servers.filter(server => !account.links.some(link => link.server === server)) ?? [];
  const server = available.includes(selected) ? selected : available[0];

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const token = await getToken();
        if (!token) {
          if (!abort.signal.aborted) setLoadError('signIn');
          return;
        }
        const response = await fetch(accountPath, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: abort.signal,
        });
        if (response.status === 401) setLoadError('signIn');
        else if (response.ok) setAccount(await response.json());
        else setLoadError('loadUnavailable');
      } catch {
        if (!abort.signal.aborted) setLoadError('loadUnavailable');
      }
    }
    void load();
    return () => abort.abort();
  }, [getToken, loadAttempt]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!server || busy) return;
    const submission = code.trim();
    if (!linkCodePattern.test(submission)) {
      setMessage('invalid');
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const token = await getToken();
      if (!token) {
        setMessage('signIn');
        return;
      }
      const response = await fetch(accountPath, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, code: submission }),
      });
      if (response.ok) {
        const link: MinecraftLink = await response.json();
        setAccount(current => current && { ...current, links: [...current.links, link] });
        setCode('');
        setMessage('linked');
      } else if (response.status === 401) {
        setMessage('signIn');
      } else if (response.status === 429) {
        setMessage(Number(response.headers.get('Retry-After')) || 60);
      } else {
        const result = await response.json();
        switch (result.error) {
          case 'invalid_code': setMessage('expired'); break;
          case 'already_linked': setMessage('conflict'); break;
          case 'minecraft_account_in_use': setMessage('claimed'); break;
          case 'webcraft_unavailable': setMessage('webcraftUnavailable'); break;
          default: setMessage('unavailable');
        }
      }
    } catch {
      setMessage('unavailable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog className="minecraft-account" ref={dialog} aria-labelledby={titleId} onClose={close}>
      <header>
        <h2 id={titleId}>{text.title}</h2>
        <button className="item-action item-detail-close" type="button"
          onClick={() => dialog.current?.close()} aria-label={text.close}>×</button>
      </header>
      {!account && <p role="status">{loadError ? text[loadError] : text.loading}</p>}
      {loadError === 'loadUnavailable' && <button className="minecraft-account-action" type="button" onClick={() => {
        setLoadError(undefined);
        setLoadAttempt(attempt => attempt + 1);
      }}>{text.retry}</button>}
      {account?.links.length ? (
        <ul>
          {account.links.map(link => <li key={link.server}><strong>{link.name}</strong> · {link.server}</li>)}
        </ul>
      ) : null}
      {account && !account.servers.length && (
        <div role="status">
          <p>{text.disabled}</p>
          <p>{text.joinServer}</p>
        </div>
      )}
      {server && (
        <form onSubmit={redeem}>
          <p>{text.joinServer} {text.instruction}</p>
          <div className="minecraft-account-picker">
            <span>{text.server}</span>
            <ServerPicker label={text.server} value={server} disabled={busy}
              servers={available.map(alias => servers.find(entry => entry.alias === alias) ?? { alias, status: 'unavailable' })}
              onChange={alias => {
                if (alias === server) return;
                setSelected(alias);
                setCode('');
                setMessage(undefined);
              }} />
          </div>
          <label>
            {text.code}
            <input value={code} onChange={event => setCode(event.target.value)} disabled={busy} required
              autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={24} />
          </label>
          <button className="minecraft-account-action" type="submit" disabled={busy}>{busy ? text.linking : text.link}</button>
        </form>
      )}
      {message !== undefined && (
        <p role="status">{typeof message === 'number' ? text.limited(message) : text[message]}</p>
      )}
    </dialog>
  );
}
