import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../../i18n';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * App-level error boundary. Wraps everything that can call
 * ../../api/client.ts:getApiClients() at render time (AuthProvider,
 * StepUpProvider, every page). getApiClients() deliberately has no
 * catch-all around real-client construction (see ./client.ts) -- a
 * genuinely unexpected construction failure (a programmer error, not the
 * expected "no backend yet" condition, which is handled per-interface by
 * the Unavailable* providers) must surface here as a visible configuration
 * error, never be silently swallowed into a working-looking fixture demo.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No PII/family content ever reaches this path (it is a
    // construction/render error, not user data) -- safe to log for
    // operators.
    // eslint-disable-next-line no-console -- intentional operator-facing diagnostic
    console.error('PCA Parent Console: unrecoverable app error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card app-config-error" role="alert">
          <h1>{i18n.t('errorBoundary.title')}</h1>
          <p>{i18n.t('errorBoundary.body')}</p>
          <p className="app-config-error-detail">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
