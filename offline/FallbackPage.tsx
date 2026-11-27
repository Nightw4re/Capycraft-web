import { useEffect, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import capybara from '../assets/capycraft-capybara-electric-transparent.webp';
import { recoverHomeEvent } from '../src/navigation';
import { PreferencesProvider, usePreferences } from '../src/PreferencesProvider';
import { HeaderAppearanceControls } from '../src/scene/HeaderAppearanceControls';
import { SceneEntranceLayout } from '../src/scene/SceneEntrance';
import { SceneHeaderFrame, SceneHeaderLogo } from '../src/scene/SceneHeader';
import '../src/styles/fonts.css';
import './fallback.css';

const messages = {
  en: {
    offline: ['Server offline', 'Capycraft is temporarily unavailable.'],
    error: ['Something went wrong', 'Capycraft ran into a problem. Please try again.'],
  },
  cs: {
    offline: ['Server je offline', 'Capycraft je dočasně nedostupný.'],
    error: ['Něco se rozbilo', 'Na Capycraftu nastala chyba. Zkus to prosím znovu.'],
  },
  ja: {
    offline: ['サーバーはオフラインです', '現在 Capycraft をご利用いただけません。'],
    error: ['問題が発生しました', 'Capycraft でエラーが発生しました。もう一度お試しください。'],
  },
  uk: {
    offline: ['Сервер офлайн', 'Capycraft тимчасово недоступний.'],
    error: ['Щось пішло не так', 'У Capycraft сталася помилка. Спробуй ще раз.'],
  },
  de: {
    offline: ['Server offline', 'Capycraft ist vorübergehend nicht verfügbar.'],
    error: ['Etwas ist schiefgelaufen', 'Bei Capycraft ist ein Fehler aufgetreten. Bitte versuche es erneut.'],
  },
  fr: {
    offline: ['Serveur hors ligne', 'Capycraft est temporairement indisponible.'],
    error: ['Un problème est survenu', 'Capycraft a rencontré une erreur. Réessaie.'],
  },
  es: {
    offline: ['Servidor desconectado', 'Capycraft no está disponible temporalmente.'],
    error: ['Algo ha fallado', 'Se ha producido un error en Capycraft. Vuelve a intentarlo.'],
  },
};

const mazeText = {
  en: {
    play: 'Play mine maze',
    title: 'Capybara Mine Maze',
    help: 'Swipe on the mine or use the arrow keys. Collect every diamond, dodge the minecarts, then head for the exit.',
    board: 'Mine maze game board',
    diamonds: 'Diamonds: {count}',
    exit: 'All diamonds collected. The exit is open!',
    hit: 'A minecart caught you. Restart to try again.',
    win: 'You escaped with every diamond!',
  },
  cs: {
    play: 'Hrát důlní bludiště',
    title: 'Důlní bludiště s kapybarou',
    help: 'Přejížděj prstem po herní ploše nebo použij šipky. Posbírej všechny diamanty, vyhni se vozíkům a dojdi k východu.',
    board: 'Herní plocha důlního bludiště',
    diamonds: 'Diamanty: {count}',
    exit: 'Všechny diamanty jsou posbírané. Východ je otevřený!',
    hit: 'Chytil tě důlní vozík. Zkus to znovu od začátku.',
    win: 'Unikl jsi se všemi diamanty!',
  },
  ja: {
    play: '鉱山迷路で遊ぶ',
    title: 'カピバラの鉱山迷路',
    help: '迷路をスワイプするか、矢印キーを使って移動します。トロッコを避けながらダイヤモンドを全部集め、出口を目指しましょう。',
    board: '鉱山迷路のゲーム盤',
    diamonds: 'ダイヤモンド：{count}',
    exit: 'すべてのダイヤモンドを集めました。出口が開きました！',
    hit: 'トロッコにつかまりました。最初からやり直しましょう。',
    win: 'すべてのダイヤモンドを持って脱出しました！',
  },
  uk: {
    play: 'Грати в шахтний лабіринт',
    title: 'Капібара в шахтному лабіринті',
    help: 'Проведіть пальцем по лабіринту або скористайтеся клавішами зі стрілками. Зберіть усі діаманти, оминайте вагонетки й дістаньтеся виходу.',
    board: 'Ігрове поле шахтного лабіринту',
    diamonds: 'Діаманти: {count}',
    exit: 'Усі діаманти зібрано. Вихід відкрито!',
    hit: 'Вас наздогнала вагонетка. Почніть спочатку, щоб спробувати ще раз.',
    win: 'Ви вибралися з усіма діамантами!',
  },
  de: {
    play: 'Minenlabyrinth spielen',
    title: 'Das Capybara im Minenlabyrinth',
    help: 'Wische über das Spielfeld oder nutze die Pfeiltasten. Sammle alle Diamanten, weiche den Loren aus und mach dich dann auf zum Ausgang.',
    board: 'Spielfeld des Minenlabyrinths',
    diamonds: 'Diamanten: {count}',
    exit: 'Alle Diamanten gesammelt. Der Ausgang ist offen!',
    hit: 'Eine Lore hat dich erwischt. Starte neu, um es noch einmal zu versuchen.',
    win: 'Du hast es mit allen Diamanten nach draußen geschafft!',
  },
  fr: {
    play: 'Jouer au labyrinthe de la mine',
    title: 'Le capybara dans le labyrinthe de la mine',
    help: 'Balayez l’écran sur le labyrinthe ou utilisez les touches fléchées. Ramassez tous les diamants, évitez les wagonnets, puis rejoignez la sortie.',
    board: 'Plateau du labyrinthe de la mine',
    diamonds: 'Diamants : {count}',
    exit: 'Tous les diamants sont ramassés. La sortie est ouverte !',
    hit: 'Un wagonnet vous a rattrapé. Recommencez pour réessayer.',
    win: 'Vous êtes sorti avec tous les diamants !',
  },
  es: {
    play: 'Jugar al laberinto de la mina',
    title: 'El capibara en el laberinto de la mina',
    help: 'Desliza el dedo sobre el laberinto o usa las teclas de flecha. Recoge todos los diamantes, esquiva las vagonetas y dirígete a la salida.',
    board: 'Tablero del laberinto de la mina',
    diamonds: 'Diamantes: {count}',
    exit: '¡Has recogido todos los diamantes! La salida está abierta.',
    hit: 'Te ha atrapado una vagoneta. Reinicia para volver a intentarlo.',
    win: '¡Has escapado con todos los diamantes!',
  },
};

function FallbackPage({ kind, addressWindow }: { kind: 'offline' | 'error'; addressWindow: Window }) {
  const { language, text } = usePreferences();
  const [heading, message] = messages[language][kind];
  const maze = mazeText[language];
  const animate = new URLSearchParams(window.location.search).get('intro') !== 'off';

  useEffect(() => {
    document.title = `${heading} | Capycraft`;
  }, [heading]);

  function recoverHome(event: MouseEvent<HTMLAnchorElement>) {
    if (kind !== 'error' || addressWindow === window || event.defaultPrevented ||
        event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!addressWindow.dispatchEvent(new Event(recoverHomeEvent, { cancelable: true }))) event.preventDefault();
  }

  return <>
    <SceneEntranceLayout animate={animate} renderHeader={ready => (
      <SceneHeaderFrame ready={ready} logo={<SceneHeaderLogo ready={ready}
        onClick={recoverHome}
        target={addressWindow === window ? undefined : '_parent'} />}>
        <div className="header-controls"><HeaderAppearanceControls /></div>
      </SceneHeaderFrame>
    )}>
      <main className="scene-content">
        <div className="scene-panels">
          <div className="fallback-panel">
            <img src={capybara} width={1312} height={1199} alt="" />
            <div>
              <h1>{heading}</h1>
              <p>{message}</p>
              <div className="fallback-actions">
                <button type="button" onClick={() => addressWindow.location.reload()}>{text.retry}</button>
                <button id="play-maze" type="button" hidden>{maze.play}</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </SceneEntranceLayout>
    <dialog id="mine-maze" aria-labelledby="maze-title" aria-describedby="maze-help">
      <h2 id="maze-title">{maze.title}</h2>
      <p id="maze-help">{maze.help}</p>
      <canvas id="maze-board" width="208" height="176" aria-label={maze.board} />
      <p id="maze-status" role="status"
        data-diamonds={maze.diamonds} data-exit={maze.exit} data-hit={maze.hit} data-win={maze.win} />
      <div className="fallback-actions">
        <button id="restart-maze" type="button">{text.ponderPlayer.restart}</button>
        <form method="dialog"><button>{text.close}</button></form>
      </div>
    </dialog>
  </>;
}

const root = document.querySelector<HTMLElement>('#fallback-root')!;
let addressWindow: Window = window;
try {
  if (window.parent.location.origin === window.location.origin) addressWindow = window.parent;
} catch {
  // A cross-origin frame uses its own address.
}

// The bundled maze binds to the rendered controls in the following script.
flushSync(() => {
  createRoot(root).render(
    <PreferencesProvider addressWindow={addressWindow} includeLanguageInAddress>
      <FallbackPage kind={root.dataset.kind === 'error' ? 'error' : 'offline'} addressWindow={addressWindow} />
    </PreferencesProvider>,
  );
});
