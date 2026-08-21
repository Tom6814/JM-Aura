package store

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	SessionCookieName = "jm_aura_sid"
	GuestCookieName   = "jm_aura_gid"
	SessionTTLSec     = 7 * 86400
)

var (
	sessionsMu sync.Mutex
	sessions   map[string]map[string]any
	sessionsIn bool
)

func sessionsFile() string {
	if v := os.Getenv("JM_AURA_SITE_SESSIONS_PATH"); v != "" {
		return v
	}
	return "site_sessions.json"
}

func usersFile() string {
	if v := os.Getenv("JM_AURA_SITE_USERS_PATH"); v != "" {
		return v
	}
	return "site_users.json"
}

func loadUsers() map[string]any {
	doc, _ := LoadJSON(usersFile())
	users, _ := doc["users"].(map[string]any)
	if users == nil {
		users = map[string]any{}
	}
	return users
}

func saveUsers(users map[string]any) {
	doc := map[string]any{"v": 1, "users": users}
	if old, ok := LoadJSON(usersFile()); ok {
		if v, ok := old["v"].(float64); ok {
			doc["v"] = v
		}
	}
	_ = SaveJSON(usersFile(), doc)
}

func NormUsername(u string) string {
	s := strings.TrimSpace(u)
	if s == "" || len(s) > 64 {
		return ""
	}
	for _, ch := range s {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' ||
			ch == '-' || ch == '_' || ch == '.' || ch == '@') {
			return ""
		}
	}
	return s
}

func HasAnyUser() bool {
	return len(loadUsers()) > 0
}

func IsAdmin(username string) bool {
	u := NormUsername(username)
	if u == "" {
		return false
	}
	info, _ := loadUsers()[u].(map[string]any)
	if info == nil {
		return false
	}
	v, _ := info["is_admin"].(bool)
	return v
}

func hashPassword(password string, salt []byte) ([]byte, error) {
	return pbkdf2.Key(sha256.New, password, salt, 200_000, 32)
}

func CreateUser(username, password string, admin bool) error {
	u := NormUsername(username)
	if u == "" || len(password) < 6 {
		return errInvalid("Invalid username or password")
	}
	users := loadUsers()
	if _, exists := users[u]; exists {
		return errInvalid("User already exists")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	h, err := hashPassword(password, salt)
	if err != nil {
		return err
	}
	users[u] = map[string]any{
		"salt_b64":   base64.StdEncoding.EncodeToString(salt),
		"hash_b64":   base64.StdEncoding.EncodeToString(h),
		"is_admin":   admin,
		"created_at": time.Now().Unix(),
	}
	saveUsers(users)
	return nil
}

func VerifyUser(username, password string) bool {
	u := NormUsername(username)
	if u == "" || password == "" {
		return false
	}
	info, _ := loadUsers()[u].(map[string]any)
	if info == nil {
		return false
	}
	salt, err1 := base64.StdEncoding.DecodeString(getStr(info, "salt_b64"))
	hh, err2 := base64.StdEncoding.DecodeString(getStr(info, "hash_b64"))
	if err1 != nil || err2 != nil {
		return false
	}
	calc, err := hashPassword(password, salt)
	if err != nil {
		return false
	}
	return hmac.Equal(calc, hh)
}

type errInvalid string

func (e errInvalid) Error() string { return string(e) }

func loadSessions() {
	if sessionsIn {
		return
	}
	sessions = map[string]map[string]any{}
	if doc, ok := LoadJSON(sessionsFile()); ok {
		now := time.Now()
		for k, v := range doc {
			sid := strings.TrimSpace(k)
			rec, _ := v.(map[string]any)
			if sid == "" || len(sid) > 256 || rec == nil {
				continue
			}
			u := NormUsername(getStr(rec, "u"))
			if u == "" {
				continue
			}
			exp, _ := rec["exp"].(float64)
			if exp > 0 && now.Unix() >= int64(exp) {
				continue
			}
			sessions[sid] = map[string]any{"u": u, "exp": exp}
		}
	}
	sessionsIn = true
}

func persistSessions() {
	doc := make(map[string]any, len(sessions))
	for k, v := range sessions {
		doc[k] = v
	}
	_ = SaveJSON(sessionsFile(), doc)
}

func CreateSession(username string) (string, error) {
	u := NormUsername(username)
	if u == "" {
		return "", errInvalid("Invalid username")
	}
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	loadSessions()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	sid := base64.RawURLEncoding.EncodeToString(b)
	sessions[sid] = map[string]any{"u": u, "exp": float64(time.Now().Unix() + SessionTTLSec)}
	persistSessions()
	return sid, nil
}

func ClearSession(sid string) {
	if sid == "" {
		return
	}
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	loadSessions()
	if _, ok := sessions[sid]; ok {
		delete(sessions, sid)
		persistSessions()
	}
}

func GetSessionUser(sid string) string {
	if sid == "" {
		return ""
	}
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	loadSessions()
	rec, ok := sessions[sid]
	if !ok {
		return ""
	}
	exp, _ := rec["exp"].(float64)
	if exp > 0 && time.Now().Unix() >= int64(exp) {
		delete(sessions, sid)
		persistSessions()
		return ""
	}
	return getStr(rec, "u")
}

func GetGuestID(r *http.Request) string {
	v, err := r.Cookie(GuestCookieName)
	if err != nil {
		return ""
	}
	s := strings.TrimSpace(v.Value)
	if s == "" || len(s) > 128 {
		return ""
	}
	for _, ch := range s {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return ""
		}
	}
	return s
}

func NewGuestID() string {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return strings.ReplaceAll(base64.RawURLEncoding.EncodeToString(b), "-", "_")
}

// EffectiveUser returns (identity, loggedIn, newGuestID).
func EffectiveUser(r *http.Request) (string, bool, string) {
	if sid, err := r.Cookie(SessionCookieName); err == nil {
		if u := GetSessionUser(sid.Value); u != "" {
			return u, true, ""
		}
	}
	if gid := GetGuestID(r); gid != "" {
		return "g:" + gid, false, ""
	}
	ng := NewGuestID()
	return "g:" + ng, false, ng
}
