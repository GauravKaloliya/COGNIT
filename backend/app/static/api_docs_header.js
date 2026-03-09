(function () {
  const STORAGE_KEY = "cognit_docs_dark_mode";
  const root = document.body;
  const toggle = document.getElementById("docsThemeToggle");
  const status = document.getElementById("docsOnlineStatus");

  if (!root || !toggle || !status) return;

  const applyTheme = (isDark) => {
    root.classList.toggle("dark", Boolean(isDark));
    toggle.textContent = isDark ? "☀️" : "🌙";
    toggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
    toggle.setAttribute("aria-label", toggle.title);
  };

  const setOnlineStatus = () => {
    const online = navigator.onLine;
    status.classList.toggle("online", online);
    status.classList.toggle("offline", !online);
    status.textContent = online ? "Online" : "Offline";
  };

  let darkMode = false;
  try {
    darkMode = localStorage.getItem(STORAGE_KEY) === "true";
  } catch (_err) {
    darkMode = false;
  }
  applyTheme(darkMode);
  setOnlineStatus();

  toggle.addEventListener("click", () => {
    const next = !root.classList.contains("dark");
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch (_err) {
      // Keep UI functional if storage is unavailable.
    }
  });

  window.addEventListener("online", setOnlineStatus);
  window.addEventListener("offline", setOnlineStatus);
})();
