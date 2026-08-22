package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"jmaura/internal/jm"
	"jmaura/internal/store"
)

type auraHistoryPushRequest struct {
	AlbumID    string  `json:"album_id"`
	AlbumTitle *string `json:"album_title"`
	PhotoID    *string `json:"photo_id"`
	Title      *string `json:"title"`
	PageIndex  *int64  `json:"page_index"`
	Timestamp  *int64  `json:"timestamp"`
}

type auraFolderCreateRequest struct {
	Name string `json:"name"`
}

type auraFolderRenameRequest struct {
	FolderID string `json:"folder_id"`
	Name     string `json:"name"`
}

type auraFolderDeleteRequest struct {
	FolderID string `json:"folder_id"`
}

type auraFolderToggleItemRequest struct {
	FolderID string `json:"folder_id"`
	AlbumID  string `json:"album_id"`
	Present  bool   `json:"present"`
}

type auraNoteSetRequest struct {
	AlbumID string   `json:"album_id"`
	Tags    []string `json:"tags"`
	Note    *string  `json:"note"`
}

type auraSyncToJmRequest struct {
	FolderIDs           []string `json:"folder_ids"`
	CreateMissingFolder *bool    `json:"create_missing_folders"`
}

func auraUserOf(w http.ResponseWriter, r *http.Request) (string, bool) {
	u := getSiteUser(r)
	if u == "" {
		writeJSON(w, 401, errSt(StatusNotLogin, "Not authenticated"))
		return "", false
	}
	return u, true
}

func handleAuraSummary(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	writeJSON(w, 200, ok(store.AuraSummary(u), ""))
}

func handleAuraHistoryGet(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	limit := 50
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			limit = n
		} else {
			httpDetail(w, 422, "Invalid limit")
			return
		}
	}
	writeJSON(w, 200, ok(store.AuraListHistory(u, limit), ""))
}

func handleAuraHistoryPost(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraHistoryPushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	pageIndex := int64(0)
	hasPage := req.PageIndex != nil
	if hasPage {
		pageIndex = *req.PageIndex
	}
	ts := int64(0)
	if req.Timestamp != nil {
		ts = *req.Timestamp
	}
	aerr := store.AuraPushHistory(u, req.AlbumID, pyOrStr(req.AlbumTitle, ""), pyOrStr(req.PhotoID, ""), pyOrStr(req.Title, ""), pageIndex, hasPage, ts)
	if aerr != nil {
		msg := aerr.Error()
		if msg == "" {
			msg = "Invalid request"
		}
		writeJSON(w, 200, errSt(StatusUserError, msg))
		return
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func handleAuraFoldersList(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	writeJSON(w, 200, ok(map[string]any{"folders": store.AuraListFoldersWithIDs(u)}, ""))
}

func handleAuraFolderCreate(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraFolderCreateRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	f, ferr := store.AuraCreateFolder(u, req.Name)
	if ferr != nil {
		writeJSON(w, 200, errSt(StatusUserError, ferr.Error()))
		return
	}
	writeJSON(w, 200, ok(f, ""))
}

func handleAuraFolderRename(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraFolderRenameRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	if ferr := store.AuraRenameFolder(u, req.FolderID, req.Name); ferr != nil {
		writeJSON(w, 200, errSt(StatusUserError, ferr.Error()))
		return
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func handleAuraFolderDelete(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraFolderDeleteRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	if ferr := store.AuraDeleteFolder(u, req.FolderID); ferr != nil {
		writeJSON(w, 200, errSt(StatusUserError, ferr.Error()))
		return
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func handleAuraFolderToggle(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraFolderToggleItemRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	if ferr := store.AuraToggleFolderItem(u, req.FolderID, req.AlbumID, req.Present); ferr != nil {
		writeJSON(w, 200, errSt(StatusUserError, ferr.Error()))
		return
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func handleAuraNoteGet(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	aid := strings.TrimPrefix(r.URL.Path, "/api/aura/library/notes/")
	rec := store.AuraGetNote(u, aid)
	rec["album_id"] = aid
	writeJSON(w, 200, ok(rec, ""))
}

func handleAuraNoteSet(w http.ResponseWriter, r *http.Request) {
	u, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraNoteSetRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	up := store.NoteUpdate{HasTags: req.Tags != nil, Tags: req.Tags, HasNote: req.Note != nil}
	if req.Note != nil {
		up.Note = *req.Note
	}
	if serr := store.AuraSetNote(u, req.AlbumID, up); serr != nil {
		writeJSON(w, 200, errSt(StatusUserError, serr.Error()))
		return
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func composedIdentity(siteU, jmUser string) string {
	if jmUser == "" {
		return siteU
	}
	return siteU + "#jm#" + jmUser
}

func handleAuraAccountsGet(w http.ResponseWriter, r *http.Request) {
	siteU, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	cl := store.CredListAccounts(siteU)
	accounts := make([]map[string]any, 0, len(cl.Accounts))
	for _, a := range cl.Accounts {
		accounts = append(accounts, map[string]any{
			"username":     a.Username,
			"active":       a.Active,
			"has_password": a.HasPassword,
		})
	}
	writeJSON(w, 200, ok(map[string]any{"active": cl.Active, "accounts": accounts}, ""))
}

type auraAccountAddRequest struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	SetActive *bool  `json:"set_active"`
}

func handleAuraAccountAdd(w http.ResponseWriter, r *http.Request) {
	siteU, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraAccountAddRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	u := strings.TrimSpace(req.Username)
	if u == "" || req.Password == "" {
		writeJSON(w, 200, errSt(StatusUserError, "Missing username or password"))
		return
	}
	setActive := req.SetActive == nil || *req.SetActive
	prevActive := store.CredActiveUsername(siteU)

	_, captured, raw, lerr := jm.NewClient().Login(r.Context(), u, req.Password)
	if lerr != nil {
		msg := "JM Login failed"
		if ae, isAE := lerr.(*jm.APIError); isAE {
			msg = "JM Login failed: " + ae.Msg
		} else if lerr != nil {
			msg = "JM Login failed: " + lerr.Error()
		}
		writeJSON(w, 200, errSt(StatusUserError, msg))
		return
	}
	if serr := store.CredSet(siteU, u, req.Password); serr != nil {
		writeJSON(w, 200, errSt(StatusUserError, serr.Error()))
		return
	}
	if !setActive && prevActive != "" && prevActive != u {
		_ = store.CredSetActive(siteU, prevActive)
	}
	newIdentity := composedIdentity(siteU, u)
	_ = store.SaveCookies(newIdentity, captured)
	if raw != nil {
		store.JmSetProfile(newIdentity, raw)
		if uid := extractUID(raw); uid != "" {
			store.JmSetUserID(newIdentity, uid)
		}
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success", "username": u}, ""))
}

type auraAccountSwitchRequest struct {
	Username string `json:"username"`
}

func handleAuraAccountSwitch(w http.ResponseWriter, r *http.Request) {
	siteU, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraAccountSwitchRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	u := strings.TrimSpace(req.Username)
	if u == "" {
		writeJSON(w, 200, errSt(StatusUserError, "Missing username"))
		return
	}
	savedU, savedP := store.CredGet(siteU, u)
	if savedP == "" {
		writeJSON(w, 200, errSt(StatusUserError, "No saved password for account: "+u))
		return
	}
	if savedU == "" {
		savedU = u
	}
	_, captured, raw, lerr := jm.NewClient().Login(r.Context(), savedU, savedP)
	if lerr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Switch login failed"))
		return
	}
	if serr := store.CredSetActive(siteU, u); serr != nil {
		writeJSON(w, 200, errSt(StatusUserError, serr.Error()))
		return
	}
	newIdentity := composedIdentity(siteU, u)
	_ = store.SaveCookies(newIdentity, captured)
	if raw != nil {
		store.JmSetProfile(newIdentity, raw)
		if uid := extractUID(raw); uid != "" {
			store.JmSetUserID(newIdentity, uid)
		}
	}
	writeJSON(w, 200, ok(map[string]any{"status": "success", "username": u}, ""))
}

type auraAccountRemoveRequest struct {
	Username string `json:"username"`
}

func handleAuraAccountRemove(w http.ResponseWriter, r *http.Request) {
	siteU, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraAccountRemoveRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeJSON(w, 200, errSt(StatusUserError, "Invalid request"))
		return
	}
	u := strings.TrimSpace(req.Username)
	if u == "" {
		writeJSON(w, 200, errSt(StatusUserError, "Missing username"))
		return
	}
	if rerr := store.CredRemoveAccount(siteU, u); rerr != nil {
		writeJSON(w, 200, errSt(StatusUserError, rerr.Error()))
		return
	}
	oldIdentity := composedIdentity(siteU, u)
	_ = store.ClearCookies(oldIdentity)
	store.JmClearUserData(oldIdentity)
	writeJSON(w, 200, ok(map[string]any{"status": "success"}, ""))
}

func extractUID(raw map[string]any) string {
	for _, k := range []string{"uid", "user_id", "id"} {
		if v := raw[k]; v != nil && pyTruthy(v) {
			return pyStr(v)
		}
	}
	for _, k := range []string{"user", "userinfo", "profile", "member"} {
		sub, isMap := raw[k].(map[string]any)
		if !isMap {
			continue
		}
		for _, kk := range []string{"uid", "user_id", "id"} {
			if vv := sub[kk]; vv != nil && pyTruthy(vv) {
				return pyStr(vv)
			}
		}
	}
	return ""
}

func handleAuraSyncToJm(w http.ResponseWriter, r *http.Request) {
	siteU, okc := auraUserOf(w, r)
	if !okc {
		return
	}
	var req auraSyncToJmRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		req = auraSyncToJmRequest{}
	}
	createMissing := req.CreateMissingFolder == nil || *req.CreateMissingFolder

	identity := effIdentityOf(r)
	ck := store.LoadCookies(identity)
	if len(ck) == 0 {
		writeJSON(w, 200, errSt(StatusUserError, "JM not logged in"))
		return
	}
	cli := jm.NewClient()
	ctx := r.Context()

	local := store.AuraListFoldersWithIDs(siteU)
	if len(req.FolderIDs) > 0 {
		want := map[string]bool{}
		for _, f := range req.FolderIDs {
			want[strings.TrimSpace(f)] = true
		}
		filtered := make([]map[string]any, 0, len(local))
		for _, f := range local {
			fid, _ := f["id"].(string)
			if want[fid] {
				filtered = append(filtered, f)
			}
		}
		local = filtered
	}

	folders := map[string]string{}
	loadFolders := func() {
		fp, ferr := cli.Favorite(ctx, 1, "0", "", ck)
		if ferr != nil {
			return
		}
		folders = map[string]string{}
		for _, fe := range fp.FolderList {
			folders[fe.Name] = fe.FID
		}
	}
	loadFolders()

	created, added, moved, dups := 0, 0, 0, 0
	errs := make([]string, 0)
	for _, f := range local {
		name, _ := f["name"].(string)
		fid, _ := f["id"].(string)
		if name == "" || fid == "" {
			continue
		}
		jfid, exists := folders[name]
		if !exists {
			if !createMissing {
				continue
			}
			if _, oerr := cli.FavoriteFolderOp(ctx, "add", "", name, "", ck); oerr != nil {
				errs = append(errs, "create folder "+name+": "+oerr.Error())
				continue
			}
			created++
			loadFolders()
			jfid = folders[name]
			if jfid == "" {
				continue
			}
		}
		idsRaw, _ := f["album_ids"].([]any)
		for _, x := range idsRaw {
			aid := pyStr(x)
			if aid == "" {
				continue
			}
			if _, aerr := cli.AddFavorite(ctx, aid, ck); aerr != nil {
				msg := aerr.Error()
				if strings.Contains(msg, "already") || strings.Contains(msg, "重复") {
					dups++
				} else {
					errs = append(errs, "favorite "+aid+": "+msg)
				}
				continue
			}
			added++
		}
	}
	writeJSON(w, 200, ok(map[string]any{
		"created_folders":     created,
		"added_favorites":     added,
		"moved":               moved,
		"duplicates_skipped":  dups,
		"errors":              errs,
	}, ""))
}
