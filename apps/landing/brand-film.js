/* Deferred, once-only brand film. Load with defer (or after the figure). */
(() => {
  function init() {
    document.querySelectorAll('[data-brand-film]').forEach(enhance);
  }

  function enhance(figure) {
    const video = figure.querySelector('video');
    const button = figure.querySelector('[data-film-toggle]');
    if (!video || !button || typeof video.play !== 'function') return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection;
    const limited = () => reduced?.matches || connection?.saveData
      || ['slow-2g', '2g'].includes(connection?.effectiveType);
    // Resolve only local HTTP assets, including when markup uses a <base> URL.
    const localSource = (value) => {
      if (!value) return null;
      try {
        const url = new URL(value, document.baseURI);
        return /^https?:$/.test(url.protocol) && url.origin === window.location.origin ? url.href : null;
      } catch { return null; }
    };
    const source = localSource(video.dataset.filmSrc || figure.dataset.filmSrc);
    if (!source) return;

    video.autoplay = false;
    video.loop = false;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'none';
    button.type = 'button';

    let inView = null;
    let suspended = false;
    let disposed = false;
    let autoAttempted = false;
    let autoSuppressed = Boolean(limited());
    let intent = false;
    let pending = null;
    let attached = false;
    let finished = false;
    let failed = false;
    let state = 'idle';
    let expectedPauses = 0;
    const removers = [];
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      removers.push(() => target.removeEventListener(type, handler));
    };
    const eligible = () => !disposed && !suspended
      && document.visibilityState === 'visible' && inView !== false;

    function render() {
      const label = state === 'playing' ? 'Pause brand film'
        : state === 'loading' ? 'Cancel brand film playback'
          : finished ? 'Replay brand film' : failed ? 'Retry brand film' : 'Play brand film';
      button.textContent = label;
      button.setAttribute('aria-label', label);
      figure.dataset.filmState = state;
    }

    function pause() {
      pending = null; // Late play promises no longer own this playback request.
      if (!video.paused) {
        expectedPauses += 1; // The native pause event can arrive after a later play request.
        video.pause();
      }
      state = finished ? 'ended' : failed ? 'error' : attached ? 'paused' : 'idle';
      render();
    }

    function rejectPlay(attempt) {
      if (disposed || pending !== attempt) return;
      intent = false;
      autoSuppressed = true;
      pause();
    }

    function play() {
      if (!intent || !eligible() || pending || finished || !video.paused) return;
      const attempt = {};
      pending = attempt;
      state = 'loading';
      render();
      try {
        if (!attached) {
          const mobile = window.matchMedia?.('(max-width: 767px)').matches;
          const mobileSource = localSource(video.dataset.filmMobileSrc || figure.dataset.filmMobileSrc);
          video.src = mobile && mobileSource ? mobileSource : source;
          attached = true; // Keep the selected rendition through resize and replay.
        }
        if (failed) {
          failed = false;
          video.load();
        }
        const result = video.play();
        Promise.resolve(result).then(() => {
          if (pending === attempt) pending = null;
          // Cancellation can race a successful play promise or a queued playing event.
          if (disposed) video.pause();
          else if (!intent || !eligible()) pause();
        }, () => rejectPlay(attempt));
      } catch { rejectPlay(attempt); }
    }

    function reconcile() {
      if (!eligible()) { pause(); return; }
      if (!autoAttempted && !autoSuppressed && !limited() && inView === true) {
        autoAttempted = true;
        intent = true;
      }
      if (intent) play();
    }

    listen(button, 'click', () => {
      autoSuppressed = true;
      if (intent) { intent = false; pause(); return; }
      if (finished || video.ended) {
        try { video.currentTime = 0; } catch { return; }
        finished = false;
      }
      intent = true;
      play();
    });
    listen(video, 'playing', () => {
      if (!intent || !eligible()) { pause(); return; }
      if (video.paused || video.ended) return;
      state = 'playing';
      render();
    });
    listen(video, 'waiting', () => {
      if (!intent || !eligible()) return;
      state = 'loading';
      render();
    });
    listen(video, 'pause', () => {
      const expected = expectedPauses > 0;
      if (expected) expectedPauses -= 1;
      if (!video.paused) return; // Ignore a queued pause from a previous request.
      if (!expected) {
        intent = false; // Includes a browser/media-key pause while play() is still pending.
        pending = null;
      }
      state = finished || video.ended ? 'ended' : failed ? 'error' : 'paused';
      render();
    });
    listen(video, 'ended', () => {
      finished = true;
      intent = false;
      pending = null;
      state = 'ended';
      render();
    });
    listen(video, 'error', () => {
      failed = true;
      intent = false;
      autoSuppressed = true;
      pause();
    });
    listen(document, 'visibilitychange', reconcile);

    function preferenceChanged() {
      if (!limited()) return;
      // An opt-out stays in force even if the preference is later switched back.
      autoSuppressed = true;
      intent = false;
      pause();
    }
    if (reduced?.addEventListener) listen(reduced, 'change', preferenceChanged);
    else if (reduced?.addListener) {
      reduced.addListener(preferenceChanged);
      removers.push(() => reduced.removeListener(preferenceChanged));
    }
    if (connection?.addEventListener) listen(connection, 'change', preferenceChanged);

    const observer = typeof window.IntersectionObserver === 'function'
      ? new window.IntersectionObserver((entries) => {
        if (disposed || suspended) return;
        for (const entry of entries) {
          if (entry.target !== figure) continue;
          inView = entry.isIntersecting && entry.intersectionRatio >= 0.35;
        }
        reconcile();
      }, { threshold: [0, 0.35] }) : null;
    if (observer) {
      inView = false;
      observer.observe(figure);
    }

    listen(window, 'pagehide', (event) => {
      suspended = true;
      pause();
      observer?.disconnect();
      if (!event.persisted) {
        disposed = true;
        removers.forEach(remove => remove());
      }
    });
    listen(window, 'pageshow', () => {
      if (!suspended || disposed) return;
      suspended = false;
      inView = observer ? false : null;
      if (observer) observer.observe(figure); // Require a fresh viewport observation after bfcache.
    });
    render();
    button.hidden = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
