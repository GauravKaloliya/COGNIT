import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import NotFound from "./components/NotFound.jsx";
import ErrorPage from "./components/ErrorPage.jsx";
import { useMainAppController } from "./hooks/useMainAppController";

function MainApp() {
  const { darkMode, error, resetError, toggleDarkMode } = useMainAppController();

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {error ? (
        <ErrorPage
          error={error}
          resetError={resetError}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      ) : (
        <Routes>
          <Route path="/" element={<App />} />
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
