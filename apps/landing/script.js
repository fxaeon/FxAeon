(() => {
  const root = document.documentElement;
  let saved;
  try {
    saved = localStorage.getItem("fxaeon-theme");
  } catch {
    /* Storage is optional. */
  }
  root.dataset.theme = saved === "light" ? "light" : "dark";
  root.dataset.js = "true";
  const init = () => {
    const toggle = document.querySelector(".theme-toggle");
    const applyTheme = () => {
      const dark = root.dataset.theme === "dark";
      toggle.setAttribute(
        "aria-label",
        dark ? "Switch to light theme" : "Switch to dark theme",
      );
      toggle.querySelector("[data-theme-label]").textContent = dark
        ? "Light mode"
        : "Dark mode";
      document.querySelector('meta[name="theme-color"]').content = dark
        ? "#15121c"
        : "#ffffff";
    };
    applyTheme();
    toggle.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("fxaeon-theme", root.dataset.theme);
      } catch {
        /* Storage is optional. */
      }
      applyTheme();
    });
    const menu = document.querySelector(".site-menu");
    const opener = document.querySelector(".menu-toggle");
    opener.addEventListener("click", () => {
      menu.showModal();
      document.body.classList.add("menu-open");
      opener.setAttribute("aria-expanded", "true");
    });
    const close = () => menu.close();
    menu.querySelector(".menu-close").addEventListener("click", close);
    menu
      .querySelectorAll("a")
      .forEach((link) => link.addEventListener("click", close));
    menu.addEventListener("close", () => {
      document.body.classList.remove("menu-open");
      opener.setAttribute("aria-expanded", "false");
    });
    document.getElementById("year").textContent = String(
      new Date().getFullYear(),
    );
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
