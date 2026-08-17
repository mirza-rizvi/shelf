import { useEffect, useMemo, useRef, useState } from 'react';
import { GroupCard } from '../../../components/GroupCard';
import { LoadError } from '../../../components/LoadError';
import { useToast } from '../../../components/Toast';
import type { ShelfData } from '../../../components/useStorageData';
import { INBOX_WORKSPACE_ID, type ManagerDensity, type ManagerSessionSort, type ManagerTabSort } from '../../../lib/types';
import { STORAGE_WARN_BYTES, TRASH_RETENTION_DAYS } from '../../../lib/constants';
import { buildJsonExport } from '../../../lib/importExport/exportJson';
import { buildTextExport } from '../../../lib/importExport/exportText';
import { sendCmd } from '../../../lib/messaging';
import { buildDomainOptions, deriveListView, reconcileSelection, toggleSelection } from '../../../lib/listView';
import * as repo from '../../../lib/storage/repo';

const EMPTY_TAB_SELECTION: ReadonlySet<string> = new Set<string>();

export function Home({ data }: { data: ShelfData }) {
  const { groups, settings, workspaces, loading } = data;
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [bytes, setBytes] = useState(0);
  const [workspaceId, setWorkspaceId] = useState<string>('all');
  const [domain, setDomain] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  const savedTabCount = groups.reduce((n, g) => n + g.tabs.length, 0);

  // bytesInUse() is a getBytesInUse(null) over the whole store and its setBytes
  // forces a second render pass, so it must not run on every keystroke-speed
  // storage write. Scalar deps (not array identity) + a trailing delay: the
  // 100 MB warning has no need to be interactive.
  useEffect(() => {
    const id = setTimeout(() => {
      void repo.bytesInUse().then(setBytes).catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [groups.length, savedTabCount, data.trash.length]);

  // OneTab's search shortcut exists but is undiscoverable; ours is both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      document.getElementById('shelf-search')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const workspaceGroups = useMemo(
    () => workspaceId === 'all' ? groups : groups.filter((group) => (group.workspaceId ?? INBOX_WORKSPACE_ID) === workspaceId),
    [groups, workspaceId],
  );
  const domainOptions = useMemo(() => buildDomainOptions(workspaceGroups), [workspaceGroups]);
  const results = useMemo(
    () => deriveListView(workspaceGroups, query, domain, settings.managerSessionSort, settings.managerTabSort),
    [workspaceGroups, query, domain, settings.managerSessionSort, settings.managerTabSort],
  );
  const visibleKeys = useMemo(
    () => results.flatMap(({ group, tabs }) => tabs.map((tab) => `${group.id}:${tab.id}`)),
    [results],
  );
  const visibleSelected = visibleKeys.reduce((count, key) => count + Number(selected.has(key)), 0);
  const hiddenSelected = selected.size - visibleSelected;
  const allVisibleSelected = visibleKeys.length > 0 && visibleSelected === visibleKeys.length;
  const selectedByGroup = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const key of selected) {
      const separator = key.indexOf(':');
      if (separator < 0) continue;
      const groupId = key.slice(0, separator);
      const tabId = key.slice(separator + 1);
      const ids = grouped.get(groupId) ?? new Set<string>();
      ids.add(tabId);
      grouped.set(groupId, ids);
    }
    return grouped;
  }, [selected]);

  useEffect(() => {
    if (domain && !domainOptions.some((option) => option.host === domain)) setDomain('');
  }, [domain, domainOptions]);

  useEffect(() => {
    setSelected((current) => reconcileSelection(current, groups));
  }, [groups]);

  const saveViewSetting = (settingsPatch: {
    managerDensity?: ManagerDensity;
    managerSessionSort?: ManagerSessionSort;
    managerTabSort?: ManagerTabSort;
  }) => {
    void sendCmd({ cmd: 'saveSettings', settings: settingsPatch }).then((result) => {
      if (!result.ok) toast.show(result.error);
    });
  };

  const download = (filename: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const date = new Date().toISOString().slice(0, 10);
    download(`shelf-export-${date}.json`, buildJsonExport(groups, settings, workspaces), 'application/json');
    void sendCmd({ cmd: 'markExported' });
    toast.show('Exported all shelves as JSON.');
  };

  const exportText = () => {
    const date = new Date().toISOString().slice(0, 10);
    download(`shelf-export-${date}.txt`, buildTextExport(workspaceGroups), 'text/plain');
    void sendCmd({ cmd: 'markExported' });
    toast.show('Exported all shelves as text (OneTab-compatible).');
  };

  const safeName = (name: string) => name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'session';
  const exportSession = (group: (typeof groups)[number], format: 'json' | 'text') => {
    const date = new Date().toISOString().slice(0, 10);
    const workspace = workspaces.find((item) => item.id === (group.workspaceId ?? INBOX_WORKSPACE_ID));
    const content = format === 'json'
      ? buildJsonExport([group], undefined, workspace ? [workspace] : undefined)
      : buildTextExport([group]);
    download(`shelf-${safeName(group.name)}-${date}.${format === 'json' ? 'json' : 'txt'}`, content, format === 'json' ? 'application/json' : 'text/plain');
    void sendCmd({ cmd: 'markExported' });
    toast.show(`Exported “${group.name}”.`);
  };

  const onImportFile = (file: File) => {
    file
      .text()
      .then((text) => {
        const isJson = file.name.endsWith('.json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
        return sendCmd(isJson ? { cmd: 'importGroups', json: text } : { cmd: 'importOneTab', text }).then((res) => {
          if (res.ok) toast.show(`Imported ${res.imported ?? 0} shel${(res.imported ?? 0) === 1 ? 'f' : 'ves'}.`);
          else toast.show(`Import failed: ${res.error}`);
        });
      })
      .catch(() => toast.show('Could not read that file.'));
  };

  if (data.loadError) return <LoadError retry={data.refresh} />;
  if (loading) return <div aria-busy="true" />;

  // Rough per-tab RAM figure; deliberately conservative and labeled "est.".
  const estGbFreed = (savedTabCount * 60) / 1024;

  return (
    <div>
      {bytes > STORAGE_WARN_BYTES ? (
        <div className="storage-banner" role="status">
          Shelf is using {(bytes / 1024 / 1024).toFixed(0)} MB of local storage. Consider exporting and pruning old shelves.
        </div>
      ) : null}

      <div className="workspace-bar" aria-label="Workspaces">
        <button className={workspaceId === 'all' ? 'btn' : 'btn-ghost'} onClick={() => setWorkspaceId('all')}>All</button>
        {workspaces.map((workspace) => (
          <button key={workspace.id} className={workspaceId === workspace.id ? 'btn' : 'btn-ghost'} onClick={() => setWorkspaceId(workspace.id)}>
            {workspace.name}
          </button>
        ))}
        <button className="btn-ghost" onClick={() => {
          const name = prompt('Workspace name');
          if (name) void sendCmd({ cmd: 'createWorkspace', name }).then((res) => { if (!res.ok) toast.show(res.error); });
        }}>+ Workspace</button>
        {workspaceId !== 'all' && workspaceId !== INBOX_WORKSPACE_ID ? (
          <details className="workspace-actions">
            <summary className="btn-ghost">•••</summary>
            <div className="menu-items">
              <button className="btn-ghost" onClick={() => {
                const current = workspaces.find((workspace) => workspace.id === workspaceId);
                const name = prompt('Rename workspace', current?.name);
                if (name) void sendCmd({ cmd: 'renameWorkspace', workspaceId, name }).then((res) => { if (!res.ok) toast.show(res.error); });
              }}>Rename</button>
              <button className="btn-ghost btn-danger" onClick={() => {
                if (!confirm('Move this workspace and its sessions to Trash?')) return;
                void sendCmd({ cmd: 'deleteWorkspace', workspaceId }).then((res) => {
                  if (res.ok) { setWorkspaceId('all'); toast.show(`Workspace deleted; ${res.trashed ?? 0} sessions are recoverable in Trash.`); }
                  else toast.show(res.error);
                });
              }}>Delete</button>
            </div>
          </details>
        ) : null}
      </div>

      <div className="toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search saved tabs… ( / )"
          aria-label="Search saved tabs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          id="shelf-search"
        />
        <select className="input toolbar-select" aria-label="Filter by domain" value={domain} onChange={(event) => setDomain(event.target.value)}>
          <option value="">All domains</option>
          {domainOptions.map((option) => <option key={option.host} value={option.host}>{option.host} ({option.count})</option>)}
        </select>
        <select className="input toolbar-select" aria-label="Sort sessions" value={settings.managerSessionSort} onChange={(event) => saveViewSetting({ managerSessionSort: event.target.value as ManagerSessionSort })}>
          <option value="manual">Sessions: Manual</option>
          <option value="newest">Sessions: Newest</option>
          <option value="oldest">Sessions: Oldest</option>
          <option value="name">Sessions: Name</option>
          <option value="tab-count">Sessions: Tab count</option>
        </select>
        <select className="input toolbar-select" aria-label="Sort tabs" value={settings.managerTabSort} onChange={(event) => saveViewSetting({ managerTabSort: event.target.value as ManagerTabSort })}>
          <option value="manual">Tabs: Manual</option>
          <option value="title">Tabs: Title</option>
          <option value="domain">Tabs: Domain</option>
          <option value="newest">Tabs: Newest</option>
          <option value="oldest">Tabs: Oldest</option>
        </select>
        <button
          className="btn-ghost density-toggle"
          aria-pressed={settings.managerDensity === 'compact'}
          onClick={() => saveViewSetting({ managerDensity: settings.managerDensity === 'compact' ? 'comfortable' : 'compact' })}
        >
          {settings.managerDensity === 'compact' ? 'Comfortable' : 'Compact'}
        </button>
        <details className="toolbar-menu" ref={menuRef}>
          <summary className="btn">More ▾</summary>
          <div className="menu-items">
            <button
              className="btn-ghost"
              onClick={() => {
                closeMenu();
                const tabCount = groups.reduce((n, g) => n + g.tabs.length, 0);
                if (!confirm(`Restore all ${tabCount} tabs? They'll open unloaded and load when clicked.`)) return;
                void sendCmd({ cmd: 'restoreAll' }).then((res) => {
                  if (res.ok && res.restore) toast.show(`Restored ${res.restore.restored} tabs.`);
                  else if (!res.ok) toast.show(res.error);
                });
              }}
            >
              Restore everything…
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                closeMenu();
                exportJson();
              }}
            >
              Export as JSON (full fidelity)
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                closeMenu();
                exportText();
              }}
            >
              Export as text (OneTab format)
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                closeMenu();
                fileInputRef.current?.click();
              }}
            >
              Import (JSON or OneTab text)
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                closeMenu();
                if (!confirm(`Remove duplicate URLs from ${workspaceId === 'all' ? 'all sessions' : 'this workspace'}? The oldest saved copy will be kept and removals can be recovered from Trash.`)) return;
                void sendCmd({ cmd: 'removeDuplicates', groupIds: workspaceId === 'all' ? undefined : workspaceGroups.map((group) => group.id), keep: 'oldest' }).then((res) => {
                  if (res.ok) toast.show(`Moved ${res.removed ?? 0} duplicate tabs to Trash.`);
                  else toast.show(res.error);
                });
              }}
            >
              Find &amp; remove duplicates…
            </button>
            <button
              className="btn-ghost btn-danger"
              onClick={() => {
                closeMenu();
                const tabCount = groups.reduce((n, g) => n + g.tabs.length, 0);
                if (
                  !confirm(
                    `Move all ${groups.length} shelves (${tabCount} tabs) to Trash? You can restore them from Trash for ${TRASH_RETENTION_DAYS} days.`,
                  )
                )
                  return;
                void sendCmd({ cmd: 'trashAll' }).then((res) => {
                  if (res.ok) toast.show(`Moved ${res.trashed ?? 0} shelves to trash.`);
                  else toast.show(res.error);
                });
              }}
            >
              Delete all shelves…
            </button>
          </div>
        </details>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,text/plain,application/json"
          className="visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {results.length > 0 ? (
        <div className="list-controls">
          <button className="btn-ghost btn-sm" onClick={() => setSelected((current) => toggleSelection(current, visibleKeys, !allVisibleSelected))}>{allVisibleSelected ? 'Deselect results' : `Select results (${visibleKeys.length})`}</button>
          <button className="btn-ghost btn-sm" onClick={() => setCollapsedGroupIds(new Set(results.map((result) => result.group.id)))}>Collapse all</button>
          <button className="btn-ghost btn-sm" onClick={() => setCollapsedGroupIds((current) => {
            const next = new Set(current);
            for (const result of results) next.delete(result.group.id);
            return next;
          })}>Expand all</button>
          {settings.managerSessionSort !== 'manual' || settings.managerTabSort !== 'manual' ? (
            <span className="muted sort-hint">Choose Manual sorting to drag and reorder.</span>
          ) : null}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="selection-toolbar">
          <strong>{selected.size} selected{hiddenSelected > 0 ? ` · ${hiddenSelected} hidden by filters` : ''}</strong>
          <button className="btn" onClick={() => {
            const items = [...selected].map((key) => { const [groupId, tabId] = key.split(':'); return { groupId: groupId!, tabId: tabId! }; });
            void sendCmd({ cmd: 'restoreSelected', items, removeAfter: false }).then((res) => { if (res.ok) toast.show(`Restored ${res.restore?.restored ?? 0} tabs.`); else toast.show(res.error); });
          }}>Restore</button>
          <select aria-label="Move selected tabs" defaultValue="" onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            const items = [...selected].map((key) => { const [groupId, tabId] = key.split(':'); return { groupId: groupId!, tabId: tabId! }; });
            void sendCmd(value.startsWith('workspace:')
              ? { cmd: 'moveTabs', items, workspaceId: value.slice(10) }
              : { cmd: 'moveTabs', items, destinationGroupId: value.slice(8) }).then((res) => {
                if (res.ok) { setSelected(new Set()); toast.show(`Moved ${res.moved ?? 0} tabs.`); }
                else toast.show(res.error);
              });
            event.target.value = '';
          }}>
            <option value="">Move to…</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={`workspace:${workspace.id}`}>New session in {workspace.name}</option>)}
            {groups.map((group) => <option key={group.id} value={`session:${group.id}`}>Session: {group.name}</option>)}
          </select>
          <button className="btn-ghost" onClick={() => {
            const selectedTabs = groups.flatMap((group) => group.tabs.filter((tab) => selected.has(`${group.id}:${tab.id}`)));
            void navigator.clipboard.writeText(selectedTabs.map((tab) => tab.url).join('\n')).then(() => toast.show('Selected URLs copied.'));
          }}>Copy URLs</button>
          <button className="btn-ghost" onClick={() => {
            const selectedTabs = groups.flatMap((group) => group.tabs.filter((tab) => selected.has(`${group.id}:${tab.id}`)));
            void navigator.clipboard.writeText(selectedTabs.map((tab) => `${tab.url} | ${tab.title.replace(/\s+/g, ' ').trim()}`).join('\n')).then(() => toast.show('Selected URLs and titles copied.'));
          }}>Copy + titles</button>
          <button className="btn-ghost btn-danger" onClick={() => {
            if (!confirm(`Move ${selected.size} selected tab${selected.size === 1 ? '' : 's'} to Trash?`)) return;
            const items = [...selected].map((key) => { const [groupId, tabId] = key.split(':'); return { groupId: groupId!, tabId: tabId! }; });
            void sendCmd({ cmd: 'trashSelected', items }).then((res) => { if (res.ok) { setSelected(new Set()); toast.show(`Moved ${res.trashed ?? 0} tabs to Trash.`); } else toast.show(res.error); });
          }}>Delete</button>
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <p className="muted stats-strip" aria-label="Shelf statistics">
          {groups.length} shel{groups.length === 1 ? 'f' : 'ves'} · {savedTabCount} saved tab
          {savedTabCount === 1 ? '' : 's'} · {(bytes / 1024 / 1024).toFixed(1)} MB stored ·
          would use ≈{estGbFreed.toFixed(1)} GB if open (est.)
        </p>
      ) : null}

      {groups.length === 0 ? (
        <div className="empty-state">
          <h2>Your shelf is empty</h2>
          <p>
            Click the Shelf icon in Chrome’s toolbar to save your open tabs — they’ll wait
            here, stored only on this device, until you need them again.
          </p>
          <div className="empty-actions">
            <button className="btn" onClick={() => fileInputRef.current?.click()}>
              Import from OneTab or Shelf
            </button>
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <h2>No matches</h2>
          <p>No saved tabs match the current search and filters.</p>
        </div>
      ) : (
        results.map((r) => (
          <GroupCard
            key={r.group.id}
            group={r.group}
            tabs={r.tabs}
            workspaces={workspaces}
            groups={groups}
            density={settings.managerDensity}
            tabSort={settings.managerTabSort}
            collapsed={collapsedGroupIds.has(r.group.id)}
            canReorderSession={settings.managerSessionSort === 'manual'}
            selectedTabIds={selectedByGroup.get(r.group.id) ?? EMPTY_TAB_SELECTION}
            onCollapsedChange={(collapsed) => setCollapsedGroupIds((current) => {
              const next = new Set(current);
              collapsed ? next.add(r.group.id) : next.delete(r.group.id);
              return next;
            })}
            onToggleTab={(tabId, checked) => setSelected((current) => {
              const next = new Set(current);
              const key = `${r.group.id}:${tabId}`;
              checked ? next.add(key) : next.delete(key);
              return next;
            })}
            onToggleVisible={(checked) => setSelected((current) => toggleSelection(current, r.tabs.map((tab) => `${r.group.id}:${tab.id}`), checked))}
            onDropGroup={(draggedId, beforeId) => {
              const order = groups.map((group) => group.id).filter((id) => id !== draggedId);
              order.splice(Math.max(0, order.indexOf(beforeId)), 0, draggedId);
              void sendCmd({ cmd: 'reorderGroups', groupIds: order });
            }}
            onExportJson={() => exportSession(r.group, 'json')}
            onExportText={() => exportSession(r.group, 'text')}
          />
        ))
      )}
    </div>
  );
}
