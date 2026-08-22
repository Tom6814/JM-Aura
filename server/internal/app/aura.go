package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

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
