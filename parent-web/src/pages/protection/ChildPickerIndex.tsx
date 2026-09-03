import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { AsyncStates } from '../../components/common/States';

/**
 * CHILD-PICKER INDEX -- the family-level way in to three per-child settings.
 *
 * Screen Time, Apps & Web and Schedules are things a parent thinks of as
 * family-level, but every one of them is a PER-CHILD route and there is no
 * family-level API behind any of them. Rather than invent a family-level
 * aggregate that no data supports, this page is honest about the shape of the
 * thing: choose a child, then set that child's rules.
 *
 * One component, three instances (App.tsx). A read that fails closed renders
 * the action-needed state, never "Something went wrong" -- in real
 * (non-fixture) mode `getDashboard()` always throws by design, and this page
 * would otherwise announce a working console as broken.
 */
interface ChildPickerIndexProps {
  /** i18n key for the page's own <h1>. */
  titleKey: string;
  /** i18n key for the one-line explanation under it. */
  introKey: string;
  /** Where a chosen child leads. */
  childHref: (childId: string) => string;
}

export function ChildPickerIndex({ titleKey, introKey, childHref }: ChildPickerIndexProps) {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getDashboard(), []);
  const children = data?.children ?? [];

  return (
    <section aria-labelledby="protection-index-title">
      <h1 id="protection-index-title">{t(titleKey)}</h1>
      <p>{t(introKey)}</p>
      <AsyncStates loading={loading} error={error} empty={data !== null && children.length === 0} onRetry={reload}>
        <h2>{t('protectionIndex.pickChild')}</h2>
        <div className="card-grid">
          {children.map((child) => (
            <article className="card card-interactive" key={child.childId}>
              <h3 className="card-title">
                <Link to={childHref(child.childId)}>
                  {/* A child's display name is user data: `<bdi class="iso">`
                      keeps a Latin name from reordering the Arabic UI. */}
                  <bdi className="iso">{child.displayName}</bdi>
                </Link>
              </h3>
            </article>
          ))}
        </div>
      </AsyncStates>
    </section>
  );
}
