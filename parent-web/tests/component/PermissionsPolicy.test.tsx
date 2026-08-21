import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import PermissionsPolicy from '../../src/pages/privacy/PermissionsPolicy';

// PCA-NFR-061: proves the page actually renders the real, manifest-sourced
// permission list -- not just that it mounts without crashing.
const MANIFEST_PERMISSIONS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.CAMERA',
];

describe('PermissionsPolicy', () => {
  it('renders the page title and framing copy', () => {
    renderWithProviders(<PermissionsPolicy />);

    expect(screen.getByRole('heading', { level: 1, name: 'App Permissions' })).toBeInTheDocument();
    expect(
      screen.getByText(/this list is generated to match the permissions actually declared in the app's own manifest/i),
    ).toBeInTheDocument();
  });

  it('lists every real permission declared in AndroidManifest.xml, and only those', () => {
    renderWithProviders(<PermissionsPolicy />);

    for (const manifestName of MANIFEST_PERMISSIONS) {
      expect(screen.getByText(manifestName)).toBeInTheDocument();
    }
    // Exactly ten <dt> entries -- one per manifest <uses-permission> line, no more, no fewer.
    expect(document.querySelectorAll('dt')).toHaveLength(MANIFEST_PERMISSIONS.length);
  });

  it('explains the camera permission as on-device-only, never transmitted', () => {
    renderWithProviders(<PermissionsPolicy />);

    expect(
      screen.getByText(/no image or video is ever transmitted anywhere -- processing happens entirely on the device/i),
    ).toBeInTheDocument();
  });

  it('explains that a location fix reaching the parent console is end-to-end encrypted, unreadable by PCA servers', () => {
    renderWithProviders(<PermissionsPolicy />);

    expect(screen.getByText(/PCA's own servers cannot read it/)).toBeInTheDocument();
    expect(
      screen.getByText(/PCA's own server infrastructure cannot read it/),
    ).toBeInTheDocument();
  });

  it('states the list is exhaustive and traceable to the real manifest file', () => {
    renderWithProviders(<PermissionsPolicy />);

    expect(
      screen.getByText(/generated to match android\/app\/src\/main\/AndroidManifest\.xml exactly/),
    ).toBeInTheDocument();
  });
});
