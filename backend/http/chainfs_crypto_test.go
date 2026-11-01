package http

import (
	"testing"

	"github.com/gtsteffaniak/filebrowser/backend/common/settings"
)

// TestTokenEncryptionRoundTripAndLegacyFallback verifies that Azure tokens encrypt and decrypt
// under the purpose-separated HKDF key, that tokens encrypted with the pre-separation legacy
// key still decrypt via the fallback path, and that the HKDF key is genuinely distinct from the
// legacy (JWT-signing) key.
func TestTokenEncryptionRoundTripAndLegacyFallback(t *testing.T) {
	orig := settings.Config.Auth.Key
	defer func() { settings.Config.Auth.Key = orig }()
	settings.Config.Auth.Key = "0123456789abcdef0123456789abcdef" // 32 bytes

	const plain = "super-secret-azure-token.value"

	// New HKDF round trip.
	enc, err := encryptToken(plain)
	if err != nil {
		t.Fatalf("encryptToken: %v", err)
	}
	got, err := decryptToken(enc)
	if err != nil {
		t.Fatalf("decryptToken (hkdf): %v", err)
	}
	if got != plain {
		t.Fatalf("hkdf round trip mismatch: got %q want %q", got, plain)
	}

	// A token encrypted with the legacy bare-SHA-256 key must still decrypt via the fallback.
	legacyEnc, err := aesGcmSeal(legacyEncryptionKey(), plain)
	if err != nil {
		t.Fatalf("legacy seal: %v", err)
	}
	got, err = decryptToken(legacyEnc)
	if err != nil {
		t.Fatalf("decryptToken (legacy fallback): %v", err)
	}
	if got != plain {
		t.Fatalf("legacy fallback mismatch: got %q want %q", got, plain)
	}

	// Purpose separation: the HKDF key must not equal the legacy (signing) key.
	if string(deriveSubKey(tokenEncryptionInfo)) == string(legacyEncryptionKey()) {
		t.Fatal("HKDF subkey must differ from the legacy key")
	}
}
