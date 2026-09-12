import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  function loginRedirect(reason?: string) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    if (reason) url.searchParams.set("reason", reason);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  try {
    const { url, publishableKey } = getSupabaseConfig();
    const supabase = createServerClient(url, publishableKey, {
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(15000),
            cache: "no-store",
          }),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    // Server-confirmed identity, never trust the user object from getSession().
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user)
      return loginRedirect(
        error && error.status && error.status >= 500
          ? "unavailable"
          : undefined,
      );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return loginRedirect("unavailable");
  }
}

export const config = {
  matcher: ["/", "/goals/:path*", "/history/:path*", "/butler/:path*"],
};
