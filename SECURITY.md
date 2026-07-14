# Security configuration (AcornDrive / FileBrowser fork)

## Secrets — never commit these; supply via environment / Key Vault

| Env var | Purpose |
|---|---|
| `FILEBROWSER_JWT_TOKEN_SECRET` | Signs all session JWTs and encrypts stored Azure tokens. 32+ random bytes. If unset, a random key is generated and persisted on first init. **Set this in prod to control rotation.** |
| `FILEBROWSER_CHAINFS_CLIENT_SECRET` | Azure AD B2C client secret (only for a confidential client). |
| `FILEBROWSER_CHAINFS_ISSUER_URL` | **REQUIRED when chainfs auth is enabled.** B2C ID-token issuer. Must equal the exact `iss` claim of B2C ID tokens. When unset, interactive B2C logins are **refused** — see below. |
| `FILEBROWSER_ACORN_TOOLS_SECRET` | API key for the acorn.tools internal subscription + ChainFS-token endpoints. |
| `FILEBROWSER_ACORN_DRIVE_SSO_SECRET` | HMAC secret verifying SSO handover tokens from the acorn.tools hub. Without it, tile logins are rejected. |
| `ACORN_DRIVE_API_SECRET` | Auth for the internal delete-user endpoint (≥16 chars). |
| `FILEBROWSER_ONLYOFFICE_SECRET` / `integrations.onlyoffice.secret` | Verifies OnlyOffice callback JWTs. Required to prevent callback forgery/SSRF. |

Config files (`config*.yaml`) and `acorndrive-prod.yaml` must contain **no** secret values — only `secretRef` / env references.

### Non-secret endpoint settings (env-overridable, so no rebuild is needed to change them)

| Env var | Purpose |
|---|---|
| `FILEBROWSER_CHAINFS_LOGIN_URL` | B2C authorize endpoint (with `client_id` + `scope`). |
| `FILEBROWSER_CHAINFS_TOKEN_URL` | B2C token endpoint. |
| `FILEBROWSER_CHAINFS_LOGOUT_URL` | B2C logout endpoint. |
| `FILEBROWSER_CHAINFS_DISCOVERY_URL` | Where B2C serves OIDC metadata (user-flow path). Derived from the login URL when unset. |
| `FILEBROWSER_CHAINFS_API_BASE_URL` | ChainFS API base URL — where protected files are uploaded. |

### B2C needs two URLs, and they are not interchangeable

Azure AD B2C is off-spec: the `iss` it mints is in **tenant-GUID** form, but it serves **no OIDC metadata there** (that URL 404s). The metadata lives under the **user-flow** path and advertises the GUID issuer. So:

- `issuerUrl` — the exact `iss` claim: `https://<tenant>.b2clogin.com/<tenant-guid>/v2.0/`
- `discoveryUrl` — where metadata lives: `https://<tenant>.b2clogin.com/<tenant>.onmicrosoft.com/<policy>/v2.0`

Setting `issuerUrl` alone does **not** work — discovery from it 404s, and discovering from the user-flow path without pinning the issuer fails as a mismatch. The code discovers from `discoveryUrl` and pins validation to `issuerUrl`; `iss` is still fully verified. Confirm the issuer for any new tenant before switching:

```
curl -s https://<tenant>.b2clogin.com/<tenant>.onmicrosoft.com/<policy>/v2.0/.well-known/openid-configuration | jq .issuer
```

Identity (`login`/`token`/`logout`/`issuer`) and storage (`apiBaseUrl`) are **separate concerns** and are configured independently. `apiBaseUrl` is only used as a fallback for identity when the B2C endpoints above are unset. In the current deployment both point at the same Azure directory, so they must be moved between environments **together**.

## Why issuerUrl is mandatory

`chainfs` auth runs with `createUser: true` and grants admin from a claim inside the ID token (`adminClaim`). If the token's signature is not verified, a forged token is an **admin-account forgery primitive**. Accordingly, `parseAndVerifyIDToken` **fails closed**: with no `issuerUrl`, interactive B2C logins are refused rather than trusted.

SSO logins from the hub are unaffected — they are authenticated by HMAC (`FILEBROWSER_ACORN_DRIVE_SSO_SECRET`), not by an ID token.

`FILEBROWSER_CHAINFS_INSECURE_SKIP_VERIFY=true` restores the old unverified behaviour for **local development only**. Never set it on a deployed environment.

## Rotation after the leaked-key incident
The previous `auth.key` and B2C `clientSecret` were committed to git history and **must be rotated**:

1. Generate a new key: `openssl rand -base64 32`.
2. Store it in Key Vault and reference it via `FILEBROWSER_JWT_TOKEN_SECRET` (see `acorndrive-prod.yaml` secretRefs).
3. Rotate the B2C client secret in the Azure portal; update `FILEBROWSER_CHAINFS_CLIENT_SECRET`.
   (The value previously committed at `backend/config.yaml:15` is compromised and is still in git history.)
4. Rotate `FILEBROWSER_ACORN_TOOLS_SECRET` (shared with acorn.tools) on both sides.
   (The value previously committed at `acorndrive-prod.yaml:217` is compromised and is still in git history.)
5. Purge the old values from git history (`git filter-repo` / BFG) and force-push — coordinate with the team first.
6. Rotating the JWT key invalidates existing sessions; users simply re-authenticate via B2C.

Removing a secret from the working tree does **not** remove it from history. Steps 3–5 are all required.

## Hardening enabled in code
- Path/scope/symlink containment on all file resolution (`SafeScopedJoin`, source-root guard in `GetRealPath`).
- OnlyOffice callback JWT signature verification + outbound-fetch host allowlist (SSRF guard).
- Open-redirect protection on the B2C login `redirect` parameter.
- HSTS + baseline CSP; constant-time secret comparisons; per-share password brute-force throttling; trusted-proxy XFF handling.
