import { expect, test } from "../fixtures/test";

const ROUTE_METADATA = [
  ["/trade", "Trade", "Trade"],
  ["/earn", "Earn", "fxSAVE"],
  ["/borrow", "Borrow fxUSD", "fxUSD"],
  ["/move", "Move", "Ethereum and Base"],
  ["/portfolio", "Portfolio", "wallet"],
  ["/docs", "Docs", "f(x) SDK"],
  ["/docs/sdk", "f(x) SDK reference", "15-method"],
  ["/settings", "Wallet & account", "wallet"],
] as const;

function metaContent(html: string, attribute: "name" | "property", value: string): string {
  const match = html.match(new RegExp(`<meta\\s+${attribute}=["']${value}["']\\s+content=["']([^"']+)["']`, "i"));
  return match?.[1] ?? "";
}

test.describe("server-rendered route metadata", () => {
  for (const [route, title, descriptionKeyword] of ROUTE_METADATA) {
    test(`${route} exposes route-specific launch metadata before hydration`, async ({ request }) => {
      const response = await request.get(route);
      expect(response.ok()).toBeTruthy();
      const html = await response.text();
      const documentTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
      const description = metaContent(html, "name", "description");
      const openGraphTitle = metaContent(html, "property", "og:title");
      const twitterTitle = metaContent(html, "name", "twitter:title");
      const icon = html.match(/<link\s+rel=["']icon["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? "";

      expect(documentTitle).toBe(`${title} · FxAeon`);
      expect(description).toContain(descriptionKeyword);
      expect(openGraphTitle).toBe(documentTitle);
      expect(twitterTitle).toBe(documentTitle);
      expect(icon).toBe("/icon.svg");
    });
  }
});
