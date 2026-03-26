(function () {
  const STORAGE_KEY = "cognit_docs_dark_mode";
  const root = document.body;
  const toggle = document.getElementById("docsThemeToggle");
  const header = document.querySelector(".header");
  const scrollTitle = document.getElementById("docsScrollTitle");

  if (!root || !toggle) return;

  const applyTheme = (isDark) => {
    root.classList.toggle("dark", Boolean(isDark));
    toggle.textContent = isDark ? "☀️" : "🌙";
    toggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
    toggle.setAttribute("aria-label", toggle.title);
  };

  let darkMode = false;
  try {
    darkMode = localStorage.getItem(STORAGE_KEY) === "true";
  } catch (_err) {
    darkMode = false;
  }
  applyTheme(darkMode);

  const updateScrollTitle = () => {
    if (!header || !scrollTitle) return;
    if (window.innerWidth < 768) {
      root.classList.remove("docs-scroll-title-visible");
      return;
    }
    const headerRect = header.getBoundingClientRect();
    const shouldShow = headerRect.bottom <= 72;
    root.classList.toggle("docs-scroll-title-visible", shouldShow);
  };

  const updateScrollVars = () => {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollProgress = Math.min(scrollY / 1200, 1);
    document.documentElement.style.setProperty("--app-scroll-y", `${scrollY.toFixed(2)}px`);
    document.documentElement.style.setProperty("--app-scroll-progress", scrollProgress.toFixed(4));
  };

  const revealTargets = Array.from(
    document.querySelectorAll(".endpoint-card, .example-card, .error-grid article, .code-block")
  );
  const shellTargets = Array.from(
    document.querySelectorAll(".header, .docs-sidebar, .doc-section, .branding-footer")
  );
  shellTargets.forEach((el, index) => {
    el.classList.add("docs-shell-item");
    el.style.transitionDelay = `${Math.min(index * 60, 180)}ms`;
  });
  revealTargets.forEach((el, index) => {
    el.classList.add("reveal-item");
    // Light stagger keeps motion smooth without slowing perceived load.
    el.style.transitionDelay = `${Math.min(index * 24, 220)}ms`;
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" }
    );
    [...shellTargets, ...revealTargets].forEach((el) => observer.observe(el));
  } else {
    shellTargets.forEach((el) => el.classList.add("is-visible"));
    revealTargets.forEach((el) => el.classList.add("is-visible"));
  }

  updateScrollTitle();
  updateScrollVars();

  toggle.addEventListener("click", () => {
    const next = !root.classList.contains("dark");
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch (_err) {
      // Keep UI functional if storage is unavailable.
    }
  });

  window.addEventListener("scroll", updateScrollTitle, { passive: true });
  window.addEventListener("scroll", updateScrollVars, { passive: true });
  window.addEventListener("resize", updateScrollTitle);
})();
