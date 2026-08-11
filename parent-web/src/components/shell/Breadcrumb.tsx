import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

export function Breadcrumb() {
  const { t } = useTranslation();
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol style={{ display: 'flex', gap: '0.4rem', listStyle: 'none', padding: 0, margin: 0, flexWrap: 'wrap' }}>
        <li>
          <Link to="/dashboard">{t('shell.breadcrumbHome')}</Link>
        </li>
        {segments.map((seg, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          const label = seg
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
          return (
            <li key={path} aria-current={isLast ? 'page' : undefined}>
              <span aria-hidden="true"> / </span>
              {isLast ? <span>{label}</span> : <Link to={path}>{label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
