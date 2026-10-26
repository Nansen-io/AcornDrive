package http

import "strings"

// portalLocales maps a language code as the joliro hub sends it (BCP 47: it, pl, uk, ro, nl,
// el, pt-br, ...) to the key the Drive frontend registers its messages under
// (frontend/src/i18n/index.ts). The two differ for a few languages: Ukrainian is "uk" in BCP 47
// but "ua" in Drive, Czech is "cs" but "cz", and regional variants are camel-cased ("nlBE").
//
// A code that is not here is ignored rather than stored: a locale Drive has no messages for
// would leave the language picker blank and the interface in the fallback language anyway.
var portalLocales = map[string]string{
	"ar":    "ar",
	"cs":    "cz",
	"cz":    "cz",
	"de":    "de",
	"el":    "el",
	"en":    "en",
	"es":    "es",
	"fr":    "fr",
	"he":    "he",
	"hu":    "hu",
	"is":    "is",
	"it":    "it",
	"ja":    "ja",
	"ko":    "ko",
	"nl":    "nl",
	"nl-be": "nlBE",
	"pl":    "pl",
	"pt":    "pt",
	"pt-br": "ptBR",
	"ro":    "ro",
	"ru":    "ru",
	"sk":    "sk",
	"sv":    "svSE",
	"ua":    "ua",
	"uk":    "ua",
	"zh":    "zhCN",
	"zh-cn": "zhCN",
	"zh-tw": "zhTW",
}

// driveLocaleFromPortal returns the Drive locale for a hub language code, or "" when the code
// is empty or Drive has no messages for it. An exact match wins (nl-be, pt-br, zh-tw); otherwise
// the primary language subtag is used, so "nl-NL" is Dutch and "uk-UA" is Ukrainian.
func driveLocaleFromPortal(code string) string {
	code = strings.ToLower(strings.TrimSpace(strings.ReplaceAll(code, "_", "-")))
	if code == "" {
		return ""
	}
	if locale, ok := portalLocales[code]; ok {
		return locale
	}
	if i := strings.Index(code, "-"); i > 0 {
		return portalLocales[code[:i]]
	}
	return ""
}
