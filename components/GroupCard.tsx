import { memo, useMemo, useState } from 'react';
import type { SavedGroup, TabItem } from '../lib/types';
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
  collapsed?: boolean;
  removeAfterRestore?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export const GroupCard = memo(function GroupCard({
  group,
  tabs = group.tabs,
  collapsed: controlledCollapsed,
  removeAfterRestore = false,
  onCollapsedChange,
}: GroupCardProps) {
  const toast = useToast();
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [cardRef, onScreen] = useOnScreen<HTMLElement>();
  const collapsed = controlledCollapsed ?? localCollapsed;
  const capped = !showAllRows && tabs.length > MAX_ROWS_PER_CARD;
  const mountedTabs = useMemo(() => capped ? tabs.slice(0, MAX_ROWS_PER_CARD) : tabs, [capped, tabs]);

  const setCollapsed = (next: boolean) => {
    setLocalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const restoreGroup = () => {
    void sendCmd({ cmd: 'restoreGroup', groupId: group.id, removeAfter: removeAfterRestore }).then((result) => {
      if (!result.ok) return toast.show(result.error);
      const restored = result.restore?.restored ?? 0;
      const skipped = result.restore?.skipped.length ?? 0;
      toast.show(skipped
        ? `Restored ${restored} tabs; ${skipped} restricted pages skipped.`
        : `Restored ${restored} tab${restored === 1 ? '' : 's'}.`);
    });
  };

  const deleteGroup = () => {
    void sendCmd({ cmd: 'trashGroup', groupId: group.id }).then((result) => {
      if (result.ok) toast.show(`Moved “${group.name}” to trash.`, result.trashEntryId);
      else toast.show(result.error);
    });
  };

  return (
    <article className="group-card" aria-label={group.name} ref={cardRef}>
      <div className="group-header">
        <button
          className="btn-ghost btn-sm"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand session' : 'Collapse session'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="group-name">{group.name}</span>
        <span className="count">
          {tabs.length === group.tabs.length
            ? `${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'}`
            : `${tabs.length} of ${group.tabs.length}`}
        </span>
        <button className="btn btn-sm" onClick={restoreGroup}>Restore</button>
        <button className="btn-ghost btn-sm btn-danger" onClick={deleteGroup}>Delete</button>
      </div>

      {group.chromeGroups.length > 0 && !collapsed ? (
        <div className="chrome-group-badges">
          {group.chromeGroups.map((chromeGroup, index) => (
            <span
              key={index}
              className="chrome-badge"
              style={{ background: GROUP_COLOR_HEX[chromeGroup.color] ?? '#5f6368' }}
            >
              {chromeGroup.title || 'Unnamed group'}
            </span>
          ))}
        </div>
      ) : null}

      {!collapsed && onScreen ? (
        <>
          <ul className="tab-rows">
            {mountedTabs.map((tab) => <TabRow key={tab.id} tab={tab} groupId={group.id} />)}
          </ul>
          {capped ? (
            <div className="tab-rows-more">
              <button className="btn-ghost btn-sm" onClick={() => setShowAllRows(true)}>
                Show all {tabs.length} tabs
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {!collapsed && !onScreen ? <ul className="tab-rows" style={{ height: tabs.length * 38 }} /> : null}
    </article>
  );
});

const TabRow = memo(function TabRow({ tab, groupId }: { tab: TabItem; groupId: string }) {
  const toast = useToast();
  const { host, blocked } = urlInfo(tab.url);

  const restore = () => {
    if (blocked) {
      void navigator.clipboard.writeText(tab.url)
        .then(() => toast.show('Restricted URL copied.'))
        .catch(() => toast.show('Copy failed.'));
      return;
    }
    void sendCmd({ cmd: 'restoreTab', groupId, tabId: tab.id }).then((result) => {
      if (!result.ok) toast.show(result.error);
      else if (!result.restore?.restored) toast.show('Chrome refused to open this URL.');
    });
  };

  const remove = () => {
    void sendCmd({ cmd: 'trashTab', groupId, tabId: tab.id }).then((result) => {
      if (result.ok) toast.show('Tab moved to trash.', result.trashEntryId);
      else toast.show(result.error);
    });
  };

  return (
    <li className={`tab-row${blocked ? ' blocked' : ''}`}>
      <Favicon url={tab.url} />
      <div className="tab-info" title={tab.url}>
        <span className="tab-title">{tab.title}</span>
      </div>
      {tab.pinned ? <span className="pin-badge">pinned</span> : null}
      {host ? <span className="tab-host">{host}</span> : null}
      <button className="btn-ghost btn-sm row-restore" onClick={restore}>
        {blocked ? 'Copy URL' : 'Restore'}
      </button>
      <button className="btn-ghost btn-sm btn-danger row-delete" onClick={remove}>Delete</button>
    </li>
  );
});
