import { useRef, useState } from 'react';
import { LoadError } from '../../../components/LoadError';
import { useToast } from '../../../components/Toast';
import type { ShelfData } from '../../../components/useStorageData';
import type { Settings } from '../../../lib/types';
import { TRASH_RETENTION_DAYS } from '../../../lib/constants';
import { buildJsonExport } from '../../../lib/importExport/exportJson';
import type { SettingsPatch } from '../../../lib/messaging';
import { sendCmd } from '../../../lib/messaging';

/** Draft-buffered number field: clamping+saving per keystroke would fight the
 * user mid-typing ("100" → the "1" clamps to 3 and snaps back). Commit on
 * blur/Enter only. Remounted via `key` when the stored value changes. */
function MaxTabsField({
  value,
  save,
}: {
  value: number;
  save: (patch: SettingsPatch) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const n = Math.max(3, Math.min(500, Number(draft) || 25));
    setDraft(String(n));
    if (n !== value) save({ tabLimit: { maxTabs: n } });
  };

  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor="limit-max">Maximum open tabs</label>
      </div>
      <input
        id="limit-max"
        type="number"
        min={3}
        max={500}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

function ExcludedDomainsField({ value, save }: { value: string[]; save: (patch: SettingsPatch) => void }) {
  const [draft, setDraft] = useState(value.join('\n'));
  const commit = () => {
    const domains = [...new Set(draft.split(/[\s,]+/).map((item) => item.trim().toLocaleLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean))].slice(0, 500);
    setDraft(domains.join('\n'));
    save({ excludedDomains: domains });
  };
  return (
    <div className="field field-stack">
      <div className="field-label">
        <label htmlFor="excluded-domains">Never save these domains</label>
        <span className="field-hint">One hostname per line. A rule also excludes its subdomains.</span>
      </div>
      <textarea id="excluded-domains" rows={4} value={draft} placeholder="mail.example.com" onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
    </div>
  );
}

export function SettingsPage({ data }: { data: ShelfData }) {
  const { groups, settings, loading } = data;
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (data.loadError) return <LoadError retry={data.refresh} />;
  if (loading) return <div aria-busy="true" />;

  // Partial patches: the background merges onto current stored settings, so
  // two quick toggles can't overwrite each other with stale snapshots.
  const save = (patch: SettingsPatch) => {
    void sendCmd({ cmd: 'saveSettings', settings: patch }).then((res) => {
      if (!res.ok) toast.show(res.error);
    });
  };

  const exportBackup = () => {
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([buildJsonExport(groups, settings)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `shelf-backup-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    void sendCmd({ cmd: 'markExported' });
    toast.show('Shelf backup exported.');
  };

  const importFile = (file: File) => {
    file.text().then((text) => {
      const isJson = file.name.toLocaleLowerCase().endsWith('.json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
      return sendCmd(isJson ? { cmd: 'importGroups', json: text } : { cmd: 'importOneTab', text });
    }).then((result) => {
      if (result.ok) toast.show(`Imported ${result.imported ?? 0} session${result.imported === 1 ? '' : 's'}.`);
      else toast.show(`Import failed: ${result.error}`);
    }).catch(() => toast.show('Could not read that file.'));
  };

  return (
    <div className="settings">
      <section aria-labelledby="s-general">
        <h2 id="s-general">General</h2>
        <div className="field">
          <div className="field-label">
            <label htmlFor="theme">Theme</label>
          </div>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) => save({ theme: e.target.value as Settings['theme'] })}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="capture-close">Close tabs after saving</label>
            <span className="field-hint">Tabs close only after the local write has been verified.</span>
          </div>
          <input id="capture-close" type="checkbox" checked={settings.captureClosesTabs} onChange={(e) => save({ captureClosesTabs: e.target.checked })} />
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="skip-duplicates">Skip duplicate URLs while saving</label>
            <span className="field-hint">Uses conservative URL equality; tracking parameters are not altered.</span>
          </div>
          <input id="skip-duplicates" type="checkbox" checked={settings.skipDuplicatesOnSave} onChange={(e) => save({ skipDuplicatesOnSave: e.target.checked })} />
        </div>
        <ExcludedDomainsField key={settings.excludedDomains.join('|')} value={settings.excludedDomains} save={save} />
        <div className="field">
          <div className="field-label">
            <label htmlFor="restore-remove">Remove tabs from shelf after restoring</label>
            <span className="field-hint" id="restore-remove-hint">
              Off (default): restoring keeps the saved copy. On: restored items move to trash
              (still undoable for {TRASH_RETENTION_DAYS} days).
            </span>
          </div>
          <input
            id="restore-remove"
            type="checkbox"
            checked={settings.restoreRemovesFromList}
            aria-describedby="restore-remove-hint"
            onChange={(e) => save({ restoreRemovesFromList: e.target.checked })}
          />
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="restore-new-window">Restore groups into a new window</label>
            <span className="field-hint" id="restore-new-window-hint">
              Off (default): restored tabs open in the current window.
            </span>
          </div>
          <input
            id="restore-new-window"
            type="checkbox"
            checked={settings.restoreInNewWindow}
            aria-describedby="restore-new-window-hint"
            onChange={(e) => save({ restoreInNewWindow: e.target.checked })}
          />
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="save-pinned">Include pinned tabs when saving a window</label>
            <span className="field-hint" id="save-pinned-hint">
              Off (default): window and all-window saves leave pinned tabs open. Left/right
              saves always skip pinned tabs.
            </span>
          </div>
          <input
            id="save-pinned"
            type="checkbox"
            checked={settings.savePinnedTabs}
            aria-describedby="save-pinned-hint"
            onChange={(e) => save({ savePinnedTabs: e.target.checked })}
          />
        </div>
        <p className="field-hint">
          Restoring a shelf opens its tabs unloaded — they use no memory until you click them.
        </p>
      </section>

      <section aria-labelledby="s-limit">
        <h2 id="s-limit">Tab limit</h2>
        <div className="field">
          <div className="field-label">
            <label htmlFor="limit-enabled">Limit open tabs per window</label>
            <span className="field-hint" id="limit-enabled-hint">
              When a window goes over the limit, the oldest tabs are saved to a shelf and
              closed. The active tab, pinned tabs, and tabs playing audio are never moved,
              and unloaded (sleeping) tabs don&rsquo;t count toward the limit.
            </span>
          </div>
          <input
            id="limit-enabled"
            type="checkbox"
            checked={settings.tabLimit.enabled}
            aria-describedby="limit-enabled-hint"
            onChange={(e) => save({ tabLimit: { enabled: e.target.checked } })}
          />
        </div>
        {settings.tabLimit.enabled ? <MaxTabsField key={settings.tabLimit.maxTabs} value={settings.tabLimit.maxTabs} save={save} /> : null}
      </section>

      <section aria-labelledby="s-data">
        <h2 id="s-data">Data</h2>
        <p className="field-hint">
          Backups are created locally and contain your saved URLs and titles in plain text.
        </p>
        <div className="settings-actions">
          <button className="btn" onClick={exportBackup}>Export backup</button>
          <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
            Import backup or OneTab file
          </button>
          <button className="btn-ghost" onClick={() => {
            if (!confirm('Move duplicate URLs to Trash? The oldest saved copy will be kept.')) return;
            void sendCmd({ cmd: 'removeDuplicates', keep: 'oldest' }).then((result) => {
              if (result.ok) toast.show(`Moved ${result.removed ?? 0} duplicate tabs to Trash.`);
              else toast.show(result.error);
            });
          }}>Remove duplicate URLs…</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,text/plain,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importFile(file);
            event.target.value = '';
          }}
        />
      </section>

      <section aria-labelledby="s-privacy">
        <h2 id="s-privacy">Privacy</h2>
        <p className="field-hint">
          Shelf stores everything locally on this device. It makes no network requests, has no
          analytics, and requires no account. Uninstalling the extension deletes its data —
          export a JSON file first if you want to keep it.
        </p>
        <p className="field-hint">
          Last full export: {settings.lastExportAt ? new Date(settings.lastExportAt).toLocaleString() : 'Never'}.
        </p>
      </section>

      <section aria-labelledby="s-help">
        <h2 id="s-help">Help</h2>
        <p className="field-hint">
          Use the Shelf toolbar button to save a tab, part of a window, or a whole window. Shelf verifies the local write before closing anything.
        </p>
        <p className="field-hint">
          Restore one tab or a whole session from Shelves. Deleted sessions and tabs remain recoverable in Trash for {TRASH_RETENTION_DAYS} days.
        </p>
        <p className="field-hint">
          Shelf keeps one pinned manager tab available. It uses no account, cloud service, analytics, or external network requests.
        </p>
      </section>
    </div>
  );
}
