import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CHILD_SUB_NAV } from '../../nav/navConfig';

export default function ChildLayout() {
  const { t } = useTranslation();
  const { childId } = useParams();

  return (
    <section aria-labelledby="child-layout-title">
      <h1 id="child-layout-title">{childId}</h1>
      <nav aria-label={t('nav.children')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBlock: '1rem' }}>
        {CHILD_SUB_NAV.map((item) => (
          <NavLink
            key={item.path}
            to={`/children/${childId}/${item.path}`}
            className="btn"
            style={({ isActive }) => (isActive ? { background: 'var(--color-brand-strong)' } : undefined)}
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
