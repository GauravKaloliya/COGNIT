import React from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';

export default function ServiceUnavailablePage({ error }) {
  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>C.O.G.N.I.T.</h1>
          <p className="subtitle">Describe each image with as much detail as possible</p>
        </div>
      </header>

      <div className="panel">
        <div className="page-hero">
          <div className="service-unavailable-icon">⚠️</div>
          <h1 className="hero-title warning">Something Went Wrong</h1>
          <h2 className="hero-subtitle">Service Unavailable</h2>
          <p className="hero-message">
            {error || getErrorMessage('SYS_001_0004')}
          </p>

          <div className="service-unavailable-card">
            <p className="service-unavailable-card-title">
              What you can try:
            </p>
            <ul className="service-unavailable-list">
              <li>Check your internet connection</li>
              <li>Refresh the page and try again</li>
              <li>Wait a few minutes and retry if the issue persists</li>
              <li>Contact support if the problem continues</li>
            </ul>
          </div>

          <div className="page-actions">
            <button className="primary" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </div>
        </div>
      </div>

      <div className="branding-footer">Created by Gaurav Kaloliya</div>
    </div>
  );
}
