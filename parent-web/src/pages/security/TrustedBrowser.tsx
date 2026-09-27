import { Navigate } from 'react-router-dom';

/**
 * The old Parent browser-authority page is retired. Keep a fixed redirect
 * target for legacy deep links while App.tsx removes or redirects the route.
 * This component must not query trust state or invite a Parent to pair a
 * browser. Child-device enrollment uses its separate device flow.
 */
export default function TrustedBrowser() {
  return <Navigate to="/dashboard" replace />;
}
