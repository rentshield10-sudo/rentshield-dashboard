import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// Routes that must stay reachable without a dashboard login: the login
// page/API itself, the token-gated public landlord page, inbound
// webhooks that external services (Quo/OpenPhone, n8n) call directly and
// cannot present a browser session cookie for, and the tenant-facing
// signing page.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/landlord",
  "/api/landlord",
  "/api/messages-automation/webhook",
  "/sign-renewal",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// The tenant's own signing-token API calls (status/verify/sign) must be
// reachable without an admin session — the token itself is the tenant's
// credential. /api/lease-signing/requests (creating a signing request) is
// staff-initiated and stays behind the normal admin login.
function isLeaseSigningTokenPath(pathname: string) {
  return (
    pathname.startsWith("/api/lease-signing/") &&
    !pathname.startsWith("/api/lease-signing/requests")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname) || isLeaseSigningTokenPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await verifySessionToken(token);

  if (authed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
