(() => {
  const storageKey = "marshrut-graphite-theme";
  const themeInLink = new URL(location.href).searchParams.get("theme");
  const isTheme = (value) => value === "light" || value === "dark";
  let storedTheme;
  try {
    storedTheme = localStorage.getItem(storageKey);
  } catch {
    // Some browsers isolate or disable storage for local HTML files.
  }
  const root = document.documentElement;
  const defaultTheme = isTheme(root.dataset.theme) ? root.dataset.theme : "dark";
  root.dataset.theme = isTheme(themeInLink) ? themeInLink : isTheme(storedTheme) ? storedTheme : defaultTheme;

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = document.querySelectorAll("[data-set-theme]");
    const links = document.querySelectorAll("[data-theme-link]");
    function showTheme(theme) {
      root.dataset.theme = theme;
      buttons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.setTheme === theme));
      });
      links.forEach((link) => {
        const url = new URL(link.href);
        url.searchParams.set("theme", theme);
        link.href = url.href;
      });
    }
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const theme = button.dataset.setTheme;
        showTheme(theme);
        try {
          localStorage.setItem(storageKey, theme);
        } catch {
          // The navigation links carry the selection between pages.
        }
        try {
          const url = new URL(location.href);
          url.searchParams.set("theme", theme);
          history.replaceState(history.state, "", url.href);
        } catch {
          // The browser may restrict history changes on file URLs.
        }
      });
    });
    showTheme(root.dataset.theme);
  });
})();
