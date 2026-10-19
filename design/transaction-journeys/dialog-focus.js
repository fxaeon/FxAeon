/* Keep modal keyboard focus deterministic across Chromium builds. */
(() => {
  'use strict';
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const candidates = [...dialog.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      const first = candidates[0], last = candidates[candidates.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !candidates.includes(focused))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (focused === last || !candidates.includes(focused))) {
        event.preventDefault(); first.focus();
      }
    });
  }
})();
