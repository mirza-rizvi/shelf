import { memo } from 'react';
import { LoadError } from '../../../components/LoadError';
import { useToast } from '../../../components/Toast';
import type { ShelfData } from '../../../components/useStorageData';
import { TRASH_RETENTION_DAYS } from '../../../lib/constants';
import { formatDateTime } from '../../../lib/dates';
import type { TrashEntry } from '../../../lib/types';
import { sendCmd } from '../../../lib/messaging';

/** One trash row: owns its toast + undo/purge flow so the page can pass a
 * single identity-stable prop and skip re-rendering untouched rows. */
const TrashEntryRow = memo(function TrashEntryRow({ entry }: { entry: TrashEntry }) {
  const toast = useToast();
  const name = entry.kind === 'tab' ? (entry.group.tabs[0]?.title ?? 'Tab') : entry.group.name;

  return (
    <div className="trash-entry">
      <div className="info">
        <div className="name">{name}</div>
        <div className="when">
          {entry.kind === 'tab' ? 'Single tab' : `${entry.group.tabs.length} tabs`} · deleted{' '}
          {formatDateTime(entry.deletedAt)}
        </div>
      </div>
      <div className="actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            void sendCmd({ cmd: 'undoTrash', entryId: entry.id }).then((res) => {
              if (res.ok) toast.show('Restored to your shelves.');
              else toast.show(res.error);
            });
          }}
        >
          Put back
        </button>
        <button
          className="btn-ghost btn-sm btn-danger"
          onClick={() => {
            if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
            void sendCmd({ cmd: 'purgeTrash', entryId: entry.id }).then((res) => {
              if (res.ok) toast.show('Deleted permanently.');
              else toast.show(res.error);
            });
          }}
        >
          Delete forever…
        </button>
      </div>
    </div>
  );
});

export function TrashPage({ data }: { data: ShelfData }) {
  const { trash } = data;
  const toast = useToast();

  if (data.loadError) return <LoadError retry={data.refresh} />;
  if (trash.length === 0) {
    return (
      <div className="empty-state">
        <h2>Trash is empty</h2>
        <p>
          Deleted shelves and tabs are kept here for {TRASH_RETENTION_DAYS} days so you
          can change your mind.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <p className="muted">
          Items stay in trash for {TRASH_RETENTION_DAYS} days, then are removed automatically.
        </p>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => {
            if (
              !confirm(
                `Permanently delete all ${trash.length} item${trash.length === 1 ? '' : 's'} in Trash? This cannot be undone.`,
              )
            )
              return;
            void sendCmd({ cmd: 'emptyTrash' }).then((res) => {
              if (res.ok) toast.show('Trash emptied.');
              else toast.show(res.error);
            });
          }}
        >
          Empty trash…
        </button>
      </div>
      {trash.map((entry) => <TrashEntryRow key={entry.id} entry={entry} />)}
    </div>
  );
}
