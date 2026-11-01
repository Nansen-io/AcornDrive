# Security Review

Last updated: 2026-11-01 · Version: 2.0.0.0

Static security review of joliroDrive/AcornDrive (this Go backend + Vue frontend) and the
sibling `ACORN-LandingPage` (Vercel + Supabase) that backs subscriptions and SSO. Findings are
listed with their remediation status. No active/live attack traffic was used; this is a source
audit plus an authorized self-test plan.

## Controls verified correct (do not regress)

- B2C ID-token verification **fails closed** when `issuerUrl` is unset (`backend/http/chainfs.go`),
  and prod config sets `issuerUrl`. Admin is granted only from a verified `roles` claim.
- PKCE S256 + `crypto/rand`; OAuth `state` nonce for CSRF.
- One-time (`jti`) replay protection and 60s expiry on hub SSO tokens; HMAC-SHA256 verified in
  constant time.
- AES-GCM at rest for Azure tokens; bcrypt + per-share rate limiting for share passwords.
- HSTS, strong baseline CSP, nonce'd SLO page, `HttpOnly`/`Secure`/`SameSite` session cookie.
- `X-Forwarded-Proto`/`-Host` honored only from a trusted (private) peer.
- Supabase service-role key is server-only (never `NEXT_PUBLIC_*`); queries parameterized;
  self-service account deletion disabled; internal endpoints use a constant-time secret check.

## Findings and remediation status

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| P2 | Medium | Revoked (logged-out) JWT still honored on `withOrWithoutUser` read endpoints — `extractUserFromExpiredToken` did not check the revocation list. | **Fixed** — `auth.IsRevokedApiKey` check added (`backend/http/middleware.go`). |
| P3 | Low-Med | Open redirect: SSO `next` param blocked `//` but not `/\` (normalized to `//` by browsers). | **Fixed** — routed through `sanitizeLocalRedirect` (`backend/http/chainfs.go`). |
| F3 | Low | Login `redirect` query param passed to `router.push` without validation. | **Fixed** — local-path guard added (`frontend/src/views/Login.vue`). |
| P4 | Low-Med | Crypto key reuse: `Auth.Key` used for JWT signing and Azure-token encryption. | **Fixed** — token key now HKDF-derived with a distinct info label; backward-compatible decrypt fallback (`backend/http/chainfs.go`, test in `chainfs_crypto_test.go`). |
| S2 | Low | `ACORN-LandingPage` accepted an over-short `X-Api-Key` shared secret. | **Fixed** — min-length (16) enforced in `src/lib/auth/shared-secret.ts` (separate repo). |
| B4 | Low (config) | OnlyOffice callback JWT unverified when `integrations.onlyoffice.secret` unset. | **Accepted** — confirmed acceptable for current deployment. |
| S3 | Low | Supabase tables rely on application-layer checks (service-role bypasses RLS). | **Done** — RLS defense-in-depth addressed in the landing-page repo. |

### Not findings (verified against current code)
- **F1** — a `document.cookie` JWT-deletion line seen in an older checkout does not exist in the
  deployed tree; the session cookie is `HttpOnly` and the token is never placed in web storage.
- **F2** — the logout `logoutUrl` is the intentional, config-derived B2C end-session redirect, not
  user input; left as designed.
- **S1** — the landing-page `x-api-key` comparison already uses `timingSafeEqual`.

## Authorized self-test plan

Run against staging where possible; no infrastructure scanning or DoS (prohibited by Vercel and
Supabase terms — route any infra testing through their security channels).

1. Session invalidation: log in, capture cookie, log out, replay cookie on `/api/resources` and
   `/api/raw` — expect anonymous/401.
2. Open redirect: `/api/auth/sso?...&next=/\example.com` with a valid test token — expect internal
   landing only. Repeat for the login `redirect` param.
3. SSO replay: re-send a used token (same `jti`) — expect rejection.
4. Internal API authz: call `/api/internal/*` with no key, wrong key, short key — expect 401.
5. Share password brute force: confirm the per-share rate limiter trips.
6. Subscription gate: a non-subscribed, non-admin user is redirected to `login?error=subscription`.
