import React from "react";
import ReactDOM from "react-dom/client";
import MainApp from "./MainApp.jsx";
import "./design/system.css";
import "./styles.css";

if (typeof window !== "undefined") {
  try {
    Object.defineProperty(window, "styleMedia", {
      value: {
        type: "screen",
        matchMedium: () => false,
      },
      configurable: true,
    });
  } catch {
    // Ignore if the environment blocks redefining styleMedia.
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MainApp />
  </React.StrictMode>
);
