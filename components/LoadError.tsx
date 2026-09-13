/** Storage-read failure state. Must never look like an empty shelf — an empty
 * state after a failed read tells the user their data is gone when it isn't. */
export function LoadError({ retry }: { retry: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <h2>Couldn&rsquo;t read Shelf&rsquo;s storage</h2>
      <p>Your saved tabs are untouched — this page just failed to load them.</p>
      <div className="empty-actions">
        <button className="btn btn-primary" onClick={retry}>
          Try again
        </button>
      </div>
    </div>
  );
}
