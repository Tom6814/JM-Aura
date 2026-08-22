package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"jmaura/internal/jm"
	"jmaura/internal/store"
)

const sessionCookieName = "jm_aura_sid"

var loginLimiter = newRateLimiter(time.Minute)

func getSiteUser(r *http.Request) string {
	c, err := r.Cookie(sessionCookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	return store.GetSessionUser(c.Value)
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, sid string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   shouldSecureCookie(r),
		MaxAge:   maxAge,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func strBody(v any) string { return pyOrStr(v) }

func handleClientInfo(w http.ResponseWriter, r *http.Request) {
	ip := ""
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		ip = strings.TrimSpace(parts[0])
	}
	if ip == "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		ip = host
	}
	writeJSON(w, 200, ok(map[string]any{"ip": ip}, ""))
}

func handleJmDebug(w http.ResponseWriter, r *http.Request) {
	cur := ""
	if ds := apiClient().APIDomains(); len(ds) > 0 {
		cur = "https://" + ds[0]
	}
	var lastOK any
	if v := defaultClient.LastOKAPIBase(); v != "" {
		lastOK = v
	}
	writeJSON(w, 200, ok(map[string]any{
		"api_base":         cur,
		"img_base":         imgBase(),
		"last_ok_api_base": lastOK,
	}, ""))
}

func legacyCookieCandidates() []string {
	if v := strings.TrimSpace(os.Getenv("JM_AURA_LEGACY_COOKIES")); v != "" {
		return []string{v}
	}
	return []string{
		filepath.Join("backend", "config", "cookies.json"),
		filepath.Join("..", "backend", "config", "cookies.json"),
		filepath.Join(store.DataDir(), "legacy_cookies.json"),
	}
}

func migrateLegacyCookiesToUser(user string) bool {
	u := strings.TrimSpace(user)
	if u == "" {
		return false
	}
	if ck := store.LoadCookies(u); len(ck) > 0 {
		return false
	}
	legacy := ""
	for _, c := range legacyCookieCandidates() {
		if st, serr := os.Stat(c); serr == nil && !st.IsDir() {
			legacy = c
			break
		}
	}
	if legacy == "" {
		return false
	}
	b, rerr := os.ReadFile(legacy)
	if rerr != nil {
		return false
	}
	raw := map[string]any{}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.UseNumber()
	if derr := dec.Decode(&raw); derr != nil {
		return false
	}
	ck := map[string]string{}
	for k, v := range raw {
		switch t := v.(type) {
		case string:
			ck[k] = t
		case json.Number:
			ck[k] = t.String()
		case bool:
			if t {
				ck[k] = "true"
			} else {
				ck[k] = "false"
			}
		}
	}
	if len(ck) == 0 {
		return false
	}
	_ = store.SaveCookies(u, ck)
	return true
}

func runPostAuthMigrations(username string) {
	migrateOpYmlCredentials(strings.TrimSpace(username))
	migrateLegacyCookiesToUser(strings.TrimSpace(username))
}

func handleSiteLogin(w http.ResponseWriter, r *http.Request) {
	if !loginLimiter.allow(remoteAddrKey(r), 10) {
		httpDetail(w, 429, "Rate limit exceeded")
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	username := strBody(body["username"])
	password := strBody(body["password"])
	if username == "" || password == "" {
		writeJSON(w, 400, errSt(StatusUserError, "Username and password required"))
		return
	}

	lr, _, _, lerr := jm.NewClient().Login(context.Background(), username, password)
	if lerr != nil || lr == nil {
		msg := ""
		if lerr != nil {
			if ae, isAE := lerr.(*jm.APIError); isAE {
				msg = "API Error: " + ae.Msg
			} else {
				msg = lerr.Error()
			}
		}
		detail := "JM Login failed"
		if msg != "" {
			detail = "JM Login failed: " + msg
		}
		writeJSON(w, 401, errSt(StatusUserError, detail))
		return
	}

	_ = store.CreateUser(username, password, false)
	sid, _ := store.CreateSession(username)
	_ = store.CredSet(username, username, password)
	runPostAuthMigrations(username)

	writeJSON(w, 200, ok(map[string]any{
		"username": username,
		"is_admin": store.IsAdmin(username),
	}, ""))
	setSessionCookie(w, r, sid, 7*86400)
}

func handleSiteLogout(w http.ResponseWriter, r *http.Request) {
	sid := ""
	if c, err := r.Cookie(sessionCookieName); err == nil {
		sid = c.Value
	}
	store.ClearSession(sid)
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
	clearSessionCookie(w)
}

func requireSiteUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	u := getSiteUser(r)
	if u == "" {
		writeJSON(w, 401, errSt(StatusNotLogin, "Not authenticated"))
		return "", false
	}
	return u, true
}

func handleSiteMe(w http.ResponseWriter, r *http.Request) {
	u, okc := requireSiteUser(w, r)
	if !okc {
		return
	}
	writeJSON(w, 200, ok(map[string]any{"username": u, "is_admin": store.IsAdmin(u)}, ""))
}

func handleSiteProfileGet(w http.ResponseWriter, r *http.Request) {
	u, okc := requireSiteUser(w, r)
	if !okc {
		return
	}
	writeJSON(w, 200, ok(store.ProfileGet(u), ""))
}

func handleSiteProfilePatch(w http.ResponseWriter, r *http.Request) {
	u, okc := requireSiteUser(w, r)
	if !okc {
		return
	}
	var req struct {
		Theme     json.RawMessage `json:"theme"`
		Features  json.RawMessage `json:"features"`
		Signature *string         `json:"signature"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	patch := map[string]any{}
	if len(req.Theme) > 0 {
		var t map[string]any
		if json.Unmarshal(req.Theme, &t) == nil && t != nil {
			patch["theme"] = t
		}
	}
	if len(req.Features) > 0 {
		var f map[string]any
		if json.Unmarshal(req.Features, &f) == nil && f != nil {
			patch["features"] = f
		}
	}
	if req.Signature != nil {
		patch["signature"] = *req.Signature
	}
	updated, perr := store.ProfilePatch(u, patch)
	if perr != nil {
		writeJSON(w, 200, errSt(StatusError, perr.Error()))
		return
	}
	writeJSON(w, 200, ok(updated, ""))
}
