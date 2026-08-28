import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../api/platformAdminApiClient';
import type { PagedResult } from '../domain/accounts';
import { PLATFORM_ADMIN_ROLES, type PlatformAdminRole } from '../domain/roles';
import type { AdminUserSummary, CreatedAdminUser } from '../domain/adminUsers';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorState } from '../components/common/ErrorState';
import { PermissionGate } from '../rbac/PermissionGate';
import { useStepUp } from '../state/StepUpContext';
import { useToast } from '../state/ToastContext';

const PAGE_SIZE = 20;

const MFA_STATUS_BADGE_CLASS: Record<'PENDING_SETUP' | 'ACTIVE' | 'DISABLED' | 'NONE', string> = {
  ACTIVE: 'badge-success',
  DISABLED: 'badge-danger',
  PENDING_SETUP: 'badge-warning',
  NONE: '',
};

function CreateAdminForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<PlatformAdminRole>('SUPPORT_ADMIN');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !email.includes('@') || password.length < 12) {
      notify(t('adminUsers.invalidCreateForm'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const stepUpId = await requestStepUp('ADMIN_ROLE_GRANT');
      if (!stepUpId) return;
      const created = await platformAdminApi.post<CreatedAdminUser>('/platform-admin/admin-users', {
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        role,
        stepUpId,
      });
      notify(t('adminUsers.created', { name: created.displayName }), 'success');
      setDisplayName('');
      setEmail('');
      setPassword('');
      onCreated();
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <label htmlFor="new-admin-name">{t('adminUsers.displayName')}</label>
      <input id="new-admin-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={128} required />
      <label htmlFor="new-admin-email">{t('login.emailLabel')}</label>
      <input id="new-admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} required />
      <label htmlFor="new-admin-password">{t('adminUsers.password')}</label>
      <input id="new-admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={256} required />
      <p className="field-hint">{t('adminUsers.passwordHint')}</p>
      <label htmlFor="new-admin-role">{t('adminUsers.role')}</label>
      <select id="new-admin-role" value={role} onChange={(e) => setRole(e.target.value as PlatformAdminRole)}>
        {PLATFORM_ADMIN_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
      <div className="actions-row">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {t('adminUsers.createAdmin')}
        </button>
      </div>
    </form>
  );
}

function AdminRow({ admin, onChanged }: { admin: AdminUserSummary; onChanged: () => void }) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const [expanded, setExpanded] = useState(false);
  const [grantRole, setGrantRole] = useState<PlatformAdminRole>('SUPPORT_ADMIN');
  const [busy, setBusy] = useState(false);

  const withStepUp = async (action: (stepUpId: string) => Promise<void>) => {
    setBusy(true);
    try {
      const stepUpId = await requestStepUp('ADMIN_ROLE_GRANT');
      if (!stepUpId) return;
      await action(stepUpId);
      onChanged();
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const grant = () =>
    withStepUp(async (stepUpId) => {
      await platformAdminApi.post(`/platform-admin/admin-users/${encodeURIComponent(admin.adminId)}/roles`, { role: grantRole, action: 'GRANT', stepUpId });
      notify(t('adminUsers.roleGranted'), 'success');
    });

  const revoke = (role: PlatformAdminRole) =>
    withStepUp(async (stepUpId) => {
      await platformAdminApi.post(`/platform-admin/admin-users/${encodeURIComponent(admin.adminId)}/roles`, { role, action: 'REVOKE', stepUpId });
      notify(t('adminUsers.roleRevoked'), 'success');
    });

  const disable = () =>
    withStepUp(async (stepUpId) => {
      await platformAdminApi.post(`/platform-admin/admin-users/${encodeURIComponent(admin.adminId)}/disable`, { stepUpId });
      notify(t('adminUsers.disabled'), 'success');
    });

  const reactivate = () =>
    withStepUp(async (stepUpId) => {
      await platformAdminApi.post(`/platform-admin/admin-users/${encodeURIComponent(admin.adminId)}/reactivate`, { stepUpId });
      notify(t('adminUsers.reactivated'), 'success');
    });

  const revokeSessions = () =>
    withStepUp(async (stepUpId) => {
      await platformAdminApi.post(`/platform-admin/admin-users/${encodeURIComponent(admin.adminId)}/sessions/revoke-all`, { stepUpId });
      notify(t('adminUsers.sessionsRevoked'), 'success');
    });

  return (
    <>
      <tr>
        <td>{admin.adminId}</td>
        <td>{admin.displayName}</td>
        <td>{admin.status === 'ACTIVE' ? <span className="badge badge-success">{t('adminUsers.active')}</span> : <span className="badge badge-danger">{t('adminUsers.disabledStatus')}</span>}</td>
        <td>{admin.roles.map((r) => t(`roles.${r}`)).join(', ')}</td>
        <td>
          <span className={`badge ${MFA_STATUS_BADGE_CLASS[admin.mfaStatus ?? 'NONE']}`}>{t(`adminUsers.mfaStatuses.${admin.mfaStatus ?? 'NONE'}`)}</span>
        </td>
        <td>
          <PermissionGate operation="ASSIGN_ADMIN_ROLE">
            <button type="button" className="btn" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? t('common.hide') : t('adminUsers.manage')}
            </button>
          </PermissionGate>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}>
            <div className="card" style={{ margin: 0 }}>
              <h3 className="section-title">{t('adminUsers.manageTitle', { name: admin.displayName })}</h3>
              <div className="actions-row">
                <select aria-label={t('adminUsers.role')} value={grantRole} onChange={(e) => setGrantRole(e.target.value as PlatformAdminRole)}>
                  {PLATFORM_ADMIN_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" disabled={busy} onClick={grant}>
                  {t('adminUsers.grantRole')}
                </button>
              </div>
              <div className="actions-row">
                {admin.roles.map((r) => (
                  <button key={r} type="button" className="btn" disabled={busy} onClick={() => revoke(r)}>
                    {t('adminUsers.revokeRole', { role: t(`roles.${r}`) })}
                  </button>
                ))}
              </div>
              <div className="actions-row">
                {admin.status === 'ACTIVE' ? (
                  <button type="button" className="btn" disabled={busy} onClick={disable}>
                    {t('adminUsers.disable')}
                  </button>
                ) : (
                  <button type="button" className="btn" disabled={busy} onClick={reactivate}>
                    {t('adminUsers.reactivate')}
                  </button>
                )}
                <button type="button" className="btn" disabled={busy} onClick={revokeSessions}>
                  {t('adminUsers.revokeSessions')}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminUsers() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'DISABLED'>('');
  const [nameQuery, setNameQuery] = useState('');
  const [emailQuery, setEmailQuery] = useState('');
  const [appliedNameQuery, setAppliedNameQuery] = useState('');
  const [appliedEmailQuery, setAppliedEmailQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PagedResult<AdminUserSummary>>('/platform-admin/admin-users', {
        limit: PAGE_SIZE,
        offset,
        status: statusFilter || undefined,
        name: appliedNameQuery || undefined,
        email: appliedEmailQuery || undefined,
      })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [offset, statusFilter, appliedNameQuery, appliedEmailQuery]);

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setAppliedNameQuery(nameQuery.trim());
    setAppliedEmailQuery(emailQuery.trim());
  };

  return (
    <div className="page">
      <h1>{t('nav.adminUsers')}</h1>

      <PermissionGate operation="MANAGE_ADMIN_ACCOUNTS">
        <section className="card">
          <button type="button" className="btn" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
            {showCreate ? t('common.hide') : t('adminUsers.createAdmin')}
          </button>
          {showCreate && <CreateAdminForm onCreated={() => { setShowCreate(false); load(); }} />}
        </section>
      </PermissionGate>

      <form className="filters" onSubmit={onSearchSubmit}>
        <div>
          <label htmlFor="admin-status">{t('adminUsers.status')}</label>
          <select id="admin-status" value={statusFilter} onChange={(e) => { setOffset(0); setStatusFilter(e.target.value as '' | 'ACTIVE' | 'DISABLED'); }}>
            <option value="">{t('common.all')}</option>
            <option value="ACTIVE">{t('adminUsers.active')}</option>
            <option value="DISABLED">{t('adminUsers.disabledStatus')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="admin-name-search">{t('adminUsers.nameSearchLabel')}</label>
          <input id="admin-name-search" value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} maxLength={128} />
        </div>
        <div>
          <label htmlFor="admin-email-search">{t('adminUsers.emailSearchLabel')}</label>
          <input id="admin-email-search" type="email" value={emailQuery} onChange={(e) => setEmailQuery(e.target.value)} maxLength={255} title={t('adminUsers.emailSearchHint')} />
        </div>
        <button type="submit" className="btn">
          {t('common.applyFilters')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && <p className="status-unavailable">{t('common.empty')}</p>}

      {!loading && !error && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('adminUsers.adminId')}</th>
                <th scope="col">{t('adminUsers.displayName')}</th>
                <th scope="col">{t('adminUsers.status')}</th>
                <th scope="col">{t('adminUsers.role')}</th>
                <th scope="col">{t('adminUsers.mfaStatus')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((admin) => (
                <AdminRow key={admin.adminId} admin={admin} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button type="button" className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          {t('common.previous')}
        </button>
        <span>{t('common.pageInfo', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
        <button type="button" className="btn" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}
