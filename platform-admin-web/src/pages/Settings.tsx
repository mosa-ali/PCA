import { ComingSoon } from '../components/common/ComingSoon';

export default function Settings() {
  return (
    <ComingSoon
      titleKey="nav.settings"
      backendGapNote="No HTTP route exposes platform settings (FREE_STARTER defaults, commercial-market mapping, enabled currencies, feature flags, notification defaults) for read or administration yet."
    />
  );
}
