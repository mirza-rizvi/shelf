import { TRASH_RETENTION_DAYS } from '../../../lib/constants';

/** Local, zero-network help page (OneTab's "Help" opens their website; ours
 * ships with the extension so nothing ever leaves the device). */
export function HelpPage() {
  return (
    <div className="settings help">
      <section aria-labelledby="h-saving">
        <h2 id="h-saving">Saving tabs</h2>
        <p className="field-hint">
          Click the Shelf icon in Chrome&rsquo;s toolbar, then save this tab, the tabs to its
          left or right, or the whole window. Saved tabs close only after Shelf has verified
          they are safely stored — a crash can duplicate a tab, never lose one.
        </p>
      </section>

      <section aria-labelledby="h-restoring">
        <h2 id="h-restoring">Restoring</h2>
        <p className="field-hint">
          Click a saved tab to reopen it, or restore a whole shelf. Restoring a shelf opens
          its tabs unloaded — they use no memory until you click them. By default restoring
          keeps the saved copy; change that in Settings, or use &ldquo;Restore &amp;
          remove&rdquo;.
        </p>
      </section>

      <section aria-labelledby="h-pinned">
        <h2 id="h-pinned">The pinned Shelf tab</h2>
        <p className="field-hint">
          Shelf lives in this pinned tab at the far left of your tab strip, like OneTab&rsquo;s
          tab. It&rsquo;s intentional and self-repairing: unpin it and it re-pins, close it and
          it comes right back. Closing its whole window lets it go — it returns with your
          next window. Your saved tabs are always one click away.
        </p>
      </section>

      <section aria-labelledby="h-limit">
        <h2 id="h-limit">Tab limit</h2>
        <p className="field-hint">
          Optional (Settings): when a window goes over your limit, the oldest tabs are saved
          to a shelf and closed. The active tab, pinned tabs, tabs playing audio, and
          unloaded (sleeping) tabs are never touched.
        </p>
      </section>

      <section aria-labelledby="h-import">
        <h2 id="h-import">Import &amp; export</h2>
        <p className="field-hint">
          The More menu on the Shelves page exports everything as JSON (full fidelity) or
          OneTab-compatible text, and imports both — including a real OneTab export.
          Uninstalling the extension deletes its local data, so export first.
        </p>
      </section>

      <section aria-labelledby="h-trash">
        <h2 id="h-trash">Trash &amp; undo</h2>
        <p className="field-hint">
          Every delete goes to Trash and is undoable for {TRASH_RETENTION_DAYS} days before
          being purged automatically.
        </p>
      </section>

      <section aria-labelledby="h-privacy">
        <h2 id="h-privacy">Privacy</h2>
        <p className="field-hint">
          Everything stays on this device. Shelf makes zero network requests — no account, no
          cloud, no analytics. Even site icons come from Chrome&rsquo;s local cache. Verify it
          yourself: open DevTools on this page and watch the Network tab stay empty.
        </p>
      </section>
    </div>
  );
}
