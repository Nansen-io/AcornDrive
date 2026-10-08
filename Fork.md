# FileBrowser ChainFS Fork

## About

This is a fork of [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser) integrated with ChainFS - a blockchain-based file storage system with Azure AD B2C authentication.

**Original Project:** https://github.com/gtsteffaniak/filebrowser

**ChainFS API Environments:**
- DEV: https://nansendev.azurewebsites.net/swagger/v1/swagger.json
- UAT: https://nansenuat.azurewebsites.net/swagger/v1/swagger.json
- PROD: https://nansenprod.azurewebsites.net/swagger/v1/swagger.json

**ChainFS Source Code:** C:\git\azure-blockchain-workbench-app\NasenAPI

---

## Changes from Original Project

### 1. Custom Theme (Completed)

**Visual Changes:**
- Sidebar background: Teal (#3a7d82) instead of gray
- Header background: Teal (#3a7d82) instead of gray
- Sidebar/header text: Light (#f4f8f8) instead of dark
- Body text: Medium gray (#818793) instead of dark gray
- Links and accents: Teal (#448388) instead of blue
- File icon backgrounds: Light teal with hover states

**Files Modified:**
- `frontend/src/components/sidebar/Sidebar.vue`
- `frontend/src/components/sidebar/SidebarActions.vue`
- `frontend/src/views/bars/Default.vue`
- `frontend/src/components/files/Icon.vue`
- `frontend/public/index.html`
- `frontend/src/css/_variables.css`

**Details:** See `THEME_UPDATES_FINAL.md` for complete color specifications and implementation details.

### 2. Authentication Integration (In Progress)

**Goal:** Replace FileBrowser authentication with Azure AD B2C via ChainFS API.

**ChainFS Auth Endpoints:**
- Login URL: `/api/NansenFile/LoginURL`
- Logout URL: `/api/NansenFile/LogoutURL`

**Authentication Flow:**
1. User clicks "ChainFS Login"
2. Backend fetches Azure AD B2C login URL from ChainFS API
3. User authenticates with Azure AD B2C
4. Azure redirects back with authorization code
5. Backend exchanges code for tokens (access, ID, refresh)
6. Backend creates/updates FileBrowser user with encrypted Azure tokens
7. Backend issues FileBrowser JWT for session management

**Dual Token System:**
- **Azure tokens:** Stored encrypted in database, used for ChainFS API calls
- **FileBrowser JWT:** HTTP-only cookie for session management

**Status:** Implementation in progress (see Todo.md for remaining tasks)

### 3. Simplified Share Dialog

- Share type presets reordered and renamed: **Download**, **View Only**, **Upload - add files** (en.json labels; values `normal`/`viewOnly`/`upload` unchanged)
- "Customize Links" (share sidebar links) button removed from the share dialog; new shares still get the default QR/Download sidebar links
- Share password must be entered twice; the share is not created if the two entries differ
- Recipient's share password prompt button reads "Open" instead of "Login"

### 4. SAFEMode: a PIN per item (2026-10-01)

SAFEMode used to have one PIN per user, so every later add asked for the "PIN you set earlier" (Rose's feedback). Now:
- Each add asks for a new PIN (with confirmation). Every item added in that dialog gets that PIN, stored as `SafeModeItem.PINHash`.
- Anything inside a SAFEMode folder shares the folder's PIN. It is gated by the folder (blurred and PIN-prompted when reached while the folder is locked, e.g. via search) and can't be added separately.
- Unlocks are per item (10 min each). The menu's "Unlock SAFEMode" unlocks every item that uses the PIN entered. Removing needs the PIN of each item being removed.
- Items added before this change have no `PINHash` and keep using the user's old `SafeModePINHash`.
- PIN hashes are stripped from every response (`publicSafeModeItems`), and `PUT /api/users` keeps the stored SAFEMode values so a `which=all` save can't blank them.

**Key files:** `backend/http/safemode.go`, `backend/http/users.go`, `frontend/src/store/getters.js` / `mutations.js`, `frontend/src/components/prompts/SafeMode.vue` / `SafeModeUnlock.vue`

### 5. Session safety (2026-10-09)

Brings Drive in line with the other Joliro apps:
- **Session cookie ends with the browser.** Every login path and renew set one host-only, `SameSite=Lax` cookie with no expiry (`setSessionCookie`). Renew used to add a persistent `Domain=host` copy that survived closing the browser; it is now deleted on the next renew, logout or hub sign-out.
- **Logout clears both cookie forms** (`clearSessionCookies`), as `/api/auth/slo` already did.
- **Idle sign-out after 30 minutes**, with a warning and countdown for the last 5 (`utils/idle.ts`, `IdleWarning.vue`). It signs out of Drive and B2C, then lands on `https://www.joliro.org/login?signedOut=idle`. Last activity is shared across tabs in localStorage. A browser that restores the session is signed out before anything is drawn. The server sets `drive_new_session` at each real sign-in so a fresh login isn't mistaken for a stale one.
- **Quick Exit** button (red, next to Privacy screen). It blanks the page, signs out with a beacon, clears local traces, then `location.replace("https://www.cnn.com")`, the same as the hub (`utils/quickExit.ts`).
- **Local traces removed on every sign-out path**: `displayPreferences`, `sharepass:*` and the last-activity time (`clearLocalTraces`, mirrored in the `/api/auth/slo` page). Share passwords now live in sessionStorage. `viewModeHistory` is no longer written; nothing ever read it.
- **Privacy screen** now sits above toasts and the preview overlays, and hides the file name from the tab title while up.

The hub's single logout must call Drive at `/api/auth/slo`. On 7 Oct the hub was pointed at `/slo.html` (a Chain-FS-FrontEnd path), which Drive serves as the app shell with `X-Frame-Options: DENY`. That was reverted 9 Oct in ACORN-LandingPage `src/lib/auth/single-logout.ts`.

**Key files:** `backend/http/auth.go`, `backend/http/chainfs.go`, `frontend/src/utils/idle.ts` / `quickExit.ts` / `auth.js` / `slo.ts`, `frontend/src/components/IdleWarning.vue`, `frontend/src/views/bars/Default.vue`, `frontend/src/App.vue`

---

## Future Priorities

### Priority 2: ChainFS File Protection (Completed)

Right-click → Protect uploads a file to ChainFS and marks it as protected:
- Uploads file to ChainFS (segmented for files >10MB)
- Stores FileGuid and expiry in BoltDB (not xattrs — SMB/NFS compatible)
- Makes file read-only on disk
- Protected indicator (green dot) shown in file list
- Protected column is sortable
- Protected files cannot be deleted or moved until expiry
- Uploads authenticate to ChainFS with a static **service key** (`FILEBROWSER_CHAINFS_SERVICE_KEY`,
  sent as `X-Service-Key`) that NasenAPI maps to the shared service account. This replaced the
  earlier refresh-token scheme (2026-09-22), which needed a manual re-login whenever B2C expired
  or revoked the token. Files are stored as `<userID>_<filename>` so ownership is recoverable.

**Key files:**
- `backend/database/protection/protection.go` — BoltDB storage for protection records
- `backend/http/protect.go` — protectHandler, IsFileProtected, ProtectionExpiresAt
- `backend/chainfs/client.go` — ChainFS client; `Auth` (bearer token vs service key)
- `backend/http/internal.go` — x-api-key list/download/upload used by the monitor and Diary
- `backend/http/resource.go` — populates Protected/ProtectedUntil fields on listing
- `frontend/src/components/files/ListingItem.vue` — green dot indicator
- `frontend/src/views/files/ListingView.vue` — protected column + sort
- `frontend/src/css/listing.css` — column styles

### Priority 3: Azure Hosting (In Progress)

Deploy three instances to Azure:
- DEV → Points to ChainFS DEV environment (nansendev.azurewebsites.net)
- UAT → Points to ChainFS UAT environment (nansenuat.azurewebsites.net)
- PROD → Points to ChainFS PROD environment (nansenprod.azurewebsites.net)

**Infrastructure:** Azure Container Apps + Azure Files NFS + acorntoolsregistry (ACR)
**Resource group:** rg-acorntools
**Storage account:** acorndrive (shares: acorndrive-srv 100GiB, acorndrive-data 32GiB)
**CI/CD:** GitHub Actions with OIDC auth (see BUILD.md)

**Status:** Infrastructure being set up. GitHub Actions workflow pending creation.

---

## Documentation

- **BUILD.md** - Build, run, and troubleshooting instructions
- **Todo.md** - Current tasks and future planning
- **THEME_UPDATES_FINAL.md** - Complete theme implementation details
- **README.md** - Original FileBrowser documentation

---

## Development

See **BUILD.md** for instructions on:
- Building frontend and backend
- Running locally with ChainFS DEV environment
- Configuration options
- Troubleshooting

---

**Fork Status:** Active Development
**Current Focus:** Priority 1 (Authentication Integration)