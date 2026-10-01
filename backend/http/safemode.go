package http

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode"

	"github.com/gtsteffaniak/filebrowser/backend/database/users"
	"github.com/gtsteffaniak/go-logger/logger"
)

func hashSafePIN(pin string) string {
	h := sha256.Sum256([]byte(pin))
	return hex.EncodeToString(h[:])
}

func validateSafePIN(pin string) error {
	if len(pin) != 4 {
		return fmt.Errorf("PIN must be exactly 4 digits")
	}
	for _, c := range pin {
		if !unicode.IsDigit(c) {
			return fmt.Errorf("PIN must contain only digits")
		}
	}
	return nil
}

// normSafePath makes folder paths comparable whether or not they carry a trailing slash.
// The source root becomes "".
func normSafePath(p string) string {
	return strings.TrimRight(p, "/")
}

func sameSafeItem(a, b users.SafeModeItem) bool {
	return a.Source == b.Source && normSafePath(a.Path) == normSafePath(b.Path)
}

// safeItemCovers reports whether entry is target itself or a folder containing it.
func safeItemCovers(entry, target users.SafeModeItem) bool {
	if entry.Source != target.Source {
		return false
	}
	e, t := normSafePath(entry.Path), normSafePath(target.Path)
	return e == t || e == "" || strings.HasPrefix(t, e+"/")
}

// safeItemPINHash returns the hash that unlocks item. Items added before per-item PINs
// have none of their own and fall back to the user's original single PIN.
func safeItemPINHash(u *users.User, item users.SafeModeItem) string {
	if item.PINHash != "" {
		return item.PINHash
	}
	return u.SafeModePINHash
}

// publicSafeModeItems copies items without their PIN hashes, for sending to the frontend.
// It always allocates, so stripping the copy never touches the stored items.
func publicSafeModeItems(items []users.SafeModeItem) []users.SafeModeItem {
	out := make([]users.SafeModeItem, 0, len(items))
	for _, item := range items {
		out = append(out, users.SafeModeItem{Source: item.Source, Path: item.Path})
	}
	return out
}

func saveSafeMode(u *users.User) error {
	if err := store.Users.Update(u, true, "SafeModeItems"); err != nil {
		logger.Errorf("safemode: failed to update user %s: %v", u.Username, err)
		return err
	}
	AcornStateSaveSafeMode(u.Username, u.SafeModePINHash, u.SafeModeItems)
	return nil
}

// safeModeGetHandler returns the current user's SAFEMode items.
// GET /api/safemode
func safeModeGetHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	return renderJSON(w, r, map[string]interface{}{
		"items": publicSafeModeItems(d.user.SafeModeItems),
	})
}

// safeModeAddHandler adds items to the user's SAFEMode under a new PIN.
// Every item in the request gets the PIN supplied with it; items already in SAFEMode,
// or inside a SAFEMode folder, are skipped because they already have a PIN.
// POST /api/safemode
// Body: { "items": [{"source":"...","path":"..."}], "pin": "1234" }
func safeModeAddHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	var req struct {
		Items []users.SafeModeItem `json:"items"`
		PIN   string               `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err)
	}
	if len(req.Items) == 0 {
		return http.StatusBadRequest, fmt.Errorf("no items provided")
	}
	if err := validateSafePIN(req.PIN); err != nil {
		return http.StatusBadRequest, err
	}

	pinHash := hashSafePIN(req.PIN)
	for _, newItem := range req.Items {
		covered := false
		for _, existing := range d.user.SafeModeItems {
			if safeItemCovers(existing, newItem) {
				covered = true
				break
			}
		}
		if !covered {
			d.user.SafeModeItems = append(d.user.SafeModeItems, users.SafeModeItem{
				Source:  newItem.Source,
				Path:    newItem.Path,
				PINHash: pinHash,
			})
		}
	}

	if err := saveSafeMode(d.user); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to save SAFEMode: %w", err)
	}
	return renderJSON(w, r, map[string]interface{}{"items": publicSafeModeItems(d.user.SafeModeItems)})
}

// safeModeRemoveHandler removes items from the user's SAFEMode. The PIN must match every
// item being removed; if any one does not match, nothing is removed.
// DELETE /api/safemode
// Body: { "items": [{"source":"...","path":"..."}], "pin": "1234" }
func safeModeRemoveHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	var req struct {
		Items []users.SafeModeItem `json:"items"`
		PIN   string               `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err)
	}
	if len(req.Items) == 0 {
		return http.StatusBadRequest, fmt.Errorf("no items provided")
	}
	pinHash := hashSafePIN(req.PIN)

	var remaining []users.SafeModeItem
	for _, existing := range d.user.SafeModeItems {
		remove := false
		for _, toRemove := range req.Items {
			if sameSafeItem(existing, toRemove) {
				remove = true
				break
			}
		}
		if !remove {
			remaining = append(remaining, existing)
			continue
		}
		if itemHash := safeItemPINHash(d.user, existing); itemHash == "" || itemHash != pinHash {
			return http.StatusForbidden, fmt.Errorf("incorrect PIN")
		}
	}
	d.user.SafeModeItems = remaining

	if err := saveSafeMode(d.user); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to update SAFEMode: %w", err)
	}
	return renderJSON(w, r, map[string]interface{}{"items": publicSafeModeItems(d.user.SafeModeItems)})
}

// safeModeVerifyHandler checks a PIN without changing any data and returns the SAFEMode
// items it unlocks, for the frontend's session unlock.
// With a target, only that item is checked. Without one, every item with this PIN is unlocked.
// POST /api/safemode/verify
// Body: { "pin": "1234", "source": "...", "path": "..." }  (source/path optional)
// Returns: { "valid": true/false, "items": [{"source":"...","path":"..."}] }
func safeModeVerifyHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	var req struct {
		PIN    string `json:"pin"`
		Source string `json:"source"`
		Path   string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err)
	}
	pinHash := hashSafePIN(req.PIN)
	target := users.SafeModeItem{Source: req.Source, Path: req.Path}
	hasTarget := req.Source != "" || req.Path != ""

	var unlocked []users.SafeModeItem
	for _, item := range d.user.SafeModeItems {
		if hasTarget && !sameSafeItem(item, target) {
			continue
		}
		if itemHash := safeItemPINHash(d.user, item); itemHash != "" && itemHash == pinHash {
			unlocked = append(unlocked, item)
		}
	}
	return renderJSON(w, r, map[string]interface{}{
		"valid": len(unlocked) > 0,
		"items": publicSafeModeItems(unlocked),
	})
}
