# Build & Development Guide

This guide covers building, testing, developing, and deploying AcornDrive.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start (DEV Build)](#quick-start-dev-build)
- [Running the Application](#running-the-application)
- [Misc Info](#misc-info)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Azure Deployment](#azure-deployment)
  - [Infrastructure Overview](#infrastructure-overview)
  - [Azure Infrastructure Setup (Portal)](#azure-infrastructure-setup-portal)
  - [GitHub Actions CI/CD](#github-actions-cicd)
- [Useful Commands](#useful-commands)

---

## Prerequisites

**Backend (Go):**
- Go 1.25.0 or higher
- git

**Frontend (Vue.js):**
- Node.js 18+ (LTS recommended)
- npm 9+ or yarn

**Operating System:**
- Linux

---

## Quick Start (DEV Build)

### Frontend

```bash
cd /home/mem/git/filebrowser/frontend
npm install
npm run build
```

### Backend

note: requires frontend to be built.

```bash
cd /home/mem/git/filebrowser/backend

# Development build (use this by default)
go build -o filebrowser

# Production build (optimized), only use for deployment
go build -ldflags="-s -w" -o filebrowser
```

### Run

note: requires frontend and backend to have been built.

```bash
cd /home/mem/git/filebrowser/backend
./filebrowser -c config.dev.yaml
```

Open browser to: `http://localhost:8080`

---

## Running the Application

The application uses YAML configuration files:

- `config.yaml` - Default configuration
- `config.dev.yaml` - DEV environment (points to nansendev.azurewebsites.net)
- `config.uat.yaml` - UAT environment (points to nansenuat.azurewebsites.net)
- `config.prod.yaml` - PROD environment (points to nansenprod.azurewebsites.net)

**Using specific config:**

```bash
cd /home/mem/git/filebrowser/backend

./filebrowser -c config.dev.yaml
./filebrowser -c config.uat.yaml
./filebrowser -c config.prod.yaml
```

---

## Misc Info

### Command-line flags

```bash
./filebrowser -h                  # Show help
./filebrowser -c                  # Print default config
./filebrowser version             # Show version info
```

### Default Ports

- **DEV/UAT:** `8080`
- **PROD:** `80`

### Accessing the Application

After starting the server:
1. Open browser to `http://localhost:8080` (or configured port)
2. You should see the login page with **"ChainFS Login"** button
3. Click "ChainFS Login" to authenticate via Azure AD B2C

### Initial Admin User

**ChainFS authentication (enabled by default):**
- Users are auto-created on first Azure AD B2C login
- Admin status determined by Azure AD roles/groups claim

**Password authentication (disabled by default):**
- Username: `admin`
- Password: `admin`

---

## Testing

### Backend

```bash
cd /home/mem/git/filebrowser/backend

go test ./...
go test -cover ./...
go test ./http/...
go test -v ./...
go test -run TestChainFsLogin ./http/...
```

### Frontend

```bash
cd /home/mem/git/filebrowser/frontend

npm run test
npm run test:coverage
npm run test:watch
```

### Database

```bash
sqlite3 database.db
sqlite> SELECT id, username, loginMethod FROM users;
sqlite> SELECT username, azureAccessToken, azureTokenExpiry FROM users;
sqlite> .quit
```

---

## Troubleshooting

### Frontend build fails

```bash
cd /home/mem/git/filebrowser/frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Backend build fails with "template: pattern matches no files"

```bash
# Frontend not built yet — build it first
cd /home/mem/git/filebrowser/frontend
npm run build

cd /home/mem/git/filebrowser/backend
go build -o filebrowser
```

### Go module issues

```bash
cd /home/mem/git/filebrowser/backend
go mod tidy
go mod download
go build -o filebrowser
```

### Common Runtime Issues

#### "Auth Methods: [password]" instead of "Auth Methods: [chainfs]"

```yaml
# config.dev.yaml
auth:
  methods:
    chainfs:
      enabled: true
    password:
      enabled: false
```

#### "Invalid redirect URI" from Azure AD B2C

Register this callback URL in Azure AD B2C application settings:
```
http://localhost:8080/api/auth/chainfs/callback
```

#### "User does not exist"

```yaml
auth:
  methods:
    chainfs:
      createUser: true
```

#### Port already in use

```bash
killall filebrowser
netstat -tupln | grep 8080
```

#### Database locked

```bash
killall filebrowser
cd /home/mem/git/filebrowser/backend
rm database.db-shm database.db-wal
```

### Viewing Logs

```yaml
server:
  logging:
    - levels: "debug|info|warning|error"
```

---

## Azure Deployment

### Infrastructure Overview

```
Custom Domain (app.acorndrive.com)
        │
        ▼
Azure Front Door Standard
  (SSL, CDN, WAF, custom domain)
        │
        ▼
Azure Container App  ←── acorntoolsregistry (ACR)
  Go binary (port 8080)
  config via FILEBROWSER_CONFIG env var
        │
        ├── acorndrive-srv  (NFS, 100 GiB) → /srv   user files
        └── acorndrive-data (NFS, 32 GiB)  → /data  database + config
```

**Resource group:** `rg-acorntools`
**Container registry:** `acorntoolsregistry`
**Storage account:** `acorndrive`

Three independent environments (DEV / UAT / PROD) each get their own Container App and config file.

### Azure Infrastructure Setup (Portal)

#### Step 1 — Storage Account (acorndrive)

Already created. Shares required:

| Share | Protocol | Size |
|---|---|---|
| acorndrive-srv | NFS | 100 GiB |
| acorndrive-data | NFS | 32 GiB |

To enable NFS: **Settings → Configuration → Secure transfer required → Disabled**

Upload the appropriate config file to `acorndrive-data`:
- Go to **Storage browser → File shares → acorndrive-data → Browse → Upload**
- Upload `config.prod.yaml` (or `config.uat.yaml` / `config.dev.yaml` as needed)

#### Step 2 — Container Apps Environment

1. Search **Container Apps Environments** → **Create**
2. Name: `acorndrive-env`
3. Resource group: `rg-acorntools`
4. Region: Australia Southeast
5. On the **Workload profiles** tab: select **Consumption only**
6. Click **Create**

After creation, register both storage mounts:
- Go to `acorndrive-env` → **Storage** → **Add**
- Storage name: `srv`, Storage account: `acorndrive`, File share: `acorndrive-srv`, Access mode: **Read/Write**
- Repeat: Storage name: `data`, File share: `acorndrive-data`, Access mode: **Read/Write**

#### Step 3 — Container App (one per environment)

1. Search **Container Apps** → **Create**
2. Name: `acorndrive-prod` (or `-uat`, `-dev`)
3. Resource group: `rg-acorntools`
4. Container Apps Environment: `acorndrive-env`
5. On **Container** tab:
   - Image source: **Azure Container Registry**
   - Registry: `acorntoolsregistry`
   - Image: `acorndrive`
   - Tag: `prod` (or `uat`, `dev`)
   - Environment variable: `FILEBROWSER_CONFIG` = `/data/config.prod.yaml`
6. On **Volumes** tab → **Add volume**:
   - Name: `srv`, Volume type: **Azure file share**, Storage: `srv`
   - Name: `data`, Volume type: **Azure file share**, Storage: `data`
7. On **Volume mounts** tab:
   - Mount `srv` → `/srv`
   - Mount `data` → `/data`
8. On **Ingress** tab: Enable ingress, Port `8080`, External traffic
9. Click **Create**

#### Step 4 — Entra ID App Registration (for GitHub Actions)

1. **Microsoft Entra ID → App registrations → New registration**
   - Name: `acorndrive-github-actions`
   - Click **Register**
2. Copy: **Application (client) ID** and **Directory (tenant) ID**
3. Go to **Subscriptions** and copy your **Subscription ID**
4. Back on the app registration → **Certificates & secrets → Federated credentials → Add credential**
   - Scenario: **GitHub Actions**
   - Organization: your GitHub org/username
   - Repository: your repo name
   - Entity type: **Branch**

   Add one credential per environment:

   | Branch | Name |
   |---|---|
   | `dev` | `github-dev` |
   | `uat` | `github-uat` |
   | `main` | `github-prod` |

5. **Assign roles:**
   - On `acorntoolsregistry` → **Access control (IAM) → Add role assignment → AcrPush** → assign to `acorndrive-github-actions`
   - On `rg-acorntools` → **Access control (IAM) → Add role assignment → Contributor** → assign to `acorndrive-github-actions`

#### Step 5 — GitHub Repository Secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID |

### GitHub Actions CI/CD

Create `.github/workflows/deploy.yml` in the repo:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main, uat, dev]

permissions:
  id-token: write
  contents: read

env:
  REGISTRY: acorntoolsregistry.azurecr.io
  IMAGE: acorndrive

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set environment from branch
        run: |
          if [ "${{ github.ref_name }}" = "main" ]; then
            echo "ENV=prod" >> $GITHUB_ENV
            echo "CONTAINER_APP=acorndrive-prod" >> $GITHUB_ENV
          elif [ "${{ github.ref_name }}" = "uat" ]; then
            echo "ENV=uat" >> $GITHUB_ENV
            echo "CONTAINER_APP=acorndrive-uat" >> $GITHUB_ENV
          else
            echo "ENV=dev" >> $GITHUB_ENV
            echo "CONTAINER_APP=acorndrive-dev" >> $GITHUB_ENV
          fi

      - name: Azure login
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Log in to ACR
        run: az acr login --name acorntoolsregistry

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build frontend
        run: |
          cd frontend
          npm ci
          npm run build

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'

      - name: Build backend
        run: |
          cd backend
          go build -ldflags="-s -w" -o filebrowser

      - name: Build and push Docker image
        run: |
          docker build -t $REGISTRY/$IMAGE:$ENV -f _docker/Dockerfile .
          docker push $REGISTRY/$IMAGE:$ENV

      - name: Deploy to Container App
        run: |
          az containerapp update \
            --name $CONTAINER_APP \
            --resource-group rg-acorntools \
            --image $REGISTRY/$IMAGE:$ENV
```

**Deployment flow:**
- Push to `dev` → auto-deploys to `acorndrive-dev`
- Push to `uat` → auto-deploys to `acorndrive-uat`
- Push to `main` → auto-deploys to `acorndrive-prod`

---

## Useful Commands

```bash
go version
node --version
npm --version
./filebrowser version

# Clean build artifacts
cd backend && go clean
cd frontend && rm -rf dist node_modules
```

---

## Additional Resources

- **Fork tracking:** [Fork.md](Fork.md)
- **Original FileBrowser:** https://github.com/gtsteffaniak/filebrowser
- **ChainFS API Docs:** Swagger endpoints at ChainFS API URLs
- **Vue.js 3 Docs:** https://vuejs.org/
- **Go Documentation:** https://golang.org/doc/
