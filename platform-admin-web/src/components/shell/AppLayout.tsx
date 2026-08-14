import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        {t('app.skipToContent')}
      </a>
      <Sidebar drawerOpen={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
      {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} role="presentation" />}
      <div className="main-column">
        <Header onToggleDrawer={() => setDrawerOpen((d) => !d)} />
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
