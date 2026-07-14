package http

import "testing"

// Azure AD B2C serves no OIDC metadata at its issuer URL — the issuer is in tenant-GUID form,
// while the metadata lives under the user-flow path. deriveB2CDiscoveryUrl turns the configured
// authorize endpoint into that metadata base so both do not have to be configured by hand.
func TestDeriveB2CDiscoveryUrl(t *testing.T) {
	tests := []struct {
		name     string
		loginUrl string
		want     string
	}{
		{
			name:     "authorize endpoint with query params",
			loginUrl: "https://nansendev2.b2clogin.com/NansenDEV2.onmicrosoft.com/B2C_1_signupsignin1/oauth2/v2.0/authorize?client_id=ae8e4cce-f313-459b-b86b-2fa59b4f1cb8&scope=openid+profile",
			want:     "https://nansendev2.b2clogin.com/NansenDEV2.onmicrosoft.com/B2C_1_signupsignin1/v2.0",
		},
		{
			name:     "authorize endpoint with no query params",
			loginUrl: "https://tenant.b2clogin.com/tenant.onmicrosoft.com/B2C_1_policy/oauth2/v2.0/authorize",
			want:     "https://tenant.b2clogin.com/tenant.onmicrosoft.com/B2C_1_policy/v2.0",
		},
		{
			name:     "empty login url cannot be derived",
			loginUrl: "",
			want:     "",
		},
		{
			// Not an authorize endpoint, so there is no policy path to recover. Callers must fall
			// back to an explicitly configured discoveryUrl rather than guess.
			name:     "non-authorize url cannot be derived",
			loginUrl: "https://tenant.b2clogin.com/tenant.onmicrosoft.com/B2C_1_policy/oauth2/v2.0/token",
			want:     "",
		},
		{
			name:     "garbage input cannot be derived",
			loginUrl: "://not a url",
			want:     "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := deriveB2CDiscoveryUrl(tt.loginUrl); got != tt.want {
				t.Errorf("deriveB2CDiscoveryUrl(%q) = %q, want %q", tt.loginUrl, got, tt.want)
			}
		})
	}
}
