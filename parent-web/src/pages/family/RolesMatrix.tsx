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
  'REMOVE_OR_REVOKE_DEVICE',
  'DISABLE_PROTECTION_POLICY',
  'TRANSFER_OWNERSHIP',
  'REVEAL_RECOVERY_MATERIAL',
  'MANAGE_WELLBEING_MESSAGES',
];

function Cell({ role, action }: { role: FamilyRole; action: FamilyAction }) {
  const { t } = useTranslation();
  const result = evaluatePermission(role, action);
  if (!result.allowed) {
    return <span aria-label={t('rbac.denied')}>—</span>;
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
      <div className="table-scroll">
        <table className="data-table">
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
                  <td key={role}>
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
