import { useId, useRef, useState } from 'react';
import type { CatalogItem } from '../items/catalogData';
import { ItemIcon, ItemLink, type TooltipTarget } from '../items/ItemCatalog';
import { ItemTooltip, ItemTooltipPopover } from '../items/ItemTooltip';
import { InfoPanel } from '../layout/InfoPanel';
import type { ItemRecipeView } from '../navigation';
import { questsPath, readQuestCatalog, type Quest, type QuestCatalog, type QuestChapter, type QuestDetailEntry } from '../quests.mts';
import { usePreferences } from '../PreferencesProvider';
import { useProfileCatalog, type useProfileProgress } from './PlayerProgressPage';
import { ProgressBoard } from './ProgressBoard';
import { ProgressDialog } from './ProgressDialog';
import { useProgressIcons, useProgressItems } from './useProgressIcons';
import { useProgressLocation } from './useProgressLocation';
import './quests.css';

const detailLabels = {
  en: { prerequisites: 'Prerequisites', hidden: 'Hidden prerequisites', tasks: 'Required tasks', rewards: 'Rewards', item: 'Item could not be identified' },
  cs: { prerequisites: 'Podmínky', hidden: 'Skryté podmínky', tasks: 'Požadované úkoly', rewards: 'Odměny', item: 'Předmět se nepodařilo určit' },
  de: { prerequisites: 'Voraussetzungen', hidden: 'Verborgene Voraussetzungen', tasks: 'Erforderliche Aufgaben', rewards: 'Belohnungen', item: 'Gegenstand nicht identifiziert' },
  fr: { prerequisites: 'Prérequis', hidden: 'Prérequis masqués', tasks: 'Tâches requises', rewards: 'Récompenses', item: 'Objet non identifié' },
  es: { prerequisites: 'Requisitos', hidden: 'Requisitos ocultos', tasks: 'Tareas obligatorias', rewards: 'Recompensas', item: 'Objeto sin identificar' },
  ja: { prerequisites: '前提条件', hidden: '非表示の前提条件', tasks: '必須タスク', rewards: '報酬', item: 'アイテムを特定できません' },
  uk: { prerequisites: 'Передумови', hidden: 'Приховані передумови', tasks: 'Обов’язкові завдання', rewards: 'Винагороди', item: 'Предмет не вдалося визначити' },
} as const;

const pageSize = 48;

type QuestIconData = { iconItemId?: string; iconImage?: string };

export type QuestItemNavigation = {
  itemHref: (id: string, view?: ItemRecipeView) => string;
  onOpenItem: (id: string, view?: ItemRecipeView) => void;
  itemOpen: boolean;
};

function QuestIcon({ entry, icons, fallback }: {
  entry?: QuestIconData; icons?: ReadonlyMap<string, string>; fallback?: string;
}) {
  const src = entry?.iconImage ?? (entry?.iconItemId && icons?.get(entry.iconItemId));
  if (!src && !fallback) return null;
  return <span className="quest-icon" aria-hidden="true">{src ? <img key={src} src={src} alt="" loading="lazy"
    onLoad={entry?.iconImage ? ({ currentTarget: image }) => {
      const { naturalWidth, naturalHeight } = image;
      // Minecraft can export a vertical strip of square animation frames as one PNG.
      if (naturalWidth && naturalHeight >= naturalWidth * 4 && naturalHeight % naturalWidth === 0) {
        image.dataset.frameStrip = '';
      }
    } : undefined} /> : fallback}</span>;
}

function QuestChapters({ chapters, limit, onOpen }: {
  chapters: readonly QuestChapter[]; limit: number; onOpen: (id: string) => void;
}) {
  const { text } = usePreferences();
  const labels = text.quest;
  let remaining = limit;
  const shown = chapters.flatMap(chapter => {
    if (!remaining) return [];
    const quests = chapter.quests.slice(0, remaining);
    remaining -= quests.length;
    return [{ ...chapter, quests }];
  });
  return <div className="quests-chapters">
    {shown.map(chapter => (
      <section key={chapter.id} className="quests-chapter" aria-labelledby={`quest-chapter-${chapter.id}`}>
        <h2 id={`quest-chapter-${chapter.id}`}>{chapter.title || labels.chapter}</h2>
        <ul className="quest-title-list" role="list">
          {chapter.quests.map(quest => <li key={quest.id}>
            <button type="button" className="quest-entry-button" aria-haspopup="dialog" onClick={() => onOpen(quest.id)}>
              {quest.title || labels.untitled}
            </button>
          </li>)}
        </ul>
      </section>
    ))}
  </div>;
}

function ChapterPicker({ chapters, selected, allowAll, onSelect, server }: {
  chapters: readonly QuestChapter[]; selected: string; allowAll: boolean;
  onSelect: (id: string) => void; server: string;
}) {
  const { text } = usePreferences();
  const labels = text.quest;
  const [expanded, setExpanded] = useState<Map<string, boolean>>(() => new Map());
  const labelId = useId();
  const chaptersWithIcons = chapters.map(chapter => {
    const example = chapter.quests.find(quest => quest.iconItemId || quest.iconImage);
    const icon = chapter.iconItemId || chapter.iconImage ? chapter : example;
    return { chapter, icon };
  });
  const groups = new Map<string, { info?: QuestDetailEntry; chapters: typeof chaptersWithIcons }>();
  for (const row of chaptersWithIcons) {
    const id = row.chapter.group?.id ?? '';
    const group = groups.get(id);
    if (group) group.chapters.push(row);
    else groups.set(id, { info: row.chapter.group, chapters: [row] });
  }
  const icons = useProgressIcons(server, [
    ...chaptersWithIcons.flatMap(({ icon }) => icon ? [icon] : []),
    ...[...groups.values()].flatMap(group => group.info ? [group.info] : []),
  ]);
  return <aside className="quest-chapter-picker" aria-labelledby={labelId}>
    <h2 id={labelId}>{labels.chapter}</h2>
    {allowAll && <button type="button" aria-pressed={!selected} onClick={() => onSelect('')}>{text.playerProgressAllGroups}</button>}
    {[...groups].map(([id, group]) => {
      const open = !group.info || (expanded.get(id) ?? group.chapters.some(row => row.chapter.id === selected));
      const title = group.info?.title || text.playerProgressGroup;
      const groupId = `${labelId}-group-${id}`;
      return <div key={id} className="quest-chapter-group">
        {group.info && <button type="button" className="quest-group-toggle" aria-expanded={open}
          aria-controls={groupId} onClick={() => setExpanded(current => new Map(current).set(id, !open))}>
          <QuestIcon entry={group.info.iconItemId || group.info.iconImage ? group.info : group.chapters[0]?.icon}
            icons={icons} fallback="▤" />
          <span>{title}</span>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>}
        <ul id={groupId} hidden={!open}>
          {group.chapters.map(({ chapter, icon }) => <li key={chapter.id}>
            <button type="button" aria-pressed={chapter.id === selected} onClick={() => onSelect(chapter.id)}>
              <QuestIcon entry={icon} icons={icons} fallback="▤" />
              <span>{chapter.title || labels.chapter}</span>
            </button>
          </li>)}
        </ul>
      </div>;
    })}
  </aside>;
}

function QuestDialog({ quest, server, completed, completedAt, byId, onClose, onPrerequisite, itemNavigation, legacyItems }: {
  quest: Quest; server: string; completed?: ReadonlySet<string>; completedAt?: number;
  byId: ReadonlyMap<string, QuestDetailEntry>; onClose: () => void;
  onPrerequisite: (id: string) => void;
  itemNavigation: QuestItemNavigation; legacyItems: boolean;
}) {
  const { text, language } = usePreferences();
  const labels = text.quest;
  const labelsForDetails = detailLabels[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState<{ target: TooltipTarget; label: string; item?: CatalogItem }>();
  const prerequisites = quest.dependencyIds?.flatMap(id => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  }) ?? [];
  const previews = useProgressItems(server, [quest, ...(quest.tasks ?? []), ...(quest.rewards ?? []), ...prerequisites]);
  const icons = previews?.icons;
  const number = new Intl.NumberFormat(language);
  const hiddenPrerequisites = quest.hiddenDependencyCount ?? 0;
  const prerequisiteCount = prerequisites.length + hiddenPrerequisites;
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium' });
  function hideTooltip(anchor?: HTMLElement) {
    setHovered(current => !anchor || current?.target.anchor === anchor ? undefined : current);
  }
  function openItem(id: string, view?: ItemRecipeView) {
    const active = hovered?.target.anchor ?? document.activeElement;
    if (active instanceof HTMLElement && dialog.current?.contains(active)) restoreFocus.current = active;
    itemNavigation.onOpenItem(id, view);
  }
  function detailList(title: string, items: readonly QuestDetailEntry[] | undefined) {
    if (!items?.length) return null;
    return <section>
      <h3>{title}</h3>
      <ul className="quest-detail-items">{items.map(item => {
        const targetId = item.itemId ?? (legacyItems && !item.itemEntry ? item.iconItemId : undefined);
        const slot = targetId !== undefined || item.itemEntry;
        const quantity = item.count === undefined ? undefined : `×${number.format(item.count)}${item.countMax === undefined
          ? '' : `–${number.format(item.countMax)}`}`;
        if (!slot) return <li key={item.id}>
          <QuestIcon entry={item} icons={icons} />
          <span>{item.title || labels.untitled}</span>
          {quantity && <span className="quest-detail-quantity">{quantity}</span>}
        </li>;
        const target: CatalogItem | undefined = targetId
          ? previews?.items?.get(targetId) ?? { id: targetId, name: item.title || targetId } : undefined;
        const label = item.title && !/^(item|quest item)$/i.test(item.title)
          ? item.title : target?.name || labelsForDetails.item;
        const caption = quantity ? `${label}, ${quantity}` : label;
        const artworkId = item.iconItemId ?? targetId;
        const artwork = artworkId ? previews?.items?.get(artworkId) : undefined;
        const sprite = artwork?.sprite ?? (target ? target.sprite : undefined);
        const src = item.iconImage ?? (!sprite && artworkId ? icons?.get(artworkId) : undefined)
          ?? (!sprite && targetId ? icons?.get(targetId) : undefined);
        const hasArtwork = !!(src || sprite);
        if (!hasArtwork && !target) return <li key={item.id}>
          <span>{label}</span>{quantity && <span className="quest-detail-quantity">{quantity}</span>}
        </li>;
        const contents = <>
          {hasArtwork ? <ItemIcon icon={src} sprite={src ? undefined : sprite} />
            : <span className="quest-slot-label">{label}</span>}
          {quantity && <span className="quest-slot-quantity" aria-hidden="true">{quantity}</span>}
        </>;
        return <li key={item.id} className="quest-detail-slot" data-text-only={!hasArtwork || undefined}>
          {target ? <ItemLink item={target} label={caption} itemHref={itemNavigation.itemHref} onOpenItem={openItem}
            description={hovered ? { ...hovered.target, id: tooltipId } : undefined}
            showTooltip={(item, target) => setHovered({ item, target, label: caption })}
            hideTooltip={hideTooltip}>{contents}</ItemLink>
          : <button type="button" className="item-slot-button" aria-label={caption}
            onPointerEnter={event => {
              if (event.pointerType !== 'touch' && !document.querySelector('.item-tooltip[data-pinned]')) setHovered({ label: caption,
                target: { anchor: event.currentTarget, triggerId: item.id } });
            }}
            onPointerLeave={event => { if (event.pointerType !== 'touch' && !hovered?.target.pinned) hideTooltip(event.currentTarget); }}
            onFocus={event => { if (!document.querySelector('.item-tooltip[data-pinned]')) setHovered({ label: caption, target: { anchor: event.currentTarget, triggerId: item.id } }); }}
            onBlur={event => { if (!hovered?.target.pinned) hideTooltip(event.currentTarget); }}
            onClick={event => setHovered({ label: caption, target: { anchor: event.currentTarget, triggerId: item.id, pinned: true, keyboard: event.detail === 0 } })}
            aria-describedby={hovered?.target.triggerId === item.id && !hovered.target.pinned ? tooltipId : undefined}
            aria-expanded={hovered?.target.triggerId === item.id && !!hovered.target.pinned}
            aria-controls={hovered?.target.triggerId === item.id && hovered.target.pinned ? tooltipId : undefined}>{contents}</button>}
        </li>;
      })}</ul>
    </section>;
  }
  return <ProgressDialog kind="quest" dialogRef={dialog} restoreFocus={restoreFocus} suspended={itemNavigation.itemOpen}
    onClose={onClose} title={<><QuestIcon entry={quest} icons={icons} />{quest.title || labels.untitled}</>}
    overlay={hovered?.item ? <ItemTooltip id={tooltipId} target={hovered.target} item={hovered.item} onDismiss={hideTooltip} />
      : <ItemTooltipPopover id={tooltipId} target={hovered?.target} onDismiss={hideTooltip}>
        <strong>{hovered?.label}</strong>
      </ItemTooltipPopover>}>
        {completed && <div className="achievement-details">
          <span data-completed={completed.has(quest.id)}>{completed.has(quest.id) ? labels.done : labels.incomplete}</span>
        </div>}
        {completedAt && <time dateTime={new Date(completedAt).toISOString()}>{date.format(completedAt)}</time>}
        {quest.description && <p>{quest.description}</p>}
        {!!(quest.tasks?.length || quest.rewards?.length) && <div className="quest-dialog-lists">
          {detailList(labelsForDetails.tasks, quest.tasks)}
          {detailList(labelsForDetails.rewards, quest.rewards)}
        </div>}
        {prerequisiteCount > 0 && <details className="quest-prerequisites">
          <summary>{labelsForDetails.prerequisites} ({number.format(prerequisiteCount)})</summary>
          {quest.minimumRequired && <p>{number.format(quest.minimumRequired)} / {number.format(prerequisiteCount)}</p>}
          <ul className="quest-detail-items">
            {prerequisites.map(entry => <li key={entry.id}>
              <button type="button" onClick={() => onPrerequisite(entry.id)}>
                <QuestIcon entry={entry} icons={icons} />{entry.title || labels.untitled}
              </button>
            </li>)}
            {hiddenPrerequisites > 0 && <li>{labelsForDetails.hidden} ({number.format(hiddenPrerequisites)})</li>}
          </ul>
        </details>}
  </ProgressDialog>;
}

export function PlayerQuests({ server, progress: completion, url, itemNavigation, playerKnown }: {
  server: string; progress: ReturnType<typeof useProfileProgress>; url: string; itemNavigation: QuestItemNavigation; playerKnown: boolean;
}) {
  const knownPlayer = completion.status !== 'unknown' && (playerKnown || completion.status === 'ready' || completion.status === 'noProgress');
  const progress = useProfileCatalog(questsPath, server, readQuestCatalog, knownPlayer);
  const labels = usePreferences().text.quest;
  const completionLabel = completion.status === 'ready' ? undefined : labels[completion.status];
  if (!knownPlayer) return <InfoPanel><p role="status">{completionLabel}</p></InfoPanel>;
  if (progress.status !== 'ready') return <InfoPanel><p role="status">{labels[progress.status]}</p></InfoPanel>;
  return <InfoPanel>
    {completionLabel && <p role="status">{completionLabel}</p>}
    <QuestViews server={server} catalog={progress.data} url={url} itemNavigation={itemNavigation}
      completed={completion.status === 'ready' ? new Set(completion.data.completedIds) : undefined}
      completedAt={completion.status === 'ready' ? completion.data.completedAt : undefined} />
  </InfoPanel>;
}

function QuestViews({ server, catalog, completed, completedAt, url, itemNavigation }: {
  server: string; catalog: QuestCatalog; completed?: ReadonlySet<string>; completedAt?: Record<string, number>; url: string;
  itemNavigation: QuestItemNavigation;
}) {
  const { text, questView: defaultView, update } = usePreferences();
  const labels = text.quest;
  const [limit, setLimit] = useState(pageSize);
  const [{ view, group, entry }, changeLocation] = useProgressLocation(url, 'quest', defaultView);
  const chapters = catalog.chapters.filter(chapter => chapter.quests.length > 0 || chapter.images?.length);
  const chosen = chapters.find(chapter => chapter.id === group);
  const entryChapter = entry ? chapters.find(chapter => chapter.quests.some(quest => quest.id === entry)) : undefined;
  const boardChapter = chosen ?? entryChapter ?? chapters[0];
  const listChapters = chosen ? [chosen] : chapters;
  const total = listChapters.reduce((count, chapter) => count + chapter.quests.length, 0);
  const byId = new Map<string, QuestDetailEntry>(chapters.flatMap(chapter => [chapter, ...chapter.quests]
    .map(value => [value.id, value] as const)));
  const selected = entryChapter && (!chosen || chosen === entryChapter)
    ? entryChapter.quests.find(quest => quest.id === entry) : undefined;
  if (!boardChapter) return <p>{labels.empty}</p>;
  function selectChapter(id: string) {
    if (id === (view === 'board' ? boardChapter.id : chosen?.id ?? '')) return;
    setLimit(pageSize);
    changeLocation({ group: id, entry: '' });
  }
  return <>
    <div className="achievement-toolbar">
      <div className="achievement-view" role="group" aria-label={text.quests}>
        {(['board', 'list'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode}
          onClick={() => { changeLocation({ view: mode }); update({ questView: mode }); }}>{text.achievement[mode]}</button>)}
      </div>
    </div>
    <div className="quest-workspace">
      <ChapterPicker chapters={chapters} selected={view === 'board' ? boardChapter.id : chosen?.id ?? ''}
        allowAll={view === 'list'} server={server} onSelect={selectChapter} />
      <div className="quest-workspace-content">
        {view === 'board'
          ? <ProgressBoard key={boardChapter.id} server={server} label={boardChapter.title || labels.chapter}
            entries={boardChapter.quests} decorations={boardChapter.images}
            completed={completed} doneLabel={labels.done} pendingLabel={labels.incomplete}
            selectedId={selected?.id ?? ''} onSelect={id => changeLocation({ group: boardChapter.id, entry: id })} />
          : <>
            <QuestChapters chapters={listChapters} limit={limit} onOpen={id => changeLocation({ entry: id })} />
            {limit < total && <button className="achievements-more" type="button"
              onClick={() => setLimit(current => current + pageSize)}>{labels.more}</button>}
          </>}
      </div>
    </div>
    {selected && <QuestDialog key={selected.id} quest={selected} server={server} completed={completed}
      itemNavigation={itemNavigation} legacyItems={catalog.itemDetailVersion === undefined}
      completedAt={completedAt?.[selected.id]} byId={byId} onClose={() => changeLocation({ entry: '' })}
      onPrerequisite={id => {
        const chapter = chapters.find(chapter => chapter.id === id || chapter.quests.some(quest => quest.id === id));
        if (chapter) changeLocation({ group: chapter.id, entry: chapter.id === id ? '' : id });
      }} />}
  </>;
}
