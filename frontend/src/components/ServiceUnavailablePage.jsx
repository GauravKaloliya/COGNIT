import React, { useState } from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';

export default function ServiceUnavailablePage({ error, onRetry, isRetrying }) {
  const [retryCount, setRetryCount] = useState(0);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
    if (onRetry) onRetry();
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>C.O.G.N.I.T.</h1>
          <p className="subtitle">Consortium for Observational Neurocognitive and Generative Image Technology</p>
        </div>
      </header>

      <div className="panel">
        <div className="page-hero">
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 className="hero-title warning">Something Went Wrong</h1>
          <h2 className="hero-subtitle">Service Unavailable</h2>
          <p className="hero-message">
            {error || getErrorMessage('SYS_001_0004')}
          </p>

          <div
            style={{
              background: 'var(--accent-bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.25rem 1.5rem',
              marginBottom: '2rem',
              textAlign: 'left',
            }}
          >
            <p style={{ fontWeight: 'var(--font-semibold)', marginBottom: '0.5rem', color: 'var(--text)' }}>
              What you can try:
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--muted)', lineHeight: 'var(--leading-relaxed)' }}>
              <li>Check your internet connection</li>
              <li>Refresh the page and try again</li>
              <li>Wait a few minutes and retry if the issue persists</li>
              <li>Contact support if the problem continues</li>
            </ul>
          </div>

          <div className="page-actions">
            <button
              className="primary"
              onClick={handleRetry}
              disabled={isRetrying}
              style={{ minWidth: '140px' }}
            >
              {isRetrying ? (
                <>
                  <span className="spinner" style={{ width: '16px', height: '16px', marginRight: '0.5rem', display: 'inline-block', verticalAlign: 'middle' }} />
                  Checking...
                </>
              ) : (
                `Retry${retryCount > 0 ? ` (${retryCount})` : ''}`
              )}
            </button>
            <button className="ghost" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </div>
        </div>
      </div>

      <div className="branding-footer">Created by Gaurav Kaloliya</div>
    </div>
  );
}
