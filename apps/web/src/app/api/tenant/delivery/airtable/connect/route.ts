import { NextResponse } from "next/server";
import { requireTenantIdFromSession } from "../session";
import {
  AIRTABLE_AUTHORIZE_URL,
  AIRTABLE_SCOPES,
  AIRTABLE_STATE_COOKIE,
  airtableOAuthConfig,
  encodeOAuthState,
  generatePkcePair,
  generateState,
} from "../shared";

export const runtime = "nodejs";

/**
 * Airtable connect start (FRONTEND_SPEC.md §6.8: "Airtable connect → OAuth
 * popup + postMessage"). Opened in a popup by the delivery page; redirects
 * the popup to Airtable's real OAuth2+PKCE authorize endpoint. State +
 * PKCE verifier are stashed in a short-lived signed cookie (never trusted
 * from the client), keyed to the caller's OWN tenant_id from their session
 * — never a client-supplied tenant_id (FRONTEND_AUDIT.md H1 pattern).
 */
export async function GET() {
  const tenantId = await requireTenantIdFromSession();
  if (!tenantId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const config = airtableOAuthConfig();
  if (!config) {
    return NextResponse.json({ error: "airtable_oauth_not_configured" }, { status: 501 });
  }

  const { verifier, challenge } = generatePkcePair();
  const state = generateState();

  const url = new URL(AIRTABLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", AIRTABLE_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(url.toString());
  response.cookies.set(AIRTABLE_STATE_COOKIE, encodeOAuthState({ tenantId, state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
