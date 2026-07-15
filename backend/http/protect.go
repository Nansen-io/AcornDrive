package http

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gtsteffaniak/filebrowser/backend/adapters/fs/files"
	"github.com/gtsteffaniak/filebrowser/backend/chainfs"
	"github.com/gtsteffaniak/filebrowser/backend/common/settings"
	"github.com/gtsteffaniak/filebrowser/backend/common/utils"
	"github.com/gtsteffaniak/filebrowser/backend/database/protection"
	"github.com/gtsteffaniak/filebrowser/backend/database/users"
	"github.com/gtsteffaniak/go-logger/logger"
)

const segmentThreshold = 10 * 1024 * 1024 // 10 MB

// protectHandler uploads a file to ChainFS and makes it read-only on disk.
// POST /api/chainfs/protect?path=<path>&source=<source>&hours=<hours>
func protectHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	encodedPath := r.URL.Query().Get("path")
	source := r.URL.Query().Get("source")
	hoursStr := r.URL.Query().Get("hours")

	filePath, err := url.QueryUnescape(encodedPath)
	if err != nil {
		return http.StatusBadRequest, fmt.Errorf("invalid path encoding: %w", err)
	}
	source, err = url.QueryUnescape(source)
	if err != nil {
		return http.StatusBadRequest, fmt.Errorf("invalid source encoding: %w", err)
	}

	hours := 24
	if hoursStr != "" {
		parsed, parseErr := strconv.Atoi(hoursStr)
		if parseErr != nil || parsed < 1 {
			return http.StatusBadRequest, fmt.Errorf("hours must be a positive integer")
		}
		hours = parsed
	}

	if d.user.LoginMethod != users.LoginMethodChainFs {
		return http.StatusForbidden, fmt.Errorf("ChainFS account required to protect files")
	}

	// Protection means "uploaded to ChainFS". Without ChainFS credentials we cannot do that, and we
	// must not pretend otherwise — an earlier version minted a fake FileGuid here and returned 200,
	// so users were told files were protected when nothing had been uploaded. Fail honestly instead.
	if d.user.AzureAccessToken == "" {
		logger.Errorf("protect: user %s has no ChainFS token — cannot upload %s", d.user.Username, filePath)
		return http.StatusUnauthorized, fmt.Errorf("no ChainFS credentials for this session, please sign in again")
	}

	if d.user.AzureTokenExpiry > 0 && time.Now().Unix() > d.user.AzureTokenExpiry {
		return http.StatusUnauthorized, fmt.Errorf("ChainFS token expired, please re-authenticate")
	}

	// Check subscription — prefer live acorn.tools check; fall back to cached flag.
	// acorn.tools keys subscriptions on the Azure "sub" claim, which is what the login paths send.
	// Username only happens to equal it for SSO users; fall back to it for records created before
	// AzureSub was persisted.
	azureSub := d.user.AzureSub
	if azureSub == "" {
		azureSub = d.user.Username
	}

	acornSubscribed := false
	if settings.Env.AcornToolsSecret != "" {
		access, accessErr := chainfs.CheckAcornToolsAccess(settings.Env.AcornToolsURL, settings.Env.AcornToolsSecret, azureSub)
		if accessErr != nil {
			logger.Errorf("acorn.tools subscription check failed for protect (%s): %v", d.user.Username, accessErr)
			return http.StatusServiceUnavailable, fmt.Errorf("could not verify subscription status, please try again")
		}
		acornSubscribed = access.HasAccess
		logger.Infof("acorn.tools protect check for %s: hasAccess=%v plan=%s", d.user.Username, acornSubscribed, access.PlanTier)
	} else {
		acornSubscribed = d.user.ChainFSSubscribed
	}

	if !acornSubscribed && !d.user.Permissions.Admin {
		return http.StatusPaymentRequired, fmt.Errorf("an active subscription is required to protect files")
	}

	// Resolve the real path on disk
	userScope, err := settings.GetScopeFromSourceName(d.user.Scopes, source)
	if err != nil {
		return http.StatusForbidden, err
	}
	userScope = strings.TrimRight(userScope, "/")
	scopedPath, err := utils.SafeScopedJoin(userScope, filePath)
	if err != nil {
		return http.StatusForbidden, err
	}

	fileInfo, err := files.FileInfoFaster(utils.FileOptions{
		Username:   d.user.Username,
		Path:       scopedPath,
		Source:     source,
		Expand:     false,
		ShowHidden: d.user.ShowHidden,
	}, store.Access)
	if err != nil {
		return errToStatus(err), err
	}
	if fileInfo.Type == "directory" {
		return http.StatusBadRequest, fmt.Errorf("cannot protect a directory")
	}

	// Open the file
	f, err := os.Open(fileInfo.RealPath)
	if err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	stat, err := os.Stat(fileInfo.RealPath)
	if err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to stat file: %w", err)
	}

	// Upload to ChainFS (segmented if >10MB). This must produce a real ChainFS FileGuid or fail —
	// a recorded protection with a synthetic FileGuid is worse than no protection, because the user
	// is told their file is on ChainFS when it is not.
	var fileGuid string
	{
		accessToken, err := decryptToken(d.user.AzureAccessToken)
		if err != nil {
			return http.StatusInternalServerError, fmt.Errorf("failed to decrypt access token: %w", err)
		}
		aesPassword := deriveUserAESPassword(d.user)
		chainfsConfig := settings.Config.Auth.Methods.ChainFsAuth

		if stat.Size() > segmentThreshold {
			fileGuid, err = chainfs.UploadFileSegmented(chainfsConfig.ApiBaseUrl, accessToken, stat.Name(), f, stat.Size(), aesPassword)
		} else {
			fileGuid, err = chainfs.UploadFile(chainfsConfig.ApiBaseUrl, accessToken, stat.Name(), f, aesPassword)
		}
		if err != nil {
			logger.Errorf("ChainFS upload failed for %s: %v", fileInfo.RealPath, err)
			return http.StatusBadGateway, fmt.Errorf("ChainFS upload failed: %w", err)
		}
		logger.Infof("ChainFS upload succeeded for %s, FileGuid: %s", fileInfo.RealPath, fileGuid)
	}

	// Persist protection metadata to database and central state file
	expiry := time.Now().Add(time.Duration(hours) * time.Hour).Unix()
	if err := store.Protection.Save(fileInfo.RealPath, fileGuid, expiry); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to save protection record: %w", err)
	}
	AcornStateSaveProtection(fileInfo.RealPath, fileGuid, expiry)

	return renderJSON(w, r, map[string]string{"fileGuid": fileGuid, "protectedUntil": time.Unix(expiry, 0).UTC().Format(time.RFC3339)})
}

// deriveUserAESPassword creates a stable per-user AES password from the server auth key + username.
func deriveUserAESPassword(user *users.User) string {
	material := settings.Config.Auth.Key + ":" + user.Username
	hash := sha256.Sum256([]byte(material))
	return hex.EncodeToString(hash[:])
}

// isSyntheticFileGuid reports whether a FileGuid was fabricated by the old ChainFS-bypass paths
// rather than returned by a real ChainFS upload. Such records represent files that were reported
// as protected without ever being uploaded, and are purged on startup (see InitAcornState).
func isSyntheticFileGuid(fileGuid string) bool {
	return strings.HasPrefix(fileGuid, "bypass-") || strings.HasPrefix(fileGuid, "acorn-bypass-")
}

// getProtectionRecord returns the protection record from DB.
// Records are restored from the central state file into BoltDB at startup
// (see InitAcornState), so a simple DB lookup is sufficient here.
func getProtectionRecord(realPath string) *protection.Record {
	r, _ := store.Protection.Get(realPath)
	return r
}

// IsFileProtected returns true if the file at realPath has a ChainFS protection record.
func IsFileProtected(realPath string) bool {
	return getProtectionRecord(realPath) != nil
}

// IsProtectionActive returns true if the file is protected AND its expiry has not yet passed.
func IsProtectionActive(realPath string) bool {
	r := getProtectionRecord(realPath)
	if r == nil {
		return false
	}
	if r.Expiry == 0 {
		return true
	}
	return time.Now().Unix() < r.Expiry
}

// ProtectionExpiresAt returns the Unix timestamp when protection expires, and whether one is set.
func ProtectionExpiresAt(realPath string) (int64, bool) {
	r := getProtectionRecord(realPath)
	if r == nil || r.Expiry == 0 {
		return 0, false
	}
	return r.Expiry, true
}

