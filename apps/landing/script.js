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
    // A modal opened on a phone must not obscure the desktop navigation after
    // rotating a tablet, zooming out, or widening a browser window.
    const mobileNavigation = window.matchMedia("(max-width: 760px)");
    mobileNavigation.addEventListener("change", () => {
      if (!mobileNavigation.matches && menu.open) {
        close();
        document.querySelector(".nav-links a").focus({ preventScroll: true });
      }
    });
    document.getElementById("year").textContent = String(
      new Date().getFullYear(),
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    try {
      localStorage.removeItem("fxaeon-motion");
    } catch {
      /* Storage is optional. */
    }
    const applyMotion = () => {
      root.dataset.motion = reducedMotion.matches ? "off" : "on";
    };
    applyMotion();
    reducedMotion.addEventListener("change", applyMotion);

    const applyHeader = () => {
      root.toggleAttribute("data-scrolled", window.scrollY > 16);
    };
    applyHeader();
    window.addEventListener("scroll", applyHeader, { passive: true });
    window.addEventListener("pageshow", applyHeader);

    // Keep decorative work local to what the visitor can actually see.
    const motionSurfaces = document.querySelectorAll(".product-card, .site-footer");
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          entry.target.toggleAttribute("data-in-view", entry.isIntersecting);
        }
      }, { threshold: 0 });
      motionSurfaces.forEach((surface) => observer.observe(surface));
    } else {
      motionSurfaces.forEach((surface) => surface.setAttribute("data-in-view", ""));
    }
    const applyVisibility = () => {
      root.toggleAttribute("data-page-hidden", document.hidden);
    };
    applyVisibility();
    document.addEventListener("visibilitychange", applyVisibility);
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
