import { useEffect, useState } from 'react';
import { ToastProvider, useToast } from '../../components/Toast';
import type { CaptureScope } from '../../lib/services/capture';
import { sendCmd } from '../../lib/messaging';
import * as repo from '../../lib/storage/repo';
import type { SavedGroup } from '../../lib/types';

const SAVE_ACTIONS: { scope: CaptureScope; label: string }[] = [
  { scope: 'tab', label: 'Save this tab' },
  { scope: 'left', label: 'Save tabs to the left' },
  { scope: 'right', label: 'Save tabs to the right' },
  { scope: 'window', label: 'Save this window' },
  { scope: 'selected', label: 'Save highlighted tabs' },
  { scope: 'group', label: 'Save active tab group' },
  { scope: 'others', label: 'Save other tabs' },
  { scope: 'all-windows', label: 'Save all windows' },
];

function PopupInner() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [closeOriginals, setCloseOriginals] = useState(true);
  const [destinationGroupId, setDestinationGroupId] = useState('');
  const [groups, setGroups] = useState<SavedGroup[]>([]);

  useEffect(() => {
    void repo.ensureReady().then(async () => {
      const [settings, savedGroups] = await Promise.all([
        repo.getSettings(), repo.getAllGroups(),
      ]);
      setCloseOriginals(settings.captureClosesTabs);
      setGroups(savedGroups);
    });
  }, []);

  const save = (scope: CaptureScope) => {
    setBusy(true);
    void sendCmd({
      cmd: 'capture', scope, closeOriginals,
      destinationGroupId: destinationGroupId || undefined,
    }).then((res) => {
      setBusy(false);
      if (res.ok && res.capture) {
        if (res.capture.saved === 0) toast.show('Nothing to save.');
        else toast.show(`Saved ${res.capture.saved} tab${res.capture.saved === 1 ? '' : 's'}${res.capture.closed ? ` and closed ${res.capture.closed}` : ''}.`);
      } else if (!res.ok) {
        toast.show(res.error);
      }
    });
  };

  return (
    <div className="popup">
      <div className="popup-header">
        <h1>
          <img src="/icon/32.png" width={18} height={18} alt="" /> Shelf
        </h1>
      </div>

      <div className="popup-actions">
        {SAVE_ACTIONS.slice(0, 4).map(({ scope, label }) => (
          <button key={scope} className="btn" disabled={busy} onClick={() => save(scope)}>
            {label}
          </button>
        ))}
      </div>
      <details className="popup-more">
        <summary>More save options</summary>
        <div className="popup-actions">
          {SAVE_ACTIONS.slice(4).map(({ scope, label }) => (
            <button key={scope} className="btn" disabled={busy} onClick={() => save(scope)}>{label}</button>
          ))}
        </div>
        <label className="popup-field">
          Add to session
          <select value={destinationGroupId} onChange={(e) => setDestinationGroupId(e.target.value)}>
            <option value="">Create a new session</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
      </details>
      <label className="popup-check">
        <input type="checkbox" checked={closeOriginals} onChange={(e) => setCloseOriginals(e.target.checked)} />
        Close tabs after verified save
      </label>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <PopupInner />
    </ToastProvider>
  );
}
