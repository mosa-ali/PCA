import { useTranslation } from 'react-i18next';
import DevicesTabs from './devices/DevicesTabs';

/**
 * `/family/devices`.
 *
 * The page itself is now only its heading plus the section switcher: the six
 * workflows that used to be stacked here (create invitation, invitations list,
 * confirm pairing, Administration PIN, request a parent decision, pending and
 * decided requests) live in `./devices/*`, one section at a time, selected by
 * the `?section=` query parameter -- no new route, no nav change.
 *
 * The `<h1>` accessible name stays exactly "Devices": it is pinned by
 * `e2e/device-enrollment.spec.ts` and `e2e/responsive.spec.ts`.
 */
export default function Devices() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="devices-title">
      <h1 id="devices-title">{t('nav.devices')}</h1>
      <DevicesTabs />
    </section>
  );
}
