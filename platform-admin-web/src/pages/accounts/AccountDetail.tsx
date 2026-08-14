import { ComingSoon } from '../../components/common/ComingSoon';

export default function AccountDetail() {
  return (
    <ComingSoon
      titleKey="nav.accounts"
      backendGapNote="No HTTP route exists for single-account detail, suspend, or reactivate (e.g. GET/POST /platform-admin/accounts/:id). No account-actions endpoint exists server-side yet."
    />
  );
}
