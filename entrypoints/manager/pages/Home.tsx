import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { GroupCard } from '../../../components/GroupCard';
import { LoadError } from '../../../components/LoadError';
import { useToast } from '../../../components/Toast';
import type { ShelfData } from '../../../components/useStorageData';
import { STORAGE_WARN_BYTES, TRASH_RETENTION_DAYS } from '../../../lib/constants';
import { sendCmd } from '../../../lib/messaging';
import { searchGroups } from '../../../lib/search';
import * as repo from '../../../lib/storage/repo';

export function Home({ data }: { data: ShelfData }) {
  const { groups, settings, loading } = data;
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [bytes, setBytes] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const savedTabCount = groups.reduce((count, group) => count + group.tabs.length, 0);

  useEffect(() => {
    const id = setTimeout(() => {
      void repo.bytesInUse().then(setBytes).catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [groups.length, savedTabCount, data.trash.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      event.preventDefault();
      document.getElementById('shelf-search')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const searchActive = query.trim().length > 0;
    return searchGroups(groups, query).map(({ group, matchingTabIds }) => ({
      group,
      tabs: searchActive && matchingTabIds.size > 0
        ? group.tabs.filter((tab) => matchingTabIds.has(tab.id))
        : group.tabs,
    }));
  }, [groups, query]);

  const deleteAll = () => {
    if (deletingAll) return;
    setDeletingAll(true);
    void sendCmd({ cmd: 'trashAll' }).then((result) => {
      setDeleteDialogOpen(false);
      if (result.ok) {
        const trashed = result.trashed ?? 0;
        toast.show(`Moved ${trashed} session${trashed === 1 ? '' : 's'} to Trash.`);
      } else {
        toast.show(result.error);
      }
    }).finally(() => setDeletingAll(false));
  };

  if (data.loadError) return <LoadError retry={data.refresh} />;
  if (loading) return <div aria-busy="true" />;

  return (
    <div>
      {bytes > STORAGE_WARN_BYTES ? (
        <div className="storage-banner" role="status">
          Shelf is using {(bytes / 1024 / 1024).toFixed(0)} MB of local storage. Export a backup and remove sessions you no longer need.
        </div>
      ) : null}

      <div className="toolbar simple-toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search saved tabs…"
          aria-label="Search saved tabs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          id="shelf-search"
        />
        {groups.length > 0 ? (
          <button className="btn btn-danger" onClick={() => setDeleteDialogOpen(true)}>
            Delete all
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete all sessions?"
        description={`This will move ${groups.length} session${groups.length === 1 ? '' : 's'} containing ${savedTabCount} tab${savedTabCount === 1 ? '' : 's'} to Trash. You can restore them for ${TRASH_RETENTION_DAYS} days.`}
        confirmLabel="Delete all"
        busy={deletingAll}
        onClose={() => {
          if (!deletingAll) setDeleteDialogOpen(false);
        }}
        onConfirm={deleteAll}
      />

      {groups.length === 0 ? (
        <div className="empty-state">
          <h2>Your shelf is empty</h2>
          <p>
            Click the Shelf icon in Chrome&rsquo;s toolbar to save open tabs. Backups and OneTab imports are available in Settings.
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <h2>No matches</h2>
          <p>No saved tabs match your search.</p>
        </div>
      ) : (
        results.map(({ group, tabs }) => (
          <GroupCard
            key={group.id}
            group={group}
            tabs={tabs}
            removeAfterRestore={settings.restoreRemovesFromList}
            collapsed={collapsedGroupIds.has(group.id)}
            onCollapsedChange={(collapsed) => setCollapsedGroupIds((current) => {
              const next = new Set(current);
              collapsed ? next.add(group.id) : next.delete(group.id);
              return next;
            })}
          />
        ))
      )}
    </div>
  );
}
