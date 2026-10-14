const INTERNAL_ORIGIN = "https://account-return.invalid";
const AUTH_ROUTES = new Set([
  "/logga-in", "/registrera", "/verifiera-epost", "/glomt-losenord", "/aterstall-losenord",
]);

/** Account redirects remain on this site and cannot loop through authentication. */
export function safeAccountReturnTo(value: unknown, fallback = "/elevportal"): string {
  if (typeof value !== "string" || value.length > 2048 || !/^\/(?!\/)/.test(value) || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    // Reject encoded separators/control characters too. A later URL parser or
    // proxy must not turn the destination into a different host or auth route.
    let decodedPath = value.split(/[?#]/, 1)[0];
    for (let depth = 0; depth < 4; depth++) {
      if (!/^\/(?!\/)/.test(decodedPath) || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return fallback;
      const next = decodeURIComponent(decodedPath);
      if (next === decodedPath) break;
      decodedPath = next;
      if (depth === 3) return fallback;
    }
    const decoded = new URL(decodedPath, INTERNAL_ORIGIN);
    const destination = new URL(value, INTERNAL_ORIGIN);
    if (decoded.origin !== INTERNAL_ORIGIN || destination.origin !== INTERNAL_ORIGIN || AUTH_ROUTES.has(decoded.pathname) || AUTH_ROUTES.has(destination.pathname)) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch { return fallback; }
}

export function accountAuthHref(path: "/logga-in" | "/registrera" | "/verifiera-epost" | "/glomt-losenord", returnTo: unknown): string {
  const destination = safeAccountReturnTo(returnTo, "");
  return path + (destination ? `?returnTo=${encodeURIComponent(destination)}` : "");
}

export function accountReturnWithMessage(destination: string, message: string): string {
  const url = new URL(safeAccountReturnTo(destination), INTERNAL_ORIGIN);
  url.searchParams.set("success", message);
  return `${url.pathname}${url.search}${url.hash}`;
}
