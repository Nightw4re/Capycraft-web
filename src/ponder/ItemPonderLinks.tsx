import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { plainMinecraftText } from '../layout/minecraftMotd';
import { usePreferences } from '../PreferencesProvider';
import { useSceneContentReady } from '../scene/SceneEntrance';
import { animatePanelArrival } from '../scene/pageMotion';
import { readPonderIndex } from './format.mts';
import { indexItemPonderChoices, type PonderChoice } from './guides.mts';
import { itemPonderLocation, readItemPonderLocation, selectItemPonderScene, type ItemPonderLocation } from './itemPonderLocation.mts';
import { PonderPlayer } from './PonderPlayer';
import { readPonderGuides, readPonderResponse } from './source';
import './ponder.css';

type ItemScenes = { server: string; revision?: string; scenes: readonly PonderChoice[] };
type OpenPonder = (anchor: HTMLElement, title?: string) => void;
const itemPonderContext = createContext<((itemId: string) => OpenPonder | undefined) | undefined>(undefined);

export function ItemPonderLinks({ server, location, catalogVersion, importRevision, children }: {
  server?: string; location: string; catalogVersion?: string; importRevision?: string; children: ReactNode;
}) {
  const sceneReady = useSceneContentReady();
  const [catalog, setCatalog] = useState<{ server: string; revision?: string; items: ReturnType<typeof indexItemPonderChoices> }>();
  const opener = useRef<{ itemId: string; anchor: HTMLElement; title?: string }>(undefined);
  const selection = readItemPonderLocation(location);
  const scenes = selection && catalog?.server === server ? catalog?.items.get(selection.itemId) : undefined;
  const trigger = opener.current?.itemId === selection?.itemId ? opener.current : undefined;
  useEffect(() => {
    if (!server) return;
    const request = new AbortController();
    const playback = readPonderResponse(server, request.signal).then(async response => {
      const revision = response.headers.get('X-Ponder-Revision');
      const index = revision && /^[a-f0-9]{64}$/.test(revision) && readPonderIndex(await response.json());
      return index && revision ? { revision, scenes: index.scenes } : undefined;
    });
    void Promise.allSettled([playback, readPonderGuides(server, request.signal)]).then(([rendered, textGuides]) => {
      if (request.signal.aborted) return;
      const frames = rendered.status === 'fulfilled' ? rendered.value : undefined;
      const guides = textGuides.status === 'fulfilled' ? textGuides.value : undefined;
      setCatalog({ server, revision: frames?.revision, items: indexItemPonderChoices(frames?.scenes ?? [], guides ?? []) });
    });
    return () => request.abort();
  }, [server, catalogVersion, importRevision]);

  function changeAddress(next: string, open = false) {
    if (next === location) return;
    if (open) window.history.pushState({ ...window.history.state, openedItemPonder: true }, '', next);
    else window.history.replaceState(window.history.state, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function ponderForItem(itemId: string): OpenPonder | undefined {
    if (!sceneReady || scenes?.length || !server || catalog?.server !== server) return;
    if (catalog.items.get(itemId)?.length) return (anchor, title) => {
      opener.current = { itemId, anchor, title };
      changeAddress(itemPonderLocation(location, { itemId }), true);
    };
  }

  return <itemPonderContext.Provider value={ponderForItem}>
    {children}
    {sceneReady && server && catalog && selection && !!scenes?.length && <ItemPonderDialog key={server + '/' + selection.itemId}
      server={server} revision={catalog.revision} scenes={scenes} anchor={trigger?.anchor} title={trigger?.title}
      selection={selection}
      onSelect={scene => changeAddress(itemPonderLocation(location,
        { itemId: selection.itemId, sceneId: scene.id, schematic: scene.schematic }))}
      onClose={() => {
        if (window.history.state?.openedItemPonder) window.history.back();
        else changeAddress(itemPonderLocation(location));
      }} />}
  </itemPonderContext.Provider>;
}

export function useItemPonder(itemId?: string) {
  const ponderForItem = useContext(itemPonderContext);
  return itemId ? ponderForItem?.(itemId) : undefined;
}

function ItemPonderDialog({ anchor, title, scenes, server, revision, selection, onSelect, onClose }: ItemScenes & {
  anchor?: HTMLElement; title?: string; selection: ItemPonderLocation; onSelect: (scene: PonderChoice) => void; onClose: () => void;
}) {
  const { text } = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const scene = selectItemPonderScene(scenes, selection);
  const [arrived, setArrived] = useState(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const arrival = animatePanelArrival(element);
    let active = true;
    setArrived(!arrival);
    function finishArrival() {
      if (active) setArrived(true);
    }
    void arrival?.finished.then(finishArrival, finishArrival);
    return () => {
      active = false;
      arrival?.cancel();
      element.close();
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  if (!scene) return null;

  return <dialog className="ponder-item-dialog" ref={dialog} aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="ponder-item-dialog-header">
      <div>
        <h2 id={headingId}>{text.ponder}{title && ' · ' + plainMinecraftText(title)}</h2>
        {scenes.length === 1 && <p>{scene.title || scene.id}</p>}
      </div>
      <button type="button" className="item-action" onClick={onClose} aria-label={text.close}>×</button>
    </div>
    <div className="ponder-item-dialog-body">
      {scenes.length > 1 && <div className="ponder-pickers">
        <label>{text.ponderPlayer.scene}
          <select value={scenes.indexOf(scene)} onChange={event => {
            const entry = scenes[event.currentTarget.selectedIndex];
            if (entry) onSelect(entry);
          }}>
            {scenes.map((entry, index) => <option key={JSON.stringify([entry.id, entry.schematic])} value={index}>
              {entry.title || entry.id}
            </option>)}
          </select>
        </label>
      </div>}
      {'steps' in scene ? <section className="ponder-guide" aria-label={text.ponderPlayer.textGuide}>
        <h3>{text.ponderPlayer.textGuide}</h3>
        <ol>{scene.steps.map((step, index) => <li key={index}>{plainMinecraftText(step)}</li>)}</ol>
      </section> : revision && <PonderPlayer key={scene.manifest} server={server} scene={scene} revision={revision} autoplayReady={arrived} />}
    </div>
  </dialog>;
}
