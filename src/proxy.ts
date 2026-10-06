import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

function copySupabaseCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value);
  });
  return to;
}

function isStaffPath(pathname: string) {
  return (
    pathname.includes("/admin") ||
    pathname.includes("/sourcer") ||
    pathname.includes("/staff/")
  );
}

function isPublicPath(pathname: string) {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/" || path === "/en" || path === "/fr") return true;
  return (
    path.endsWith("/login") ||
    path.endsWith("/forgot-password") ||
    path.endsWith("/reset-password") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/")
  );
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // A merchant just installed a store app: Shopify opens the App URL with ?shop&hmac.
  const params = request.nextUrl.searchParams;
  if (
    params.has("shop") &&
    params.has("hmac") &&
    ["/", "/fr", "/en"].includes(pathname.replace(/\/$/, "") || "/")
  ) {
    const installUrl = request.nextUrl.clone();
    installUrl.pathname = "/api/shopify/install";
    return NextResponse.redirect(installUrl);
  }
  const { supabaseResponse, user } = await updateSession(request);

  if (!user && !isPublicPath(pathname)) {
    const locale = pathname.startsWith("/fr") ? "fr" : "en";
    const loginPath = isStaffPath(pathname)
      ? locale === "fr"
        ? "/fr/staff/login"
        : "/staff/login"
      : locale === "fr"
        ? "/fr/login"
        : "/login";
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = loginPath;
    return copySupabaseCookies(supabaseResponse, NextResponse.redirect(redirectUrl));
  }

  if (user && pathname.includes("/login")) {
    const locale = pathname.startsWith("/fr") ? "fr" : "en";
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = locale === "fr" ? "/fr/home" : "/home";
    return copySupabaseCookies(supabaseResponse, NextResponse.redirect(redirectUrl));
  }

  const intlResponse = intlMiddleware(request);
  return copySupabaseCookies(supabaseResponse, intlResponse);
}

export const config = {
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
