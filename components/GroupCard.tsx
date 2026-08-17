import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ManagerDensity,
  ManagerTabSort,
  SavedGroup,
  TabItem,
  Workspace,
} from '../lib/types';
import { urlInfo } from '../lib/urls';
import { sendCmd } from '../lib/messaging';
import { Favicon } from './Favicon';
import { useOnScreen } from './useOnScreen';
import { useToast } from './Toast';

const GROUP_COLOR_HEX: Record<string, string> = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
  green: '#188038', pink: '#d01884', purple: '#a142f4', cyan: '#007b83', orange: '#fa903e',
};
const MAX_ROWS_PER_CARD = 300;

export interface GroupCardProps {
  group: SavedGroup;
  tabs?: TabItem[];
  workspaces?: Workspace[];
  groups?: SavedGroup[];
  selectedTabIds?: ReadonlySet<string>;
  density?: ManagerDensity;
  tabSort?: ManagerTabSort;
  collapsed?: boolean;
  canReorderSession?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onToggleTab?: (tabId: string, selected: boolean) => void;
  onToggleVisible?: (selected: boolean) => void;
  onDropGroup?: (draggedId: string, beforeId: string) => void;
  onExportJson?: () => void;
  onExportText?: () => void;
}

export const GroupCard = memo(function GroupCard({
  group,
  tabs = group.tabs,
  workspaces = [],
  groups = [],
  selectedTabIds = new Set<string>(),
  density = 'comfortable',
  tabSort = 'manual',
  collapsed: controlledCollapsed,
  canReorderSession = true,
  onCollapsedChange,
  onToggleTab = () => {},
  onToggleVisible = () => {},
  onDropGroup = () => {},
  onExportJson = () => {},
  onExportText = () => {},
}: GroupCardProps) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const selectRef = useRef<HTMLInputElement>(null);
  const [cardRef, onScreen] = useOnScreen<HTMLElement>();
  const collapsed = controlledCollapsed ?? localCollapsed;
  const selectedVisible = tabs.reduce((count, tab) => count + Number(selectedTabIds.has(tab.id)), 0);
  const allVisibleSelected = tabs.length > 0 && selectedVisible === tabs.length;

  useEffect(() => {
    if (selectRef.current) selectRef.current.indeterminate = selectedVisible > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisible]);

  const capped = !showAllRows && tabs.length > MAX_ROWS_PER_CARD;
  const mountedTabs = useMemo(() => capped ? tabs.slice(0, MAX_ROWS_PER_CARD) : tabs, [capped, tabs]);

  const setCollapsed = (next: boolean) => {
    setLocalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const showResult = (promise: ReturnType<typeof sendCmd>, success: string) => {
    void promise.then((result) => toast.show(result.ok ? success : result.error));
  };

  const restoreGroup = (removeAfter: boolean) => {
    void sendCmd({ cmd: 'restoreGroup', groupId: group.id, removeAfter }).then((result) => {
      if (!result.ok) return toast.show(result.error);
      const restored = result.restore?.restored ?? 0;
      const skipped = result.restore?.skipped.length ?? 0;
      toast.show(skipped ? `Restored ${restored} tabs; ${skipped} restricted pages skipped.` : `Restored ${restored} tab${restored === 1 ? '' : 's'}.`);
    });
  };

  const copy = (withTitles: boolean) => {
    const text = group.tabs.map((tab) => withTitles ? `${tab.url} | ${tab.title.replace(/\s+/g, ' ').trim()}` : tab.url).join('\n');
    void navigator.clipboard.writeText(text)
      .then(() => toast.show(withTitles ? 'URLs and titles copied.' : 'URLs copied.'))
      .catch(() => toast.show('Copy failed — click the page and try again.'));
  };

  const commitRename = () => {
    setRenaming(false);
    const name = nameDraft.trim();
    if (name && name !== group.name) showResult(sendCmd({ cmd: 'renameGroup', groupId: group.id, name }), 'Session renamed.');
    else setNameDraft(group.name);
  };

  const reorderTab = (draggedId: string, beforeId: string) => {
    if (tabSort !== 'manual') return;
    const order = group.tabs.map((tab) => tab.id).filter((id) => id !== draggedId);
    order.splice(Math.max(0, order.indexOf(beforeId)), 0, draggedId);
    showResult(sendCmd({ cmd: 'reorderTabs', groupId: group.id, tabIds: order }), 'Tab order updated.');
  };

  return (
    <article
      className={`group-card density-${density}`}
      aria-label={group.name}
      ref={cardRef}
      draggable={canReorderSession}
      title={canReorderSession ? undefined : 'Choose Manual session sorting to drag sessions'}
      onDragStart={(event) => {
        if (!canReorderSession) return event.preventDefault();
        event.dataTransfer.setData('text/shelf-group', group.id);
      }}
      onDragOver={(event) => { if (canReorderSession) event.preventDefault(); }}
      onDrop={(event) => {
        if (!canReorderSession) return;
        event.preventDefault();
        const draggedId = event.dataTransfer.getData('text/shelf-group');
        if (draggedId && draggedId !== group.id) onDropGroup(draggedId, group.id);
      }}
    >
      <div className="group-header">
        <input
          ref={selectRef}
          type="checkbox"
          checked={allVisibleSelected}
          aria-label={`Select visible tabs in ${group.name}`}
          onChange={(event) => onToggleVisible(event.target.checked)}
        />
        <button className="btn-ghost btn-sm" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand session' : 'Collapse session'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'}
        </button>
        {renaming ? (
          <input className="input group-name-input" value={nameDraft} autoFocus onChange={(event) => setNameDraft(event.target.value)} onBlur={commitRename} onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') { setNameDraft(group.name); setRenaming(false); }
          }} aria-label="Session name" />
        ) : (
          <button className="group-name" onClick={() => { setNameDraft(group.name); setRenaming(true); }} title="Click to rename">{group.name}</button>
        )}
        <span className="count">{tabs.length === group.tabs.length ? `${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'}` : `${tabs.length} of ${group.tabs.length}`}</span>
        <button className="btn btn-sm" onClick={() => restoreGroup(false)}>Restore</button>
        <details className="action-menu">
          <summary className="btn-ghost btn-sm" role="button" aria-label={`More actions for ${group.name}`}>•••</summary>
          <div className="menu-items">
            <button className="btn-ghost" onClick={() => restoreGroup(true)}>Restore &amp; remove</button>
            <button className="btn-ghost" onClick={() => copy(false)}>Copy URLs</button>
            <button className="btn-ghost" onClick={() => copy(true)}>Copy URLs + titles</button>
            <button className="btn-ghost" onClick={() => showResult(sendCmd({ cmd: 'duplicateGroup', groupId: group.id }), 'Session duplicated.')}>Duplicate session</button>
            <button className="btn-ghost" onClick={onExportJson}>Export session as JSON</button>
            <button className="btn-ghost" onClick={onExportText}>Export session as text</button>
            {workspaces.length ? <label className="menu-field">Move to workspace<select value={group.workspaceId ?? 'inbox'} onChange={(event) => showResult(sendCmd({ cmd: 'moveGroup', groupId: group.id, workspaceId: event.target.value }), 'Session moved.')}>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select></label> : null}
            <button className="btn-ghost btn-danger" onClick={() => void sendCmd({ cmd: 'trashGroup', groupId: group.id }).then((result) => {
              if (result.ok) toast.show(`Moved “${group.name}” to trash.`, result.trashEntryId);
              else toast.show(result.error);
            })}>Delete session</button>
          </div>
        </details>
      </div>

      {group.chromeGroups.length > 0 && !collapsed ? <div className="chrome-group-badges">{group.chromeGroups.map((chromeGroup, index) => (
        <span key={index} className="chrome-badge" style={{ background: GROUP_COLOR_HEX[chromeGroup.color] ?? '#5f6368' }}>{chromeGroup.title || 'Unnamed group'}</span>
      ))}</div> : null}

      {!collapsed && onScreen ? <>
        <ul className="tab-rows">{mountedTabs.map((tab) => (
          <TabRow key={tab.id} tab={tab} groupId={group.id} groups={groups} workspaces={workspaces} selected={selectedTabIds.has(tab.id)} density={density} canReorder={tabSort === 'manual'} onToggle={onToggleTab} onDropTab={reorderTab} />
        ))}</ul>
        {capped ? <div className="tab-rows-more"><button className="btn-ghost btn-sm" onClick={() => setShowAllRows(true)}>Show all {tabs.length} tabs</button></div> : null}
      </> : null}
      {!collapsed && !onScreen ? <ul className="tab-rows" style={{ height: tabs.length * (density === 'compact' ? 28 : 46) }} /> : null}
    </article>
  );
});

interface TabRowProps {
  tab: TabItem;
  groupId: string;
  groups: SavedGroup[];
  workspaces: Workspace[];
  selected: boolean;
  density: ManagerDensity;
  canReorder: boolean;
  onToggle: (tabId: string, selected: boolean) => void;
  onDropTab: (draggedId: string, beforeId: string) => void;
}

const TabRow = memo(function TabRow({ tab, groupId, groups, workspaces, selected, density, canReorder, onToggle, onDropTab }: TabRowProps) {
  const toast = useToast();
  const { host, blocked } = urlInfo(tab.url);
  const item = [{ groupId, tabId: tab.id }];
  const restore = () => {
    if (blocked) return void navigator.clipboard.writeText(tab.url).then(() => toast.show('Restricted URL copied instead.')).catch(() => toast.show('Copy failed.'));
    void sendCmd({ cmd: 'restoreTab', groupId, tabId: tab.id }).then((result) => {
      if (!result.ok) toast.show(result.error);
      else if (!result.restore?.restored) toast.show('Chrome refused to open this restricted URL.');
    });
  };
  const move = (destinationGroupId?: string, workspaceId?: string) => {
    void sendCmd({ cmd: 'moveTabs', items: item, destinationGroupId, workspaceId }).then((result) => toast.show(result.ok ? 'Tab moved.' : result.error));
  };
  const copy = (withTitle: boolean) => void navigator.clipboard.writeText(withTitle ? `${tab.url} | ${tab.title.replace(/\s+/g, ' ').trim()}` : tab.url)
    .then(() => toast.show(withTitle ? 'URL and title copied.' : 'URL copied.')).catch(() => toast.show('Copy failed.'));

  return <li
    className={`tab-row${blocked ? ' blocked' : ''}`}
    draggable={canReorder}
    title={canReorder ? undefined : 'Choose Manual tab sorting to drag tabs'}
    onDragStart={(event) => { event.stopPropagation(); if (!canReorder) return event.preventDefault(); event.dataTransfer.setData('text/shelf-tab', tab.id); }}
    onDragOver={(event) => { if (canReorder && event.dataTransfer.types.includes('text/shelf-tab')) event.preventDefault(); }}
    onDrop={(event) => { const draggedId = event.dataTransfer.getData('text/shelf-tab'); if (!draggedId || !canReorder) return; event.preventDefault(); event.stopPropagation(); if (draggedId !== tab.id) onDropTab(draggedId, tab.id); }}
  >
    <input type="checkbox" checked={selected} aria-label={`Select ${tab.title}`} onChange={(event) => onToggle(tab.id, event.target.checked)} />
    <Favicon url={tab.url} />
    <div className="tab-info" title={tab.url}>
      <span className="tab-title">{tab.title}</span>
      {density === 'comfortable' ? <span className="tab-url">{tab.url}</span> : null}
    </div>
    {tab.pinned ? <span className="pin-badge">pinned</span> : null}
    {host ? <span className="tab-host">{host}</span> : null}
    <button className="btn-ghost btn-sm row-restore" onClick={restore}>{blocked ? 'Copy URL' : 'Restore'}</button>
    <details className="action-menu row-menu">
      <summary className="btn-ghost btn-sm" role="button" aria-label={`More actions for ${tab.title}`}>•••</summary>
      <div className="menu-items">
        <button className="btn-ghost" onClick={() => copy(false)}>Copy URL</button>
        <button className="btn-ghost" onClick={() => copy(true)}>Copy URL + title</button>
        <label className="menu-field">Move to session<select defaultValue="" onChange={(event) => { if (event.target.value) move(event.target.value); event.target.value = ''; }}>
          <option value="">Choose session…</option>
          {groups.filter((group) => group.id !== groupId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select></label>
        <label className="menu-field">New session in<select defaultValue="" onChange={(event) => { if (event.target.value) move(undefined, event.target.value); event.target.value = ''; }}>
          <option value="">Choose workspace…</option>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select></label>
        <button className="btn-ghost btn-danger" onClick={() => void sendCmd({ cmd: 'trashTab', groupId, tabId: tab.id }).then((result) => {
          if (result.ok) toast.show('Tab moved to trash.', result.trashEntryId); else toast.show(result.error);
        })}>Delete tab</button>
      </div>
    </details>
  </li>;
});
