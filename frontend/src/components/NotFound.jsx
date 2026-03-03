import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>C.O.G.N.I.T.</h1>
        </div>
      </header>
      <div className="panel">
        <div className="page-hero">
          <div className="not-found-dog">
            <svg viewBox="0 0 200 240" role="img" aria-label="Cute full body dog illustration">
              <defs>
                <linearGradient id="dogBody" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f9d6a5" />
                  <stop offset="100%" stopColor="#e8b87a" />
                </linearGradient>
                <linearGradient id="dogEar" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#d4956f" />
                  <stop offset="100%" stopColor="#c47a5a" />
                </linearGradient>
                <linearGradient id="dogBelly" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fff5e6" />
                  <stop offset="100%" stopColor="#f9e8d0" />
                </linearGradient>
              </defs>
              {/* Tail */}
              <path d="M140 160c20 -15 35 -5 30 15c-5 15 -25 10 -30 -5" fill="#e8b87a" stroke="#d4956f" strokeWidth="2"/>
              {/* Back legs */}
              <ellipse cx="60" cy="195" rx="18" ry="25" fill="#e8b87a"/>
              <ellipse cx="140" cy="195" rx="18" ry="25" fill="#e8b87a"/>
              {/* Body */}
              <ellipse cx="100" cy="155" rx="55" ry="50" fill="url(#dogBody)"/>
              {/* Belly patch */}
              <ellipse cx="100" cy="160" rx="30" ry="35" fill="url(#dogBelly)"/>
              {/* Front legs */}
              <ellipse cx="75" cy="200" rx="14" ry="22" fill="#f9d6a5"/>
              <ellipse cx="125" cy="200" rx="14" ry="22" fill="#f9d6a5"/>
              {/* Paws */}
              <ellipse cx="75" cy="215" rx="16" ry="12" fill="#fff5e6"/>
              <ellipse cx="125" cy="215" rx="16" ry="12" fill="#fff5e6"/>
              <ellipse cx="60" cy="210" rx="14" ry="10" fill="#fff5e6"/>
              <ellipse cx="140" cy="210" rx="14" ry="10" fill="#fff5e6"/>
              {/* Collar */}
              <rect x="65" y="105" width="70" height="12" rx="6" fill="#ff6b6b"/>
              <circle cx="100" cy="118" r="8" fill="#ffd93d"/>
              {/* Head */}
              <circle cx="100" cy="75" r="45" fill="url(#dogBody)"/>
              {/* Ears - floppy */}
              <ellipse cx="45" cy="65" rx="22" ry="35" fill="url(#dogEar)" transform="rotate(-20 45 65)"/>
              <ellipse cx="155" cy="65" rx="22" ry="35" fill="url(#dogEar)" transform="rotate(20 155 65)"/>
              {/* Inner ears */}
              <ellipse cx="48" cy="70" rx="12" ry="22" fill="#f7b0a1" transform="rotate(-20 48 70)"/>
              <ellipse cx="152" cy="70" rx="12" ry="22" fill="#f7b0a1" transform="rotate(20 152 70)"/>
              {/* Eyes */}
              <ellipse cx="80" cy="70" rx="10" ry="12" fill="#3b2f2f"/>
              <ellipse cx="120" cy="70" rx="10" ry="12" fill="#3b2f2f"/>
              {/* Eye highlights */}
              <circle cx="83" cy="66" r="4" fill="#ffffff"/>
              <circle cx="123" cy="66" r="4" fill="#ffffff"/>
              <circle cx="78" cy="74" r="2" fill="#ffffff" opacity="0.5"/>
              <circle cx="118" cy="74" r="2" fill="#ffffff" opacity="0.5"/>
              {/* Snout */}
              <ellipse cx="100" cy="90" rx="18" ry="14" fill="#f9e8d0"/>
              {/* Nose */}
              <ellipse cx="100" cy="85" rx="8" ry="6" fill="#3b2f2f"/>
              <ellipse cx="100" cy="83" rx="3" ry="2" fill="#5a4a4a" opacity="0.5"/>
              {/* Mouth */}
              <path d="M92 95c4 6 12 6 16 0" stroke="#3b2f2f" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
              <path d="M100 91v4" stroke="#3b2f2f" strokeWidth="2" strokeLinecap="round"/>
              {/* Cheeks */}
              <circle cx="65" cy="85" r="10" fill="#ffb6c1" opacity="0.4"/>
              <circle cx="135" cy="85" r="10" fill="#ffb6c1" opacity="0.4"/>
              {/* Eyebrows */}
              <ellipse cx="80" cy="55" rx="6" ry="4" fill="#d4956f" opacity="0.6"/>
              <ellipse cx="120" cy="55" rx="6" ry="4" fill="#d4956f" opacity="0.6"/>
            </svg>
          </div>
          <h1 className="hero-title">404</h1>
          <h2 className="hero-subtitle">Page Not Found</h2>
          <p className="hero-message">
            Oops! The page you're looking for doesn't exist.
          </p>
        </div>
      </div>
      <div className="branding-footer">
        Created by Gaurav Kaloliya
      </div>
    </div>
  );
}
