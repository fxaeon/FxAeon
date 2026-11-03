# Search and agent discoverability

## Public discovery policy

The landing site at [fxaeon.xyz](https://fxaeon.xyz/) introduces FxAeon. The app and public guides are at [fxaeon.com](https://fxaeon.com/docs). The landing and documentation provide readable product information without a connected wallet; interactive product screens require JavaScript.

- Publish accurate titles, descriptions, canonical URLs, and share metadata. Describe only supported products, assets, networks, and risks.
- Keep public canonical pages in each host's sitemap. Generate sitemaps and the optional `llms.txt` guides with `pnpm discovery:generate`; run `pnpm test:discovery` after changing routes or documentation navigation. Do not invent modification dates.
- Wallet/account pages default to `noindex`. Private confirmation and approval pages also suppress following and referrers. Never publish account records, credentials, capability values, or privileged operating instructions in public discovery files.
- Allow crawlers to fetch pages whose `noindex` they must read. Robots rules and unlisted URLs do not replace authentication, authorization, or server-side enforcement.
- Keep structured data consistent with visible content. The current Organization/WebSite descriptions make no claims about offers, ratings, returns, or endorsements.
- Treat browser configuration as public. Keep server credentials, local evidence, and operator material outside static assets. Next copies `public/` into the export; the landing build copies an explicit file list and referenced assets. Header policies necessarily expose the origins needed by the browser.

## Official guidance

- Google uses ordinary SEO for generative search and does not use special AI text files such as `llms.txt`. The guide is an optional reference map, not an indexing or ranking mechanism. [Google AI guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- Crawlers must fetch a page to read `noindex`; blocking it in robots can prevent that. [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- Canonical links express a preference. Sitemaps should contain public canonical URLs. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- Bing recommends discoverable XML sitemaps and accurate modification times. IndexNow notifies search engines of changes without guaranteeing crawling or indexing. [Bing sitemap guidance](https://blogs.bing.com/webmaster/2025/7/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search/), [IndexNow](https://www.bing.com/indexnow/getstarted)
- Search, user retrieval, and training crawlers have distinct purposes. Existing wildcard robots rules permit public crawling; any training-policy change should be intentional. Verify crawler identity using provider guidance rather than trusting a user-agent string. [OpenAI crawlers](https://developers.openai.com/api/docs/bots), [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- Static export creates HTML per route, but client-only boundaries can still defer content. Inspect delivered HTML and rendered content rather than assuming every screen is pre-rendered. [Next static exports](https://nextjs.org/docs/app/guides/static-exports)

## External launch checklist

1. Run release gates and inspect the production export. Check public content and metadata, private-page exclusions, copied assets, and response headers. Keep audit evidence outside public output.
2. Verify production HTTPS/host/trailing-slash behavior, clean canonicals on query variants, real unknown-route 404s, and preview-domain indexing restrictions. Confirm public pages do not receive a blanket `X-Robots-Tag: noindex`. Review WAF access with verified crawler identity and logs.
3. In [Search Console](https://search.google.com/search-console), select or add separate Domain properties for `fxaeon.xyz` and `fxaeon.com`. The domain owner must publish Google's exact verification value if required. [Property verification](https://support.google.com/webmasters/answer/34592)
4. Check production `robots.txt`, `sitemap.xml`, and `llms.txt` return intended content, 200 status, and correct MIME types. Submit [the landing sitemap](https://fxaeon.xyz/sitemap.xml) and [the app sitemap](https://fxaeon.com/sitemap.xml) to their respective properties; resolve processing errors. [Sitemaps report](https://support.google.com/webmasters/answer/7451001)
5. Inspect the landing, docs home, a product topic, an SDK topic, and privacy using live URL tests. Compare fetched/rendered content, declared and selected canonical, and index eligibility. Request indexing only for public canonical URLs; never submit private links, account pages, or privileged URLs. Review indexing and structured-data reports after crawling.
6. Verify or import both properties in [Bing Webmaster Tools](https://www.bing.com/webmasters/), submit their respective sitemaps, and inspect public URLs and processing reports. Consider IndexNow only with an intentional content-change workflow.

Successful checks and submissions do not prove indexing, ranking, rich-result eligibility, or AI citations. Record verified deployment results separately from this maintained guidance.
