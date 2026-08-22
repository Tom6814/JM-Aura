package app

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:webdist
var webDistFS embed.FS

func route(mux *http.ServeMux, method, pattern string, h http.HandlerFunc) {
	mux.HandleFunc(method+" "+pattern, h)
}

// NewRouter wires every endpoint. Legacy paths mirror backend/main.py
// decorators one-to-one; aura extension routes use fresh RESTful paths;
// v2 provider routes mirror the /api/v2 surface exactly.
func NewRouter() *http.ServeMux {
	mux := http.NewServeMux()

	route(mux, http.MethodGet, "/api/client-info", handleClientInfo)
	route(mux, http.MethodGet, "/api/jm/debug", handleJmDebug)
	route(mux, http.MethodPost, "/api/site/login", handleSiteLogin)
	route(mux, http.MethodPost, "/api/site/logout", handleSiteLogout)
	route(mux, http.MethodGet, "/api/site/me", handleSiteMe)
	route(mux, http.MethodGet, "/api/site/profile", handleSiteProfileGet)
	route(mux, http.MethodPost, "/api/site/profile", handleSiteProfilePatch)

	route(mux, http.MethodGet, "/api/aura/library/summary", handleAuraSummary)
	route(mux, http.MethodGet, "/api/aura/library/history", handleAuraHistoryGet)
	route(mux, http.MethodPost, "/api/aura/library/history", handleAuraHistoryPost)
	route(mux, http.MethodGet, "/api/aura/library/folders", handleAuraFoldersList)
	route(mux, http.MethodPost, "/api/aura/library/folders", handleAuraFolderCreate)
	route(mux, http.MethodPut, "/api/aura/library/folders", handleAuraFolderRename)
	route(mux, http.MethodDelete, "/api/aura/library/folders", handleAuraFolderDelete)
	route(mux, http.MethodPost, "/api/aura/library/folders/toggle", handleAuraFolderToggle)
	route(mux, http.MethodGet, "/api/aura/library/notes/{album_id}", handleAuraNoteGet)
	route(mux, http.MethodPost, "/api/aura/library/notes", handleAuraNoteSet)

	route(mux, http.MethodGet, "/api/jm/register/captcha", handleJMRegisterCaptcha)
	route(mux, http.MethodPost, "/api/jm/register", handleJMRegister)

	route(mux, http.MethodPost, "/api/config", handleConfigPost)
	route(mux, http.MethodGet, "/api/config", handleConfigGet)
	route(mux, http.MethodGet, "/api/credentials", handleCredentialsGet)
	route(mux, http.MethodDelete, "/api/credentials", handleCredentialsDelete)
	route(mux, http.MethodPost, "/api/session/relogin", handleSessionRelogin)
	route(mux, http.MethodPost, "/api/logout", handleLogout)

	route(mux, http.MethodGet, "/api/promote", handlePromote)
	route(mux, http.MethodGet, "/api/latest", handleLatest)
	route(mux, http.MethodGet, "/api/search", handleSearch)
	route(mux, http.MethodGet, "/api/album/{album_id}", handleAlbum)
	route(mux, http.MethodGet, "/api/chapter/{photo_id}", handleChapter)
	route(mux, http.MethodGet, "/api/favorites", handleFavorites)
	route(mux, http.MethodGet, "/api/favorites/sync", handleFavoritesSync)
	route(mux, http.MethodPost, "/api/favorite/toggle", handleFavoriteToggle)
	route(mux, http.MethodPost, "/api/favorite_folder", handleFavoriteFolder)
	route(mux, http.MethodGet, "/api/comments", handleComments)
	route(mux, http.MethodPost, "/api/comment", handleCommentSend)
	route(mux, http.MethodPost, "/api/comment/like", handleCommentLike)
	route(mux, http.MethodGet, "/api/history", handleHistory)
	route(mux, http.MethodGet, "/api/task/promote", handleTaskPromote)
	route(mux, http.MethodGet, "/api/task/latest", handleTaskLatest)

	route(mux, http.MethodGet, "/api/image-proxy", handleImageProxy)
	route(mux, http.MethodGet, "/api/chapter_image/{photo_id}/{image_name}", handleChapterImage)

	route(mux, http.MethodGet, "/api/download_zip", handleDownloadZip)
	route(mux, http.MethodPost, "/api/download", handleDownloadAlbum)
	route(mux, http.MethodPost, "/api/download/tasks", handleCreateDownloadTask)
	route(mux, http.MethodGet, "/api/download/tasks/{task_id}", handleGetDownloadTask)
	route(mux, http.MethodGet, "/api/download/tasks/{task_id}/download", handleDownloadTaskZip)

	route(mux, http.MethodPost, "/api/v2/{source}/auth/login", handleV2Login)
	route(mux, http.MethodPost, "/api/v2/{source}/auth/register", handleV2Register)
	route(mux, http.MethodGet, "/api/v2/{source}/user/profile", handleV2ProfileGet)
	route(mux, http.MethodPost, "/api/v2/{source}/user/checkin", handleV2Checkin)
	route(mux, http.MethodPut, "/api/v2/{source}/user/profile", handleV2ProfileUpdate)
	route(mux, http.MethodPut, "/api/v2/{source}/user/password", handleV2PasswordUpdate)
	route(mux, http.MethodPut, "/api/v2/{source}/user/avatar", handleV2AvatarUpdate)
	route(mux, http.MethodGet, "/api/v2/{source}/categories", handleV2Categories)
	route(mux, http.MethodGet, "/api/v2/{source}/search", handleV2Search)
	route(mux, http.MethodGet, "/api/v2/{source}/leaderboard", handleV2Leaderboard)
	route(mux, http.MethodGet, "/api/v2/{source}/random", handleV2Random)
	route(mux, http.MethodGet, "/api/v2/{source}/also_viewed/{comic_id}", handleV2AlsoViewed)
	route(mux, http.MethodGet, "/api/v2/{source}/comic/{comic_id}", handleV2ComicDetail)
	route(mux, http.MethodGet, "/api/v2/{source}/chapter/{chapter_id}", handleV2ChapterDetail)
	route(mux, http.MethodGet, "/api/v2/{source}/comic/{comic_id}/comments", handleV2Comments)
	route(mux, http.MethodPost, "/api/v2/{source}/comic/{comic_id}/comments", handleV2SendComment)
	route(mux, http.MethodPost, "/api/v2/{source}/comment/{comment_id}/like", handleV2LikeComment)
	route(mux, http.MethodPost, "/api/v2/{source}/comic/{comic_id}/favorite", handleV2ToggleFavorite)
	route(mux, http.MethodPost, "/api/v2/{source}/comic/{comic_id}/like", handleV2LikeComic)
	route(mux, http.MethodPost, "/api/v2/{source}/download/tasks", handleV2CreateDownloadTask)
	route(mux, http.MethodGet, "/api/v2/{source}/download/tasks/{task_id}", handleV2GetDownloadTask)
	route(mux, http.MethodDelete, "/api/v2/{source}/download/tasks/{task_id}", handleV2CancelDownloadTask)
	route(mux, http.MethodGet, "/api/v2/{source}/download/tasks/{task_id}/download", handleV2DownloadTaskZip)
	route(mux, http.MethodPost, "/api/v2/cache/cleanup", handleV2CacheCleanup)

	registerSPA(mux)
	return mux
}

// registerSPA serves the embedded frontend: real files win, extension-less
// paths fall back to index.html (history-mode routing), unknown assets 404.
func registerSPA(mux *http.ServeMux) {
	sub, serr := fs.Sub(webDistFS, "webdist")
	if serr != nil {
		panic(serr)
	}
	index, ierr := fs.ReadFile(sub, "index.html")
	if ierr != nil {
		panic(ierr)
	}
	files := http.FileServer(http.FS(sub))
	writeIndex := func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	}
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			writeIndex(w)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			httpDetail(w, http.StatusNotFound, "Not Found")
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" || strings.HasPrefix(p, "..") {
			httpDetail(w, http.StatusNotFound, "Not Found")
			return
		}
		if st, statErr := fs.Stat(sub, p); statErr == nil && !st.IsDir() {
			if strings.HasPrefix(p, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		if !strings.Contains(path.Base(p), ".") {
			writeIndex(w)
			return
		}
		httpDetail(w, http.StatusNotFound, "Not Found")
	})
}
