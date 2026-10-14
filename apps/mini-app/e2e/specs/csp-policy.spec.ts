import { expect, test } from '@playwright/test';

type PolicyWindow = Window & {
  __fxaeonCspViolations?: Array<{ blockedURI: string; effectiveDirective: string; violatedDirective: string }>;
  __fxaeonUnlistedInlineScript?: boolean;
  __fxaeonNextBootstrapExecuted?: boolean;
  __next_f?: unknown[];
};

const documents = [
  { path: '/', status: 200, nextBootstrap: true },
  { path: '/portfolio', status: 200, nextBootstrap: true },
  { path: '/positions', status: 200, nextBootstrap: true },
  { path: '/privacy', status: 200, nextBootstrap: false },
  { path: '/__csp_probe_missing_route__', status: 404, nextBootstrap: true },
];

for (const document of documents) {
  test(`${document.path} enforces its generated CSP without blocking the Next bootstrap`, async ({ page }) => {
    test.setTimeout(25_000);

    await page.addInitScript(() => {
      const target = window as PolicyWindow;
      target.__fxaeonCspViolations = [];
      // Next 16 consumes and clears its Flight queue during hydration. Observe
      // the actual inline bootstrap before that happens instead of relying on
      // a retained queue, without supplying any bootstrap data ourselves.
      let flight: unknown[] | undefined;
      Object.defineProperty(target, '__next_f', {
        configurable: true,
        get: () => flight,
        set: (value: unknown[]) => {
          flight = value;
          if (!Array.isArray(value)) return;
          const push = value.push;
          value.push = function (...segments: unknown[]) {
            if (segments.some((segment) => Array.isArray(segment) && segment[0] === 0)) {
              target.__fxaeonNextBootstrapExecuted = true;
            }
            return push.apply(this, segments);
          };
        },
      });
      window.addEventListener('securitypolicyviolation', (event) => {
        target.__fxaeonCspViolations?.push({
          blockedURI: event.blockedURI,
          effectiveDirective: event.effectiveDirective,
          violatedDirective: event.violatedDirective,
        });
      });
    });

    const response = await page.goto(document.path, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    expect(response?.status(), document.path).toBe(document.status);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]'), document.path).toHaveCount(1, { timeout: 5_000 });

    if (document.nextBootstrap) {
      await expect.poll(() => page.evaluate(() => {
        const target = window as PolicyWindow;
        return target.__fxaeonNextBootstrapExecuted === true && Array.isArray(target.__next_f);
      }), { timeout: 5_000, message: `${document.path} Next inline Flight bootstrap should execute under CSP` }).toBe(true);
    }

    const initialScriptViolations = await page.evaluate(() =>
      (window as PolicyWindow).__fxaeonCspViolations?.filter((violation) =>
        violation.effectiveDirective.startsWith('script-src') || violation.violatedDirective.startsWith('script-src'),
      ) ?? [],
    );
    expect(initialScriptViolations, `${document.path} blocked a generated inline script`).toEqual([]);

    await page.evaluate(() => {
      const script = window.document.createElement('script');
      script.textContent = 'window.__fxaeonUnlistedInlineScript = true;';
      window.document.head.append(script);
    });

    await expect.poll(() => page.evaluate(() => Boolean((window as PolicyWindow).__fxaeonUnlistedInlineScript)), {
      timeout: 2_000,
      message: `${document.path} unlisted inline script must remain blocked`,
    }).toBe(false);
    await expect.poll(() => page.evaluate(() =>
      (window as PolicyWindow).__fxaeonCspViolations?.some((violation) =>
        (violation.effectiveDirective.startsWith('script-src') || violation.violatedDirective.startsWith('script-src'))
        && (violation.blockedURI === 'inline' || violation.blockedURI === ''),
      ) ?? false,
    ), { timeout: 2_000, message: `${document.path} should report the blocked inline script` }).toBe(true);
  });
}
