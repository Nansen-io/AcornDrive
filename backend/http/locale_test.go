package http

import "testing"

func TestDriveLocaleFromPortal(t *testing.T) {
	cases := map[string]string{
		// the six languages the hub passes as BCP 47 codes
		"it": "it",
		"pl": "pl",
		"uk": "ua", // Drive keys Ukrainian as "ua"
		"ro": "ro",
		"nl": "nl",
		"el": "el",
		// regions and spellings browsers and the hub can produce
		"uk-UA": "ua",
		"nl-NL": "nl",
		"nl-BE": "nlBE",
		"nl_be": "nlBE",
		" EL ":  "el",
		"it-CH": "it",
		"pt-BR": "ptBR",
		"cs":    "cz",
		"zh":    "zhCN",
		"zh-TW": "zhTW",
		"en":    "en",
		"en-AU": "en",
		"ua":    "ua",
		"nlBE":  "", // a Drive key is not a hub code
		"mi":    "", // a hub language Drive has no messages for
		"tr":    "", // tr.json exists but is not registered in index.ts
		"":      "",
		"-":     "",
		"xx-YY": "",
	}
	for in, want := range cases {
		if got := driveLocaleFromPortal(in); got != want {
			t.Errorf("driveLocaleFromPortal(%q) = %q, want %q", in, got, want)
		}
	}
}
