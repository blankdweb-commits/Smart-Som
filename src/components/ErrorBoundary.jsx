import React from 'react';

// Catches render errors in the child tree and shows a friendly recovery screen
// instead of a blank page. Users can retry or reload.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Keep the global error transparent; don't silently swallow debugging.
    if (this.props.onError) this.props.onError(error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center text-3xl mb-4">
          ⚠️
        </div>
        <h2 className="text-xl font-black text-slate-900 dark:text-white">Something went wrong here</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-2 max-w-sm">
          A small hiccup loading this view. Your progress is safe — try again.
        </p>
        <div className="flex gap-3 mt-6">
          <button
            onClick={this.handleReset}
            className="px-5 py-2.5 bg-apex-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-apex-700 active:scale-95 transition-all"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
