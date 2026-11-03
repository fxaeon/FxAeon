# FxAeon discovery notes

Reviewed 2026-11-03 against primary documentation. These are eligibility and presentation signals; none promise crawling, indexing, rich results, ranking, or citations.

## Findings applied

- Google Search Essentials favors useful people-first content, descriptive titles, and crawlable links. Its AI Search guidance says standard SEO applies, special `llms.txt` files do not improve Google Search visibility, and structured data is optional rather than an AI-search requirement.
- `robots.txt` controls crawler access; it is not an indexing or access-control mechanism. A crawler must be able to fetch a page to read `noindex`. Private content needs real authentication or server-side access controls. Accordingly, the mini-app defaults to `noindex,follow`, docs explicitly opt in, and robots does not block the capability pages whose `noindex` must be read.
- A canonical is a hint, not a directive. Sitemaps should contain canonical, indexable URLs; they aid discovery but do not guarantee indexing. The mini-app sitemap lists the public trade, earn, borrow, and move entry pages, documentation, and public policy page; it omits account, transaction-history, and capability routes.
- Bing describes IndexNow as a change notification protocol, not an indexing guarantee. No IndexNow key or automated submission was added because this repository has no content-publish event/credential workflow to submit changed URLs accurately.
- OpenAI documents `OAI-SearchBot` for ChatGPT Search discovery and `GPTBot` for content that may be used to improve foundation models. These controls are independent. The wildcard rules currently leave both allowed; a separate GPTBot opt-out should reflect an explicit publisher preference, not be inferred from search discoverability.
- Open Graph and Twitter/X card tags provide share-preview metadata. They are not ranking guarantees. JSON-LD here describes only the visible FxAeon website/organization; no ratings, reviews, financial returns, or rich-result eligibility claims are invented.

## Official sources

- [Google Search Essentials](https://developers.google.com/search/docs/essentials)
- [Google guidance for AI features in Search](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google robots.txt guide](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Google robots meta directives](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
- [Google canonicalization](https://developers.google.com/search/docs/crawling-indexing/canonicalization)
- [Google sitemap overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
- [Google structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Google title links](https://developers.google.com/search/docs/appearance/title-link) and [snippets](https://developers.google.com/search/docs/appearance/snippet)
- [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a) and [IndexNow](https://www.bing.com/webmasters/help/indexnow-0z209wby)
- [OpenAI crawler overview](https://developers.openai.com/api/docs/bots)
- [Open Graph protocol](https://ogp.me/)
