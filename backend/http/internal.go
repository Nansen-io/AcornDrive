package http

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gtsteffaniak/filebrowser/backend/chainfs"
	"github.com/gtsteffaniak/filebrowser/backend/common/settings"
	"github.com/gtsteffaniak/go-logger/logger"
)

// internalAuthorized reports whether the request carries the shared internal API key. Fails closed
// if no secret is configured or it is too short; the comparison is constant-time.
func internalAuthorized(r *http.Request) bool {
	secret := os.Getenv("ACORN_DRIVE_API_SECRET")
	provided := r.Header.Get("x-api-key")
	return len(secret) >= 16 && subtle.ConstantTimeCompare([]byte(provided), []byte(secret)) == 1
}

// serviceChainfsToken mints a fresh ChainFS access token for the shared service account from its
// stored refresh token, rotating the stored token if ChainFS returns a new one. This is the same
// mechanism protectHandler uses for uploads.
func serviceChainfsToken(ctx context.Context) (string, error) {
	enc := AcornStateGetServiceRefreshToken()
	if enc == "" {
		return "", fmt.Errorf("the ChainFS service account has not completed its one-time sign-in")
	}
	rt, err := decryptToken(enc)
	if err != nil {
		return "", fmt.Errorf("decrypt service refresh token: %w", err)
	}
	at, newRt, err := refreshChainFsAccessToken(ctx, rt)
	if err != nil {
		return "", fmt.Errorf("refresh service token: %w", err)
	}
	if newRt != "" && newRt != rt {
		if nenc, encErr := encryptToken(newRt); encErr == nil {
			AcornStateSaveServiceRefreshToken(nenc)
		}
	}
	return at, nil
}

// splitOwnerName splits a stored ChainFS name "<userID>_<original>" into its owner id and display
// name. Files are uploaded as "<username>_<filename>"; the username (an Azure GUID) contains no
// underscore, so the first underscore is the separator. Names without one are returned as-is.
func splitOwnerName(raw string) (owner, name string) {
	if i := strings.IndexByte(raw, '_'); i >= 0 {
		return raw[:i], raw[i+1:]
	}
	return "", raw
}

func parseUintDefault(s string, def uint) uint {
	if s == "" {
		return def
	}
	n, err := strconv.ParseUint(s, 10, 32)
	if err != nil {
		return def
	}
	return uint(n)
}

// internalChainfsFilesHandler handles GET /api/internal/chainfs/files — lists every file stored
// under the ChainFS service account (read-only). Authenticated via x-api-key.
func internalChainfsFilesHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	if !internalAuthorized(r) {
		logger.Warningf("[internal-chainfs] unauthorized file-list attempt from %s", r.RemoteAddr)
		return http.StatusUnauthorized, fmt.Errorf("unauthorized")
	}

	chainfsConfig := settings.Config.Auth.Methods.ChainFsAuth
	if chainfsConfig.ServiceUsername == "" {
		return http.StatusServiceUnavailable, fmt.Errorf("no ChainFS service account configured")
	}

	token, err := serviceChainfsToken(r.Context())
	if err != nil {
		logger.Errorf("[internal-chainfs] service token: %v", err)
		return http.StatusServiceUnavailable, fmt.Errorf("ChainFS service account unavailable: %w", err)
	}

	rangeStart := parseUintDefault(r.URL.Query().Get("start"), 0)
	rangeSize := parseUintDefault(r.URL.Query().Get("size"), 1000)
	if rangeSize == 0 || rangeSize > 2000 {
		rangeSize = 2000
	}

	records, total, err := chainfs.ListFiles(chainfsConfig.ApiBaseUrl, token, rangeStart, rangeSize)
	if err != nil {
		logger.Errorf("[internal-chainfs] list failed: %v", err)
		return http.StatusBadGateway, fmt.Errorf("could not list ChainFS files: %w", err)
	}

	type outFile struct {
		FileGuid  string `json:"fileGuid"`
		Owner     string `json:"owner"`
		Name      string `json:"name"`
		RawName   string `json:"rawName"`
		SizeBytes int64  `json:"sizeBytes"`
		CreatedAt string `json:"createdAt"`
		Sha256    string `json:"sha256"`
		Archived  bool   `json:"archived"`
	}
	files := make([]outFile, 0, len(records))
	for _, rec := range records {
		owner, name := splitOwnerName(rec.Name)
		files = append(files, outFile{
			FileGuid:  rec.FileGuid,
			Owner:     owner,
			Name:      name,
			RawName:   rec.Name,
			SizeBytes: rec.SizeBytes,
			CreatedAt: rec.DateCreated,
			Sha256:    rec.Sha256Hash,
			Archived:  rec.Archived,
		})
	}

	return renderJSON(w, r, map[string]interface{}{"files": files, "total": total})
}

// internalChainfsUploadHandler handles POST /api/internal/chainfs/upload?owner=<id>&filename=<name>
// — uploads the raw request body to ChainFS under the shared service account as "<owner>_<filename>".
// For sibling joliro apps (Diary, ...) that can't hold the service token themselves. Authenticated
// via x-api-key. Stored unencrypted so the bytes remain retrievable/verifiable (the returned sha256
// is the real file hash). Returns {fileGuid, name, sizeBytes, sha256}.
func internalChainfsUploadHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	if !internalAuthorized(r) {
		logger.Warningf("[internal-chainfs] unauthorized upload attempt from %s", r.RemoteAddr)
		return http.StatusUnauthorized, fmt.Errorf("unauthorized")
	}

	filename := r.URL.Query().Get("filename")
	if filename == "" {
		return http.StatusBadRequest, fmt.Errorf("filename is required")
	}
	owner := r.URL.Query().Get("owner")

	chainfsConfig := settings.Config.Auth.Methods.ChainFsAuth
	if chainfsConfig.ServiceUsername == "" {
		return http.StatusServiceUnavailable, fmt.Errorf("no ChainFS service account configured")
	}

	token, err := serviceChainfsToken(r.Context())
	if err != nil {
		logger.Errorf("[internal-chainfs] service token: %v", err)
		return http.StatusServiceUnavailable, fmt.Errorf("ChainFS service account unavailable: %w", err)
	}

	const maxUpload = 512 * 1024 * 1024 // 512 MB ceiling
	data, err := io.ReadAll(io.LimitReader(r.Body, maxUpload+1))
	if err != nil {
		return http.StatusBadRequest, fmt.Errorf("failed to read upload body: %w", err)
	}
	if len(data) == 0 {
		return http.StatusBadRequest, fmt.Errorf("empty upload body")
	}
	if int64(len(data)) > maxUpload {
		return http.StatusRequestEntityTooLarge, fmt.Errorf("upload exceeds %d bytes", maxUpload)
	}

	// Prefix with the owner id so ownership is identifiable in the shared account.
	uploadName := filename
	if owner != "" {
		uploadName = owner + "_" + filename
	}

	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])

	var fileGuid string
	reader := bytes.NewReader(data)
	if int64(len(data)) > segmentThreshold {
		fileGuid, err = chainfs.UploadFileSegmented(chainfsConfig.ApiBaseUrl, token, uploadName, reader, int64(len(data)), "")
	} else {
		fileGuid, err = chainfs.UploadFile(chainfsConfig.ApiBaseUrl, token, uploadName, reader, "")
	}
	if err != nil {
		logger.Errorf("[internal-chainfs] upload failed for %s: %v", uploadName, err)
		return http.StatusBadGateway, fmt.Errorf("ChainFS upload failed: %w", err)
	}
	logger.Infof("[internal-chainfs] upload succeeded: %s -> FileGuid %s (%d bytes)", uploadName, fileGuid, len(data))

	return renderJSON(w, r, map[string]interface{}{
		"fileGuid":  fileGuid,
		"name":      uploadName,
		"sizeBytes": len(data),
		"sha256":    sha,
	})
}

// internalChainfsDownloadHandler handles GET /api/internal/chainfs/download?fileGuid=... — streams
// one file's bytes from the ChainFS service account. Authenticated via x-api-key. Read-only.
func internalChainfsDownloadHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	if !internalAuthorized(r) {
		logger.Warningf("[internal-chainfs] unauthorized download attempt from %s", r.RemoteAddr)
		return http.StatusUnauthorized, fmt.Errorf("unauthorized")
	}

	fileGuid := r.URL.Query().Get("fileGuid")
	if fileGuid == "" {
		return http.StatusBadRequest, fmt.Errorf("fileGuid is required")
	}

	chainfsConfig := settings.Config.Auth.Methods.ChainFsAuth
	if chainfsConfig.ServiceUsername == "" {
		return http.StatusServiceUnavailable, fmt.Errorf("no ChainFS service account configured")
	}

	token, err := serviceChainfsToken(r.Context())
	if err != nil {
		logger.Errorf("[internal-chainfs] service token: %v", err)
		return http.StatusServiceUnavailable, fmt.Errorf("ChainFS service account unavailable: %w", err)
	}

	data, filename, err := chainfs.DownloadFile(chainfsConfig.ApiBaseUrl, token, fileGuid)
	if err != nil {
		logger.Errorf("[internal-chainfs] download failed for %s: %v", fileGuid, err)
		return http.StatusBadGateway, fmt.Errorf("could not download ChainFS file: %w", err)
	}

	// Strip the "<owner>_" prefix so the download keeps its original name.
	if filename == "" {
		filename = fileGuid
	} else if _, name := splitOwnerName(filename); name != "" {
		filename = name
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	if _, writeErr := w.Write(data); writeErr != nil {
		logger.Debugf("[internal-chainfs] write error: %v", writeErr)
	}
	return 0, nil
}

// internalDeleteUserHandler handles DELETE /api/internal/delete-user?email=
// Called by the landing page during account deletion. Authenticated via x-api-key header.
func internalDeleteUserHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	// Fail closed if no secret is configured, and require a sufficiently long key. The
	// comparison is constant-time to avoid a timing side-channel on the shared secret.
	secret := os.Getenv("ACORN_DRIVE_API_SECRET")
	provided := r.Header.Get("x-api-key")
	if len(secret) < 16 || subtle.ConstantTimeCompare([]byte(provided), []byte(secret)) != 1 {
		logger.Warningf("[internal-delete] unauthorized delete attempt from %s", r.RemoteAddr)
		return http.StatusUnauthorized, fmt.Errorf("unauthorized")
	}

	email := r.URL.Query().Get("email")
	if email == "" {
		return http.StatusBadRequest, fmt.Errorf("email is required")
	}

	// Username == email in this system (set from Azure JWT preferred_username)
	user, err := store.Users.Get(email)
	if err != nil || user == nil {
		return http.StatusNotFound, fmt.Errorf("user not found: %s", email)
	}

	// Delete each home directory the user owns
	for _, scope := range user.Scopes {
		source, ok := settings.Config.Server.SourceMap[scope.Name]
		if !ok {
			logger.Errorf("[internal-delete] source not found for scope %s, skipping", scope.Name)
			continue
		}
		fullPath := filepath.Join(source.Path, scope.Scope)
		if removeErr := os.RemoveAll(fullPath); removeErr != nil {
			logger.Errorf("[internal-delete] failed to remove directory %s: %v", fullPath, removeErr)
		}
	}

	// Delete the user record — access rules and share links become inert without the files
	if err := store.Users.Delete(user.ID); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to delete user record: %w", err)
	}

	return http.StatusOK, nil
}
