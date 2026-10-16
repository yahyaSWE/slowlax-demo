import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseAuthConfiguration } from "./supabase-auth-config";

export async function createSupabaseServerClient(writable = false) {
  const config = requireSupabaseAuthConfiguration();
  const jar = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        if (writable) { for (const { name, value, options } of values) jar.set(name, value, options); }
        // Rendering cannot write cookies. Proxy refreshes them before render.
      },
    },
  });
}
