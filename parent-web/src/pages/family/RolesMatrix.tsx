import { useTranslation } from 'react-i18next';
import type { FamilyAction, FamilyRole } from '../../domain/roles';
import { evaluatePermission } from '../../domain/roles';
import { useCurrentRole } from '../../state/AuthContext';

const ROLES: FamilyRole[] = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];

const ACTIONS: FamilyAction[] = [
  'EDIT_CHILD_POLICY',
  'APPROVE_REQUEST',
  'ADD_VIEWER',
  'REMOVE_NON_OWNER_PARENT',
  'ADD_ADMINISTRATOR',
  'CHANGE_ANY_ROLE',
  'CHANGE_RETENTION',
  'DELETE_HISTORY',
  'EXPORT_DATA',
  'VIEW_DEVICE_ENROLLMENT',
  'CREATE_DEVICE_INVITATION',
  'REVOKE_DEVICE_INVITATION',
  'CONFIRM_DEVICE_PAIRING',
  'REMOVE_OR_REVOKE_DEVICE',
  'DISABLE_PROTECTION_POLICY',
  'TRANSFER_OWNERSHIP',
  'REVEAL_RECOVERY_MATERIAL',
  'MANAGE_WELLBEING_MESSAGES',
  'VIEW_BILLING',
  'REQUEST_DEVICE_INCREASE',
  'REQUEST_PARENT_MEMBER_INCREASE',
  'MANAGE_PAYMENT_METHOD',
];

function Cell({ role, action }: { role: FamilyRole; action: FamilyAction }) {
  const { t } = useTranslation();
  const result = evaluatePermission(role, action);
  if (!result.allowed) {
    // The specific "why" (result.reasonKey, localized) surfaces as a native
    // tooltip and in the accessible name -- previously only the generic
    // "Not permitted for your role" was exposed, so hovering/reading a "—"
    // cell couldn't tell a parent WHY that role can't do that action.
    const reasonText = result.reasonKey ? t(result.reasonKey) : t('rbac.denied');
    return (
      <span aria-label={`${t('rbac.denied')}: ${reasonText}`} title={reasonText}>
        —
      </span>
    );
  }
  return (
    <span>
      {t('common.yes')}
      {result.requiresStepUp && <span> ({t('rbac.stepUpRequired')})</span>}
    </span>
  );
}

export default function RolesMatrix() {
  const { t } = useTranslation();
  const currentRole = useCurrentRole();

  return (
    <section aria-labelledby="matrix-title">
      <h1 id="matrix-title">{t('rbac.matrixTitle')}</h1>
      <p>{t('shell.role', { role: t(`roles.${currentRole.toLowerCase()}`) })}</p>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('rbac.deviceActionsHeuristicNotice')}</p>

      <ul
        className="plain-list"
        aria-label={t('rbac.legendTitle')}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', color: 'var(--color-text-muted)' }}
      >
        <li>
          <strong aria-hidden="true">—</strong> {t('rbac.legendDenied')}
        </li>
        <li>
          <strong aria-hidden="true">({t('rbac.stepUpRequired')})</strong> {t('rbac.legendStepUp')}
        </li>
      </ul>

      <div className="card-grid" style={{ marginBlockEnd: '1rem' }}>
        {ROLES.map((role) => (
          <article className="card" key={role}>
            <h2>{t(`roles.${role.toLowerCase()}`)}</h2>
            <p>{t(`rbac.roleExplanation.${role}`)}</p>
          </article>
        ))}
      </div>

      <div className="table-scroll">
        <table className="data-table responsive-cards">
          <thead>
            <tr>
              <th scope="col">{t('rbac.action')}</th>
              {ROLES.map((r) => (
                <th scope="col" key={r}>
                  {t(`roles.${r.toLowerCase()}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((action) => (
              <tr key={action}>
                <th scope="row" style={{ textAlign: 'start', fontWeight: 400 }}>
                  {t(`rbac.actions.${action}`)}
                </th>
                {ROLES.map((role) => (
                  <td key={role} data-label={t(`roles.${role.toLowerCase()}`)}>
                    <Cell role={role} action={action} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
