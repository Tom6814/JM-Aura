package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const cookieDirRel = "cookies"

// SafeUserKey mirrors legacy _safe_user_key: keep unicode alnum plus -_.@,
// replace everything else with "_", truncate to 80 chars, empty -> "anon".
func SafeUserKey(user string) string {
	s := strings.TrimSpace(user)
	if s == "" {
		return "anon"
	}
	var sb strings.Builder
	for _, ch := range s {
		if unicode.IsLetter(ch) || unicode.IsDigit(ch) ||
			ch == '-' || ch == '_' || ch == '.' || ch == '@' {
			sb.WriteRune(ch)
		} else {
			sb.WriteByte('_')
		}
	}
	runes := []rune(sb.String())
	if len(runes) > 80 {
		runes = runes[:80]
	}
	out := string(runes)
	if out == "" {
		return "anon"
	}
	return out
}

func IsGuestIdentity(user string) bool {
	return strings.HasPrefix(strings.TrimSpace(user), "g:")
}

func cookieFilePathFor(user string) string {
	if v := os.Getenv("JM_AURA_COOKIE_PATH"); v != "" {
		return v
	}
	return Path(filepath.Join(cookieDirRel, SafeUserKey(user)+".json"))
}

// LoadCookies returns persisted cookies for a site identity; guests never persist.
func LoadCookies(user string) map[string]string {
	if IsGuestIdentity(user) {
		return nil
	}
	raw, err := os.ReadFile(cookieFilePathFor(user))
	if err != nil {
		return nil
	}
	var data map[string]string
	if json.Unmarshal(raw, &data) != nil || data == nil {
		return nil
	}
	return data
}

func SaveCookies(user string, cookies map[string]string) error {
	if IsGuestIdentity(user) {
		return nil
	}
	p := cookieFilePathFor(user)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(cookies)
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func ClearCookies(user string) error {
	if IsGuestIdentity(user) {
		return nil
	}
	p := cookieFilePathFor(user)
	err := os.Remove(p)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
