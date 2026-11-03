# Prelaunch search and agent discoverability

Reviewed 2026-11-04 in `C:\FxAeon-prelaunch-discovery`, branch `codex/prelaunch-discovery`, base `6c8e9a2`. Inputs: full attached brief (especially section 10), DESIGN.md, architecture, product behavior, deployment, launch checklist, landing documentation, and official guidance below. This is a bounded discovery pass, not whole-product launch certification.

PR 377, `codex/landing-experience` at `a4e914e`, is the current landing revision. Its worktree and revised design contract were inspected read-only. This branch makes no landing HTML/visual or app business-logic changes. The landing build gains one independent copy operation for `llms.txt`.

## Inventory and implemented fixes

| Surface | Finding and result |
| --- | --- |
| Landing | Static text, one H1, canonical `https://fxaeon.xyz/`, complete OG/X metadata and Organization/WebSite JSON-LD already existed. Preserved and checked without JavaScript at 320px and 1440px |
| Financial app rendering | Next static export with client-only product providers (`ssr: false`). Product screens still require JavaScript; landing and public docs are the reliable text discovery sources |
| Public docs | All 16 product and 8 SDK topics use static params and direct links. Rendered the actual shell/articles without hydration, checked internal paths/fragments, invoked actual metadata functions, and checked unknown-topic 404 rejection |
| Titles | Borrow screen and guide shared a title. Topic metadata now distinguishes `FxAeon Docs` and `FxAeon SDK`; route/topic titles and descriptions are unique |
| Private routes | Root `noindex,follow` remains the wallet/account default. Secret-link layouts now explicitly use `noindex,nofollow,noarchive`, `no-referrer`, their own titles, and token-free canonical/share URLs |
| Robots | Both hosts allow public crawling; app excludes only the generic API subtree. Preserved. No privileged paths or bot-specific override groups added; secret-link pages stay fetchable so crawlers can read `noindex` |
| Sitemaps | Existing sets remain: one landing URL, 32 app URLs. New generator uses an explicit public allowlist and docs navigation; the check rejects stale/missing files. No fabricated modification dates or priority signals |
| Agent guide | Added identical generated root `llms.txt` files for both sites: reviewed product/network facts, access, all 24 topics, fees, risks, privacy, protocol reference. No private/action/privileged URLs listed |
| Privacy | Added a complete page-specific OG/X card using the existing 1200×630 asset; policy text unchanged |
| Tests | Old discovery `.test.mjs` was skipped by the normal `test/**/*.test.ts` runner. Renamed it to `.test.ts`, expanded coverage, and added render, artifact, browser, and focused typecheck checks |

The two canonical hosts serve different purposes: `.xyz` introduces FxAeon; `.com` hosts app/docs. Canonicals contain no query/fragment. No redirects, invented financial schema, ratings, offers, FAQ claims, or returns were added. Public discovery files do not enumerate privileged endpoints. Discovery controls are not authorization; existing server access controls remain necessary.

## Official guidance researched

- Google uses ordinary SEO for generative search and does not use special AI text files such as `llms.txt`. Our guide is optional reference material, with no ranking, indexing, or citation promise. [Google AI guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- A crawler must fetch a page to read `noindex`; robots disallow can prevent this. [Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- Canonical links express a preference; sitemap entries should use public canonical URLs. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- Bing recommends discoverable XML sitemaps and truthful modification times. IndexNow is an optional change notification mechanism, not guaranteed crawling/indexing; no key or submission integration was added. [Bing sitemap guidance](https://blogs.bing.com/webmaster/2025/7/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search/), [Bing IndexNow](https://www.bing.com/indexnow/getstarted). The general Webmaster Guidelines URL returned a JavaScript-only shell; readable official sitemap guidance supports these decisions.
- OpenAI separates `OAI-SearchBot` search from `GPTBot` training. Anthropic separates `Claude-SearchBot`, `Claude-User`, and `ClaudeBot`; Perplexity documents `PerplexityBot` for search. Existing wildcard rules permit public access; training preferences and CDN settings remain unchanged. A spoofed user agent alone cannot verify real crawler/WAF access. [OpenAI crawlers](https://developers.openai.com/api/docs/bots), [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- Next exports HTML per route, but client-only dynamic boundaries can still replace content with loading UI. Our docs render check does not establish server-rendered wallet/product content. [Next static exports](https://nextjs.org/docs/app/guides/static-exports)

## Changed paths

- `apps/landing/build.mjs`, `apps/landing/llms.txt`, `apps/landing/test/discovery.test.mjs`
- `apps/mini-app/public/llms.txt`, `apps/mini-app/public/privacy.html`
- `apps/mini-app/src/app/routeMetadata.ts`
- `apps/mini-app/src/app/invite/layout.tsx`, `apps/mini-app/src/app/wallet-approval/layout.tsx`
- `apps/mini-app/src/app/docs/guide/[topic]/page.tsx`, `apps/mini-app/src/app/docs/sdk/[topic]/page.tsx` (metadata only)
- `apps/mini-app/test/discovery-metadata.test.mjs` → `discovery-metadata.test.ts`
- `apps/mini-app/test/discovery-render.test.ts`, `apps/mini-app/test/tsconfig.discovery.json`
- `scripts/generate_discovery.mjs`, `scripts/verify_discovery_browser.mjs`, `package.json`, this report

Existing sitemap content/URL sets are unchanged generator outputs. Landing `dist/`, local caches, and dependency junctions are ignored. No new dependencies or lockfile changes.

## Evidence

Commands ran from the worktree root:

| Check | Command / result |
| --- | --- |
| Discovery + docs | `node apps/mini-app/node_modules/tsx/dist/cli.mjs --tsconfig apps/mini-app/tsconfig.json --test apps/mini-app/test/discovery-metadata.test.ts apps/mini-app/test/discovery-render.test.ts apps/mini-app/test/docs-search.test.ts` — 23 passed |
| Lightweight landing build | `node apps/landing/build.mjs` — passed |
| Landing contracts | `node --test apps/landing/test/*.test.mjs` — 33 passed, including dependency-free build fixture |
| CSP regression | `node --test scripts/generate_csp_headers.contract.test.mjs` — 4 passed |
| Artifact drift | `node --experimental-strip-types scripts/generate_discovery.mjs --check` — both sitemaps and both guides match |
| Focused typecheck | `node node_modules/typescript/bin/tsc --project apps/mini-app/test/tsconfig.discovery.json` — passed, including changed layouts/metadata and docs graph |
| Lint | Direct ESLint binary on changed app TypeScript and both discovery tests — passed |
| Local HTTP/browser | Set `PORT=4197`, run `node apps/landing/serve.mjs`, then `node scripts/verify_discovery_browser.mjs` — passed at 320px and 1440px without JavaScript. HTML, robots, sitemap, llms, favicon, social image: 200/correct MIME. Missing page: 404/noindex. Canonical/share/schema, fragments, image size and horizontal overflow checked |

Runtime: Node 24.19.0; existing dependencies reached via authorized junctions to `C:\FxAeon-finish`. The `pnpm test:discovery` launcher refused pinned Node 22/pnpm 11.19 requirements (shell pnpm 11.25); its automatic dependency sync did not complete. No install was retried. Successful checks used existing binaries directly. Native TS imports emit a module-type detection warning; the module system was not changed.

Test development corrected generator CommonJS/top-level-await incompatibility and an overly strict H2 assertion for short articles. A root tsx invocation without app configuration failed aliases; the explicit-tsconfig command above passes. The browser check now validates the configured Telegram launcher rather than requiring an exact bare-bot URL, accepting PR 377's valid `?startapp=` form. No final focused check remains failing.

No heavy Next export/full app suite was run. No field Core Web Vitals, production CDN redirect/status audit, indexing/ranking, or crawler-log result is claimed. Browser evidence covers base and isolated merged landing discovery, not a full visual audit. Maintenance on the pinned toolchain: `pnpm discovery:generate`, `pnpm test:discovery`, `pnpm typecheck:discovery`; build/serve landing before `pnpm test:discovery:browser`. Normal unit tests now include both discovery test files.

## PR 377 integration evidence

`git merge-tree --write-tree HEAD codex/landing-experience` completed without conflicts. The merged landing and required public protocol mark were exported with `git archive` into an ignored local `.cache` directory; no merge was applied to either worktree. The merged landing built without dependencies, and its discovery/artifact and social-metadata tests both passed. The same HTTP/browser script passed against its preview on port 4198 at 320px and 1440px with JavaScript disabled. No landing index patch is needed. Re-run normal integrated release gates when the branches actually merge.

## Remaining owner actions

1. Integrate with PR 377 and run normal release gates/full Next export. Inspect emitted metadata for a public topic and token-free private pages. Verify no production blanket `X-Robots-Tag: noindex` and no accidental indexing of private pages.
2. In [Search Console](https://search.google.com/search-console), select/add separate Domain properties for `fxaeon.xyz` and `fxaeon.com`. If unverified, the domain owner must publish Google's exact DNS TXT value. No verification values were invented or accounts changed. [Google property verification](https://support.google.com/webmasters/answer/34592)
3. Verify each production `robots.txt`, `sitemap.xml`, and `llms.txt` returns intended content/200/correct MIME. Check HTTPS/host/trailing-slash normalization, clean canonicals on query variants, real unknown-route 404s, and preview-domain indexing restrictions. Check WAF access using verified bot identity/logs.
4. In each property's Sitemaps report, submit `https://fxaeon.xyz/sitemap.xml` or `https://fxaeon.com/sitemap.xml`, respectively. Confirm successful processing and resolve fetch/parse errors. [Google Sitemaps report](https://support.google.com/webmasters/answer/7451001)
5. Run URL Inspection/live tests for landing, `/docs`, a product topic, an SDK topic, and privacy. Compare fetched/rendered text, declared versus Google-selected canonical, and index eligibility. Request indexing only for public canonical URLs; never submit invitation/approval tokens, account/wallet pages, or privileged URLs. Review Page indexing/structured-data reports after crawling. Submission success is not indexing proof.
6. In [Bing Webmaster Tools](https://www.bing.com/webmasters/), verify/import both sites, submit their respective sitemaps, and inspect public URLs and processing reports. Consider IndexNow only with an intentional publish/change workflow.

Repository changes are implemented and locally verified. Production discoverability still depends on deployment and owner checks; this report does not promise visibility or issue a whole-application launch verdict.
