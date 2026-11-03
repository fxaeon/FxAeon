(() => {
  const root = document.documentElement;
  root.dataset.theme = "light";
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
    let revealObserver;
    const reveal = (element) => {
      element.dataset.reveal = "entered";
      revealObserver?.unobserve(element);
    };
    const applyMotion = () => {
      root.dataset.motion = reducedMotion.matches ? "off" : "on";
      if (reducedMotion.matches) {
        revealObserver?.disconnect();
        document.querySelectorAll('[data-reveal="waiting"]').forEach(reveal);
        const productRail = document.querySelector('.product-grid');
        productRail?.scrollTo({ left: productRail.scrollLeft, behavior: 'instant' });
      }
    };
    applyMotion();
    reducedMotion.addEventListener("change", applyMotion);

    // Content starts visible. Motion is an enhancement, never a loading gate.
    if (!reducedMotion.matches && typeof IntersectionObserver === "function") {
      revealObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) reveal(entry.target);
      }, { threshold: 0.06 });
      document.querySelectorAll('.products .section-head, .product-grid, .outcome-heading, .calculator-controls, .outcome-frame, .telegram-copy, .telegram-visual, .footer-invite').forEach((element) => {
        if (element.getBoundingClientRect().top < innerHeight) return;
        revealObserver.observe(element);
        element.dataset.reveal = "waiting";
      });
      document.addEventListener("focusin", (event) => {
        const waiting = event.target.closest?.('[data-reveal="waiting"]');
        if (waiting) reveal(waiting);
      });
    }

    const rail = document.querySelector('.product-grid');
    const cards = [...rail.querySelectorAll('.product-card')];
    const choices = [...document.querySelectorAll('[data-product]')];
    let scrollFrame = 0;
    const syncProduct = () => {
      scrollFrame = 0;
      const origin = rail.getBoundingClientRect().left + parseFloat(getComputedStyle(rail).paddingLeft);
      let nearest = 0;
      let distance = Infinity;
      cards.forEach((card, index) => {
        const nextDistance = Math.abs(card.getBoundingClientRect().left - origin);
        if (nextDistance < distance) { nearest = index; distance = nextDistance; }
      });
      choices.forEach((button, index) => button.setAttribute('aria-pressed', String(index === nearest)));
      document.querySelector('.product-navigation').dataset.active = String(nearest);
    };
    const queueProductSync = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(syncProduct); };
    rail.addEventListener('scroll', queueProductSync, { passive: true });
    window.addEventListener('resize', queueProductSync, { passive: true });
    choices.forEach((button, index) => button.addEventListener('click', () => {
      const inset = parseFloat(getComputedStyle(rail).paddingLeft);
      const left = rail.scrollLeft + cards[index].getBoundingClientRect().left - rail.getBoundingClientRect().left - inset;
      rail.scrollTo({ left, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    }));
    syncProduct();
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
