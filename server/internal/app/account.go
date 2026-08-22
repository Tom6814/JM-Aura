package app

import (
	"encoding/json"
	"net/http"
	"strings"

	"jmaura/internal/jm"
	"jmaura/internal/store"
)

type configRequest struct {
	Username     string `json:"username"`
	Password     string `json:"password"`
	SavePassword *bool  `json:"save_password"`
	AutoLogin    *bool  `json:"auto_login"`
}

type reloginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// applyLoginProfile mirrors the shared post-login block: persist profile and
// extract uid (top-level then nested user/userinfo/profile/member).
func applyLoginProfile(r *http.Request, raw map[string]any) {
	if raw == nil {
		return
	}
	identity := effIdentityOf(r)
	store.JmSetProfile(identity, raw)
	uid := ""
	for _, k := range []string{"uid", "user_id", "id"} {
		if v := raw[k]; v != nil && pyTruthy(v) {
			uid = pyStr(v)
			break
		}
	}
	if uid == "" {
		for _, k := range []string{"user", "userinfo", "profile", "member"} {
			sub, isMap := raw[k].(map[string]any)
			if !isMap {
				continue
			}
			for _, kk := range []string{"uid", "user_id", "id"} {
				if vv := sub[kk]; vv != nil && pyTruthy(vv) {
					uid = pyStr(vv)
					break
				}
			}
			if uid != "" {
				break
			}
		}
	}
	if uid != "" {
		store.JmSetUserID(identity, uid)
	}
}

func handleConfigPost(w http.ResponseWriter, r *http.Request) {
	siteU := getSiteUser(r)
	if siteU == "" {
		httpDetail(w, 401, "Aura login required")
		return
	}
	var req configRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpDetail(w, 422, err.Error())
		return
	}
	_, captured, raw, lerr := jm.NewClient().Login(r.Context(), req.Username, req.Password)
	if lerr != nil {
		httpDetail(w, 401, "Login failed. Please check your username and password.")
		return
	}
	_ = store.SaveCookies(effIdentityOf(r), captured)

	wantSave := (req.SavePassword != nil && *req.SavePassword) || (req.AutoLogin != nil && *req.AutoLogin)
	if wantSave {
		_ = store.CredSet(siteU, req.Username, req.Password)
	}

	applyLoginProfile(r, raw)

	writeJSON(w, 200, map[string]any{
		"status":  "success",
		"message": "Login successful and configuration updated",
		"st":      StatusOK,
		"msg":     "",
	})
}

func handleCredentialsGet(w http.ResponseWriter, r *http.Request) {
	siteU := getSiteUser(r)
	if siteU == "" {
		writeJSON(w, 200, map[string]any{"has_saved": false, "username": "", "st": StatusOK, "msg": ""})
		return
	}
	u := store.CredActiveUsername(siteU)
	writeJSON(w, 200, map[string]any{
		"has_saved": store.CredHas(siteU),
		"username":  u,
		"st":        StatusOK,
		"msg":       "",
	})
}

func handleCredentialsDelete(w http.ResponseWriter, r *http.Request) {
	siteU := getSiteUser(r)
	if siteU == "" {
		writeJSON(w, 200, map[string]any{"status": "success", "st": StatusOK, "msg": ""})
		return
	}
	_ = store.CredClear(siteU)
	writeJSON(w, 200, map[string]any{"status": "success", "st": StatusOK, "msg": ""})
}

func handleSessionRelogin(w http.ResponseWriter, r *http.Request) {
	siteU0 := getSiteUser(r)
	if siteU0 == "" {
		writeJSON(w, 401, errSt(StatusNotLogin, "Aura login required"))
		return
	}
	var req reloginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req = reloginRequest{}
	}
	u := strings.TrimSpace(req.Username)
	p := strings.TrimSpace(req.Password)

	if u == "" || p == "" {
		targetU := u
		if targetU == "" {
			targetU = store.CredActiveUsername(siteU0)
		}
		if targetU != "" {
			_, savedP := store.CredGet(siteU0, "")
			if savedP != "" {
				u = targetU
				p = savedP
			}
		}
	}

	if u == "" || p == "" {
		writeJSON(w, 200, errSt(StatusUserError, "Missing username or password"))
		return
	}

	_, captured, raw, lerr := jm.NewClient().Login(r.Context(), u, p)
	if lerr != nil {
		writeJSON(w, 200, errSt(StatusNotLogin, "Relogin failed"))
		return
	}
	_ = store.SaveCookies(effIdentityOf(r), captured)
	applyLoginProfile(r, raw)
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func getSavedJMCredentials(r *http.Request) (string, string) {
	rawU, _ := siteUserOf(r)
	activeU := store.CredActiveUsername(rawU)
	if activeU == "" {
		return "", ""
	}
	savedU, savedP := store.CredGet(rawU, activeU)
	return strings.TrimSpace(pyOrStr(savedU, activeU)), strings.TrimSpace(savedP)
}

func reloginFromSavedConfig(r *http.Request) bool {
	u, p := getSavedJMCredentials(r)
	if u == "" || p == "" {
		return false
	}
	_, captured, raw, err := jm.NewClient().Login(r.Context(), u, p)
	if err != nil {
		return false
	}
	_ = store.SaveCookies(effIdentityOf(r), captured)
	applyLoginProfile(r, raw)
	return true
}

func handleConfigGet(w http.ResponseWriter, r *http.Request) {
	rawU, _ := siteUserOf(r)
	if strings.TrimSpace(rawU) == "" {
		rawU = "anon"
	}
	u := store.CredActiveUsername(rawU)
	isLoggedIn := liveJMSession(r)
	writeJSON(w, 200, map[string]any{
		"username":     u,
		"is_logged_in": isLoggedIn,
		"st":           StatusOK,
		"msg":          "",
	})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	identity := effIdentityOf(r)
	_ = store.ClearCookies(identity)
	store.JmSetUserID(identity, "")
	store.JmSetProfile(identity, map[string]any{})
	clearOpYmlCredsAt(opYmlPath())
	writeJSON(w, 200, map[string]any{"status": "success", "message": "Logged out", "st": StatusOK, "msg": ""})
}
