(() => {
  const root = document.documentElement;
  root.dataset.theme = "dark";
  try {
    localStorage.removeItem("fxaeon-theme");
  } catch {
    /* Storage is optional. */
  }
  root.dataset.js = "true";
  const init = () => {
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
    const motion = document.querySelector(".motion-toggle");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paused = false;
    try {
      paused ||= localStorage.getItem("fxaeon-motion") === "off";
    } catch {
      /* Optional preference. */
    }
    const applyMotion = () => {
      root.dataset.motion = paused || reducedMotion.matches ? "off" : "on";
      motion.setAttribute("aria-pressed", String(paused));
      motion.setAttribute(
        "aria-label",
        paused ? "Resume animations" : "Pause animations",
      );
    };
    applyMotion();
    motion.addEventListener("click", () => {
      paused = !paused;
      try {
        localStorage.setItem("fxaeon-motion", paused ? "off" : "on");
      } catch {
        /* Optional preference. */
      }
      applyMotion();
    });
    reducedMotion.addEventListener("change", applyMotion);
    if ("IntersectionObserver" in window) {
      const reveals = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("revealed");
            reveals.unobserve(entry.target);
          }
        },
        { threshold: 0.12 },
      );
      document
        .querySelectorAll(".section-head, .protocol-steps li, .product-card, .telegram-copy, .telegram-visual, .faq-heading, .faq-list, .footer-invite")
        .forEach((element) => reveals.observe(element));
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
