/** This file exists only on the frontend demonstration branch/repository.
 * The regular Slowlax repository keeps its database, accounts and purchases.
 * Never enable real integrations by adding environment variables to this demo.
 */
export const DEMO_MODE = true;

const publicPages = new Set([
  "/", "/kurser", "/paket", "/artiklar", "/medlemskap", "/rening",
  "/investeringsfilosofi", "/om", "/kontakt", "/vanliga-fragor",
  "/villkor", "/integritet", "/sjalvtest", "/robots.txt", "/sitemap.xml",
  "/llms.txt", "/opengraph-image", "/favicon.ico", "/favicon.svg",
]);

export function demoPublicPath(path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (publicPages.has(normalized)) return true;
  // Only public detail routes; payment confirmations and account callbacks
  // must stay unavailable even if their parent path is a public catalogue.
  if (/^\/medlemskap\/bekraftelse(?:\/|$)/.test(normalized)) return false;
  return /^\/(kurser|paket|artiklar|medlemskap)\/[^/]+$/.test(normalized);
}
