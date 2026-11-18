import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/mobile.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#e8e8ec', background: '#1a1a20', height: '100dvh' }}>
          <h2>Something went wrong</h2>
          <pre style={{ color: '#ff4444', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
