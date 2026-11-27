import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { achievementsPath, readAchievementCatalog, type Advancement, type AchievementCatalog } from '../achievements.mts';
import { InfoPanel } from '../layout/InfoPanel';
import { usePreferences } from '../PreferencesProvider';
import { useProfileCatalog, type useProfileProgress } from './PlayerProgressPage';
import { ProgressBoard } from './ProgressBoard';
import { ProgressDialog } from './ProgressDialog';
import { useProgressItems } from './useProgressIcons';
import { useProgressLocation } from './useProgressLocation';
import './achievements.css';

const pageSize = 48;

const scrollLabels = {
  en: ['Previous categories', 'Next categories'],
  cs: ['Předchozí kategorie', 'Další kategorie'],
  de: ['Vorherige Kategorien', 'Weitere Kategorien'],
  es: ['Categorías anteriores', 'Categorías siguientes'],
  fr: ['Catégories précédentes', 'Catégories suivantes'],
  ja: ['前のカテゴリ', '次のカテゴリ'],
  uk: ['Попередні категорії', 'Наступні категорії'],
} as const;

type GroupOption = { id: string; title: string; icon: ReactNode };
const groupSides = ['top', 'left', 'right', 'bottom'] as const;
type GroupSide = typeof groupSides[number];

type Category = {
  title: string;
  entries: Advancement[];
  root?: Advancement;
};

function categoryOf(entry: Advancement) {
  if (entry.group) return entry.group;
  const [namespace, path] = entry.id.split(':');
  const folder = path.indexOf('/');
  return namespace === 'minecraft' && folder > 0 ? path.slice(0, folder) : namespace;
}

function AchievementIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="achievement-icon" aria-hidden="true">
    {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : '◇'}
  </span>;
}

function splitGroups(groups: GroupOption[]): Record<GroupSide, GroupOption[]> {
  // Minecraft fits eight tabs on a horizontal edge and five on a vertical edge.
  // Keep this ratio while retaining the catalog order for servers with more groups.
  const horizontal = Math.max(1, Math.round(groups.length * 8 / 26));
  const leftEnd = horizontal + Math.ceil(Math.max(0, groups.length - 2 * horizontal) / 2);
  const bottomStart = Math.max(leftEnd, groups.length - horizontal);
  return {
    top: groups.slice(0, horizontal),
    left: groups.slice(horizontal, leftEnd),
    right: groups.slice(leftEnd, bottomStart),
    bottom: groups.slice(bottomStart),
  };
}

function revealGroup(strip: HTMLDivElement, button: HTMLButtonElement, vertical: boolean) {
  const area = strip.getBoundingClientRect();
  const icon = button.getBoundingClientRect();
  const start = vertical ? icon.top - area.top : icon.left - area.left;
  const end = vertical ? icon.bottom - area.bottom : icon.right - area.right;
  const amount = Math.min(0, start) || Math.max(0, end);
  if (amount) strip.scrollBy(vertical ? { top: amount, behavior: 'instant' } : { left: amount, behavior: 'instant' });
}

function AchievementGroupStrip({ groups, selected, side = 'list', onSelect }: {
  groups: GroupOption[]; selected?: string; side?: GroupSide | 'list'; onSelect: (id: string) => void;
}) {
  const { language, text } = usePreferences();
  const id = useId();
  const rail = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const vertical = side === 'left' || side === 'right';
  const [scroll, setScroll] = useState({ overflow: false, previous: false, next: false });
  useLayoutEffect(() => {
    const root = rail.current;
    const list = strip.current;
    if (!root || !list) return;
    const measure = () => {
      const size = vertical ? list.scrollHeight : list.scrollWidth;
      const visible = vertical ? list.clientHeight : list.clientWidth;
      const offset = vertical ? list.scrollTop : list.scrollLeft;
      const overflow = size > (vertical ? root.clientHeight : root.clientWidth) + 1;
      const previous = offset > 1;
      const next = size - visible - offset > 1;
      setScroll(current => current.overflow === overflow && current.previous === previous && current.next === next
        ? current : { overflow, previous, next });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(list);
    list.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); list.removeEventListener('scroll', measure); };
  }, [groups.length, vertical]);
  useLayoutEffect(() => {
    const list = strip.current;
    const selection = list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (list && selection) revealGroup(list, selection, vertical);
  }, [selected, scroll.overflow, vertical]);
  function scrollGroups(direction: number) {
    const list = strip.current;
    if (!list) return;
    const size = vertical ? list.clientHeight : list.clientWidth;
    const first = list.firstElementChild?.getBoundingClientRect();
    const step = (vertical ? first?.height : first?.width) ?? 0;
    const amount = direction * Math.max(step, size - step);
    list.scrollBy(vertical ? { top: amount } : { left: amount });
  }
  function focusGroup(event: KeyboardEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    const buttons = Array.from(list.querySelectorAll('button'));
    const index = buttons.findIndex(button => button === event.target);
    const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const target = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1)
      : event.key === previous ? buttons[index - 1] : event.key === next ? buttons[index + 1] : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    revealGroup(list, target, vertical);
  }
  function arrow(direction: 'previous' | 'next') {
    return <button type="button" className="achievement-group-arrow" data-direction={direction}
      aria-label={scrollLabels[language][direction === 'previous' ? 0 : 1]} aria-controls={id}
      disabled={!scroll[direction]} onClick={() => scrollGroups(direction === 'previous' ? -1 : 1)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m9 5 7 7-7 7" />
      </svg>
    </button>;
  }
  return <div className="achievement-group-rail" data-side={side} role="group" aria-label={text.playerProgressGroup} ref={rail}>
    {scroll.overflow && arrow('previous')}
    <div className="achievement-groups" id={id} ref={strip} onKeyDown={focusGroup}>
      {groups.map(({ id, title, icon }) => <button type="button" key={id} aria-pressed={selected === id}
        aria-label={title} title={title} onClick={() => onSelect(id)}>{icon}</button>)}
    </div>
    {scroll.overflow && arrow('next')}
  </div>;
}

export function AchievementsPage({ server, progress: completion, url }: {
  server: string; progress: ReturnType<typeof useProfileProgress>; url: string;
}) {
  const progress = useProfileCatalog<AchievementCatalog>(achievementsPath, server, readAchievementCatalog);
  const { text, language, achievementView: defaultView, update } = usePreferences();
  const labels = text.achievement;
  const [limit, setLimit] = useState(pageSize);
  const [hovered, setHovered] = useState('');
  const [{ view: achievementView, group: selected, entry }, changeLocation] = useProgressLocation(url, 'achievement', defaultView);
  const tooltipId = useId();
  const selectedCard = useRef<HTMLLIElement>(null);
  const entries: Advancement[] = progress.status === 'ready' ? progress.data.advancements : [];
  const done = completion.status === 'ready' ? new Set(completion.data.completedIds) : undefined;
  const categories = new Map<string, Category>();
  for (const entry of entries) {
    const group = categoryOf(entry);
    let category = categories.get(group);
    if (!category) {
      category = { title: group, entries: [] };
      categories.set(group, category);
    }
    if (entry.groupTitle) category.title = entry.groupTitle;
    if (entry.id === group) category.root = entry;
    category.entries.push(entry);
  }
  const active = categories.get(selected);
  const shown = active?.entries ?? entries;
  const groups = [...categories].map(([id, category]) => ({ id, ...category }));
  const boardGroup = groups.find(group => group.id === selected)
    ?? groups.find(group => group.entries.some(advancement => advancement.id === entry))
    ?? groups.find(group => group.id === 'minecraft:story/root') ?? groups[0];
  const sorted = achievementView === 'list'
    ? [...shown].sort((a, b) => Number(!!done?.has(b.id)) - Number(!!done?.has(a.id))) : [];
  const shownCount = Math.max(limit, sorted.findIndex(advancement => advancement.id === entry) + 1);
  const ordered = sorted.slice(0, shownCount);
  const selectedAdvancement = (achievementView === 'board' ? boardGroup?.entries : shown)?.find(advancement => advancement.id === entry);
  const artwork = useProgressItems(server, [...ordered, ...groups.flatMap(group => group.root ? [group.root] : []),
    ...(selectedAdvancement ? [selectedAdvancement] : [])], true);
  const showingCard = ordered.some(advancement => advancement.id === entry);
  useLayoutEffect(() => {
    if (showingCard) selectedCard.current?.scrollIntoView({ block: 'nearest' });
  }, [entry, showingCard]);
  if (progress.status !== 'ready') {
    const message = progress.status === 'unknown' || progress.status === 'noProgress' ? text.playerNoServerData : labels[progress.status];
    return <InfoPanel><p role="status">{message}</p></InfoPanel>;
  }
  const completedAt = completion.status === 'ready' ? completion.data.completedAt : undefined;
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const iconFor = (entry?: Advancement) => {
    const src = entry && (artwork?.advancementIcons?.get(entry.id)
      ?? (entry.iconItemId ? artwork?.icons.get(entry.iconItemId) : undefined));
    return <AchievementIcon key={src} src={src} />;
  };
  const groupOptions = groups.map(group => ({ id: group.id, title: group.title, icon: iconFor(group.root) }));
  const boardGroups = splitGroups(groupOptions);
  function selectGroup(group: string) {
    if (group === (achievementView === 'board' ? boardGroup?.id : selected)) return;
    changeLocation({ group, entry: '' });
    setHovered('');
    setLimit(pageSize);
  }
  function changeView(view: 'board' | 'list') {
    changeLocation({ view });
    setHovered('');
    update({ achievementView: view });
  }
  function details(entry: Advancement) {
    const complete = done?.has(entry.id);
    const timestamp = completedAt?.[entry.id];
    return <>
      <div className="achievement-details">
        <span>{labels[entry.frame]}</span>
        {complete !== undefined && <span data-completed={complete}>{complete ? labels.completed : labels.incomplete}</span>}
      </div>
      {timestamp && <time dateTime={new Date(timestamp).toISOString()}>{date.format(timestamp)}</time>}
      {entry.description && <p>{entry.description}</p>}
    </>;
  }
  return <InfoPanel>
    {completion.status !== 'ready' && <p role="status">{completion.status === 'unknown' || completion.status === 'noProgress'
      ? text.playerNoServerData : labels[completion.status]}</p>}
    {entries.length === 0 ? <p>{labels.empty}</p> : <>
      <div className="achievement-toolbar">
        <div className="achievement-view" role="group" aria-label={labels.view}>
          {(['board', 'list'] as const).map(view =>
            <button key={view} type="button" aria-pressed={achievementView === view}
              onClick={() => changeView(view)}>{labels[view]}</button>)}
        </div>
        {achievementView === 'list' && <AchievementGroupStrip selected={active ? selected : ''} onSelect={selectGroup}
          groups={[{ id: '', title: text.playerProgressAllGroups, icon:
            <svg viewBox="0 0 24 24" className="achievement-icon" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z" />
            </svg> }, ...groupOptions]} />}
      </div>
      {achievementView === 'board' && boardGroup ?
        <ProgressBoard key={boardGroup.id} server={server} label={boardGroup.title}
          entries={boardGroup.entries.map(entry => ({
            ...entry, shape: entry.frame, iconImage: artwork?.advancementIcons?.get(entry.id),
          }))}
          completed={done} doneLabel={labels.completed} pendingLabel={labels.incomplete} tooltip={details} selectedId={entry}
          onSelect={id => changeLocation({ group: boardGroup.id, entry: id })}
          renderFrame={frame => <div className="achievement-board-layout">
            {groupSides.map(side => boardGroups[side].length > 0 &&
              <AchievementGroupStrip key={side} side={side} groups={boardGroups[side]} selected={boardGroup.id} onSelect={selectGroup} />)}
            {frame}
          </div>} />
      : <ul className="achievements-grid" role="list">
        {ordered.map(advancement => {
          const pinned = entry === advancement.id;
          const visible = !selectedAdvancement && hovered === advancement.id;
          return <li key={advancement.id} className="achievement-card achievement-list-entry"
            ref={pinned ? selectedCard : undefined} data-frame={advancement.frame}>
            <button type="button" className="progress-entry-title progress-entry-button"
              aria-haspopup="dialog" aria-describedby={visible ? tooltipId : undefined}
              onClick={() => changeLocation({ entry: advancement.id })}
              onFocus={() => setHovered(advancement.id)} onBlur={() => setHovered('')}
              onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(advancement.id); }}
              onPointerLeave={() => setHovered('')}>
              {iconFor(advancement)}{advancement.title || advancement.id}
              {done?.has(advancement.id) && <span aria-label={labels.completed} className="achievement-list-check">✓</span>}
            </button>
            {visible && <div className="progress-tooltip achievement-list-tooltip" role="tooltip" id={tooltipId}>
              {details(advancement)}
            </div>}
          </li>;
        })}
      </ul>}
      {achievementView === 'list' && shownCount < shown.length && <button className="achievements-more" type="button"
        onClick={() => setLimit(shownCount + pageSize)}>{labels.more}</button>}
      {selectedAdvancement && <ProgressDialog key={selectedAdvancement.id} kind="advancement"
        title={<>{iconFor(selectedAdvancement)}{selectedAdvancement.title || selectedAdvancement.id}</>}
        onClose={() => changeLocation({ entry: '' })}>
        {details(selectedAdvancement)}
      </ProgressDialog>}
    </>}
  </InfoPanel>;
}
