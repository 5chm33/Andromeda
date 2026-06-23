/**
 * PanelErrorBoundary.tsx — v5.32
 *
 * Lightweight error boundary for individual search panels.
 * Unlike the global ErrorBoundary, this catches errors per-panel
 * so one panel crash doesn't take down the entire search page.
 */

import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  panelName: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[PanelErrorBoundary] ${this.props.panelName} crashed:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={16} />
            <span className="font-medium">{this.props.panelName} encountered an error</span>
          </div>
          <p className="text-xs text-muted-foreground max-w-md text-center">
            {this.state.error?.message || "An unexpected error occurred in this panel."}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
          >
            <RotateCcw size={12} />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
