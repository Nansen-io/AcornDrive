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

**Key files:**
- `backend/database/protection/protection.go` — BoltDB storage for protection records
- `backend/http/protect.go` — protectHandler, IsFileProtected, ProtectionExpiresAt
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