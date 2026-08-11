import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { RouteGuard } from '../../src/rbac/RouteGuard';
import NotPermitted from '../../src/pages/NotPermitted';
import { renderWithProviders } from '../utils/renderWithProviders';

function EditScreen() {
  return <div>Edit screen content</div>;
}

function TestApp() {
  return (
    <Routes>
      <Route
        path="/children/child-1/screen-time"
        element={
          <RouteGuard action="EDIT_CHILD_POLICY">
            <EditScreen />
          </RouteGuard>
        }
      />
      <Route path="/not-permitted" element={<NotPermitted />} />
    </Routes>
  );
}

describe('RouteGuard', () => {
  it('lets an Owner reach an edit route via direct deep link', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-1/screen-time', role: 'OWNER' });
    expect(await screen.findByText('Edit screen content')).toBeInTheDocument();
  });

  it('blocks a Viewer from reaching an edit route via direct deep link, redirecting to not-permitted', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-1/screen-time', role: 'VIEWER' });
    expect(await screen.findByText('Action not permitted')).toBeInTheDocument();
    expect(screen.queryByText('Edit screen content')).not.toBeInTheDocument();
  });

  it('blocks a Child from reaching an edit route via direct deep link', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-1/screen-time', role: 'CHILD' });
    expect(await screen.findByText('Action not permitted')).toBeInTheDocument();
  });
});
