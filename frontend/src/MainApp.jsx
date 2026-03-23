import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import NotFound from "./components/NotFound.jsx";
import ErrorPage from "./components/ErrorPage.jsx";
import RateLimitPage from "./components/RateLimitPage.jsx";
import MaintenancePage from "./components/MaintenancePage.jsx";
import { useMainAppController } from "./hooks/useMainAppController";

function MainApp() {
  const {
    darkMode,
    storageOk,
    error,
    resetError,
    rateLimitError,
    resetRateLimit,
    maintenanceError,
    resetMaintenance,
    toggleDarkMode,
  } = useMainAppController();

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {maintenanceError ? (
        <MaintenancePage
          error={maintenanceError}
          onRetry={resetMaintenance}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      ) : rateLimitError ? (
        <RateLimitPage
          error={rateLimitError}
          onRetry={resetRateLimit}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      ) : error ? (
        <ErrorPage
          error={error}
          resetError={resetError}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      ) : (
        <Routes>
          <Route
            path="/"
            element={<App darkMode={darkMode} toggleDarkMode={toggleDarkMode} storageOk={storageOk} />}
          />
          <Route
            path="*"
            element={
              <NotFound
                darkMode={darkMode}
                onToggleDarkMode={toggleDarkMode}
              />
            }
          />
        </Routes>
      )}
    </Router>
  );
}

export default MainApp;
