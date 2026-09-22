# ChainFS service auth: stop the service token expiring (2026-09-22)

**Status:** Option B implemented 2026-09-22 (NasenAPI `Authentication/ServiceKeyAuthentication.cs`,
Drive `chainfs.Auth` + `FILEBROWSER_CHAINFS_SERVICE_KEY`). Key configured on NansenPROD
(`ServiceKeys__0__*`) and as Drive container secret `chainfs-service-key`. Remaining: deploy
NasenAPI master to PROD (`NasenAPI/deploy.ps1 -Env prod`), push Drive main, remove the old
`FILEBROWSER_CHAINFS_SERVICE_USERNAME` env, protect a test file. Root cause of the 21 Sep outage
was separate: the PROD B2C user flow `B2C_1_signupsignin1` NasenAPI validated against was deleted;
fixed via App Service setting `AzureAdB2C__SignUpSignInPolicyId=B2C_1_signup_signin`.

## Why it keeps expiring
Drive authenticates to ChainFS (NasenAPI) as a B2C *user* (andrew@nansen.io / f4ed52b5) using a
refresh token captured at login and rotated on every upload (`backend/http/chainfs.go`
`refreshChainFsAccessToken`, stored encrypted in `/srv/.acornstate.json`). B2C user-flow refresh
tokens are designed to die: default 14-day lifetime (max 90), plus a 90-day bounded sliding window
after which B2C forces an interactive sign-in regardless. They are also revoked on password
change / MFA / session revocation, and every normal sign-in by andrew@nansen.io overwrites the
stored token (chainfs.go:429). Infra is NOT the problem any more: single replica, `/srv` is an
Azure Files mount, `AUTH_KEY_PROD` is stable. A user refresh token can never be permanent.

## Fix: authenticate as a service, not a user (pick ONE)

### Option B — service key in NasenAPI (recommended: no B2C in the loop, no file migration)
NasenAPI (`C:\Users\Andrew\Development\azure-blockchain-workbench-app\NasenAPI`):
1. Add `ServiceKeyAuthenticationHandler` (scheme "ServiceKey"): reads `X-Service-Key`, constant-time
   compares against `ServiceAccounts:[{Name,Key,UserGuid}]` from App Service settings (never in
   appsettings.*.json), and issues a ClaimsPrincipal with `ClaimTypes.NameIdentifier=UserGuid`
   and `name=Name`. `UserGuid` = existing service account `f4ed52b5-…` so all files already
   stored stay listable/downloadable. Note `UserService.UserInfo` renames the DB row if `name`
   differs — set Name to the current DB value.
2. Least privilege: the handler only succeeds on an allow-list of paths (FileCreate + segmented
   upload, EnumerateFiles, FileDownloadBinary); everything else stays B2C-only.
3. `Program.cs`: register the scheme and set the default authorization policy to accept
   `JwtBearer` OR `ServiceKey` (`AuthorizationPolicyBuilder(...).RequireAuthenticatedUser()`),
   so the existing `[Authorize]` controllers need no edits.
4. Keys: 32+ random bytes, one per environment, list supports two keys for rotation. Log each
   service-key request (name + path) for audit.
5. Deploy NasenAPI PROD; verify with curl against EnumerateFiles.

Drive (this repo):
6. New env `FILEBROWSER_CHAINFS_SERVICE_KEY` (Container App secret via deploy.yml, like the
   client secret). `chainfs/client.go`: replace the five `Authorization: Bearer` sites with a
   `setAuth(req, cred)` helper that sends `X-Service-Key` for a service credential.
7. `serviceChainfsToken()` (internal.go) and the service branch in `protect.go` return the key
   instead of doing a refresh_token grant.
8. Delete the refresh-token machinery: capture in `chainfsCallbackHandler`, the licence bypass
   for `ServiceUsername` in `loginWithChainFsUser`, `ServiceRefreshToken` in acornstate.go,
   `refreshChainFsAccessToken` and the `ServiceUsername` setting. Service mode = key is set.
9. Update Fork.md / BUILD.md; remove the "service account must sign in once" runbook.

### Option A — B2C client-credentials flow (no NasenAPI code, but identity changes)
Portal: add an `appRoles` entry (Application type) on the tasks-api registration f415826b, grant
f415826b that application permission to itself, admin consent, `accessTokenAcceptedVersion=2`.
Drive: POST `grant_type=client_credentials` + `scope=https://nansenprod.onmicrosoft.com/tasks-api/.default`
to the existing tokenUrl with the existing client secret; cache the access token in memory until
`exp-60s`. Token `sub` = the app's service-principal object id, so NasenAPI auto-creates a NEW
Users row on first call → SQL `Subscribed=1, IsEnterprise=1, SubscriptionExpires='9999-12-31'`.
Cost: files already uploaded under f4ed52b5 belong to a different ChainFS user and must be
re-protected (or stay reachable only via the personal account). Feature is still "public preview"
in B2C, and B2C is end-of-sale.

### Stop-gap available today (portal only, not permanent)
B2C → User flows → `B2C_1_signup_signin` → Properties → Token lifetime: Refresh token lifetime
90 days, sliding window "No expiry". Removes the 14-day inactivity cliff and the 90-day forced
re-auth; still dies on password change / revocation / overwrite by a personal login.

---

# Goal

I need filebrowser GUI (this repo) to match the same colour scheme used here: `https://www.acorn.tools/login`

I will use --chrome option in claude code to enable the agent to inspect the CSS for filebrowser frontend which is usually accessed with `http://localhost:8080`

## References

### Muted Font

`https://www.acorn.tools/login` `class="text-sm text-muted-foreground"`


### Link Font Colour

```
<a class="text-sm text-primary hover:text-primary/80 transition-colors" href="/forgot-password">Forgot Password?</a>
```

colour: `#50898e`

It is the link colour used by `https://www.acorn.tools/login`


## Issues

### Hide

In right side bar menu

```
<div data-v-3237c3ef="" class="sidebar-actions card">
```


hide

```
<button data-v-3237c3ef="" class="action button action-button" aria-label="Share"><i data-v-3237c3ef="" class="material-icons action-icon">share</i><span data-v-3237c3ef="">Share</span></button>
```

### Colours


```
<a href="/settings#profile-main" class="person-button action button"><i class="material-icons">person</i> 16f9a1f4-4367-4d15-82b1-2e2fe44d9503 <i aria-label="settings" class="material-icons">settings</i></a>
```

The text `16f9a1f4-4367-4d15-82b1-2e2fe44d9503` is the wrong colour.

use `### Muted Font` 