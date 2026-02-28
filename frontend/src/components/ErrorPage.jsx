import React from 'react';
import { useNavigate } from 'react-router-dom';

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
            {error?.message || "An unexpected error occurred. Please try again."}
          </p>

          {error?.stack && import.meta.env.DEV && (
            <details style={{ marginBottom: '32px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '16px' }}>Error Details (Development)</summary>
              <pre style={{ 
                background: 'var(--bg)', 
                padding: '16px', 
                borderRadius: '8px', 
                overflow: 'auto',
                fontSize: '12px',
                maxHeight: '300px'
              }}>
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