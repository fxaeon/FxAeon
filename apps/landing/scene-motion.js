// CSS owns all animation timelines; this module only controls their play state.
export function initSceneMotion(document, window) {
  const scene = document.querySelector('.journey-scene');
  const toggle = document.querySelector('[data-scene-toggle]');
  if (!scene || !scene.querySelector('.journey-world') || !toggle) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canObserve = typeof window.IntersectionObserver === 'function';
  let inViewport = !canObserve;
  let manuallyPaused = false;

  const render = () => {
    const running = !manuallyPaused && !reducedMotion.matches &&
      !document.hidden && inViewport;
    scene.dataset.state = running ? 'running' : 'paused';
    toggle.textContent = running ? 'Pause animation' : 'Play animation';
    toggle.hidden = reducedMotion.matches;
  };

  toggle.addEventListener('click', () => {
    if (reducedMotion.matches) return;
    // A play request clears only the manual pause, never environmental gates.
    manuallyPaused = scene.dataset.state === 'running';
    render();
  });
  document.addEventListener('visibilitychange', render);
  reducedMotion.addEventListener('change', render);

  if (canObserve) {
    const observer = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === scene) {
          inViewport = entry.isIntersecting && entry.intersectionRatio >= 0.01;
        }
      }
      render();
    }, { threshold: 0.01 });
    // Pause before observing so an initially offscreen scene never starts loops.
    render();
    observer.observe(scene);
  } else {
    render();
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initSceneMotion(document, window);
    }, { once: true });
  } else {
    initSceneMotion(document, window);
  }
}
