import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../../i18n';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * App-level error boundary. Platform Administration never renders family
 * activity content (Section 23 privacy hard gate), so a caught render
 * error here is a genuine app/config defect, not a data-shape surprise --
 * safe to log operator-facing detail.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- intentional operator-facing diagnostic
    console.error('PCA Platform Administration: unrecoverable app error', error, info.componentStack);
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
