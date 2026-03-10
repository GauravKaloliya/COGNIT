import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import NotFound from "./components/NotFound.jsx";
import ErrorPage from "./components/ErrorPage.jsx";
import { runtimeConfig } from "./config/runtime";
import { getStoredValue, saveStoredValue } from "./utils/storage";

function readDarkMode() {
  return getStoredValue("darkMode", false) === true;
}

function writeDarkMode(value) {
  saveStoredValue("darkMode", value === true);
}

function MainApp() {
  const [darkMode, setDarkMode] = React.useState(() => readDarkMode());
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    writeDarkMode(darkMode);
  }, [darkMode]);

  React.useEffect(() => {
    const handleError = (event) => {
      console.error('Application error:', event.error);
      setError(event.error);
    };

    const handleUnhandledRejection = (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      setError(event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {error ? (
        <ErrorPage
          error={error}
          resetError={() => setError(null)}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        />
      ) : (
        <Routes>
          <Route path="/" element={<App />} />
          <Route
            path="*"
            element={
              <NotFound
                darkMode={darkMode}
                onToggleDarkMode={() => setDarkMode((prev) => !prev)}
              />
            }
          />
        </Routes>
      )}
    </Router>
  );
}

export default MainApp;
