import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../utils/errorRegistry.js';

export default function ErrorPage({ error, resetError }) {
  const navigate = useNavigate();

  const handleReset = () => {
    if (resetError) {
      resetError();
    } else {
      navigate('/');
    }
  };

  return (
    <div className="app error-page-centered">
      <div className="panel">
        <div className="page-hero">
          <h1 className="hero-title warning">Oops!</h1>
          <h2 className="hero-subtitle">Something went wrong</h2>
          <p className="hero-message">
            {error?.message || getErrorMessage('SYS_002_0017')}
          </p>

          {error?.stack && import.meta.env.DEV && (
            <details className="error-details">
              <summary className="error-details-summary">Error Details</summary>
              <pre className="error-details-pre">
                {error.stack}
              </pre>
            </details>
          )}

          <div className="page-actions">
            <button className="primary" onClick={handleReset}>
              Try Again
            </button>
            <button className="ghost" onClick={() => { if (resetError) resetError(); navigate('/'); }}>
              Go Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
