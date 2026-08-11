import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Breadcrumb } from './Breadcrumb';
import { DemoBanner } from '../common/DemoBanner';

export function AppLayout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a href="#main-content" className="skip-link">
        {t('app.skipToContent')}
      </a>
      <Sidebar collapsed={collapsed} drawerOpen={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
      {drawerOpen && (
        <div
          className="drawer-scrim"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        />
      )}
      <div className="main-column">
        <Header
          onToggleSidebar={() => setCollapsed((c) => !c)}
          onToggleDrawer={() => setDrawerOpen((d) => !d)}
          sidebarCollapsed={collapsed}
        />
        <DemoBanner />
        <Breadcrumb />
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
