import { useEffect } from 'react';
import { ToastProvider } from '../../components/Toast';
import { useHashRoute } from '../../components/useHashRoute';
import { useStorageData } from '../../components/useStorageData';
import { HelpPage } from './pages/Help';
import { Home } from './pages/Home';
import { SettingsPage } from './pages/Settings';
import { TrashPage } from './pages/Trash';

export default function App() {
  const route = useHashRoute();
  const data = useStorageData();

  // The tab is permanently pinned — a route-aware title is the only way its
  // tooltip/window list reflects where the user is.
  useEffect(() => {
    document.title =
      route.path === '/trash'
        ? 'Shelf — Trash'
        : route.path === '/settings'
          ? 'Shelf — Settings'
          : route.path === '/help'
            ? 'Shelf — Help'
            : 'Shelf';
  }, [route.path]);

  return (
    <ToastProvider>
      <div className="manager">
        <header className="manager-header">
          <h1>
            <img src="/icon/32.png" width={22} height={22} alt="" /> Shelf
          </h1>
          <nav className="manager-nav" aria-label="Main">
            <a href="#/" aria-current={route.path === '/' ? 'page' : undefined}>
              Shelves
            </a>
            <a href="#/trash" aria-current={route.path === '/trash' ? 'page' : undefined}>
              Trash{data.trash.length > 0 ? ` (${data.trash.length})` : ''}
            </a>
            <a href="#/settings" aria-current={route.path === '/settings' ? 'page' : undefined}>
              Settings
            </a>
            <a href="#/help" aria-current={route.path === '/help' ? 'page' : undefined}>
              Help
            </a>
          </nav>
        </header>
        {route.path === '/settings' ? (
          <SettingsPage data={data} />
        ) : route.path === '/trash' ? (
          <TrashPage data={data} />
        ) : route.path === '/help' ? (
          <HelpPage />
        ) : (
          <Home data={data} />
        )}
      </div>
    </ToastProvider>
  );
}
