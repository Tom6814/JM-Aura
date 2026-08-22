package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"jmaura/internal/jm"
	"jmaura/internal/store"
)

type v2ProviderError struct {
	msg    string
	status int
}

func (e *v2ProviderError) Error() string { return e.msg }

func v2ProviderErr(msg string, status int) *v2ProviderError {
	return &v2ProviderError{msg: msg, status: status}
}

// v2Fail mirrors backend._v2_err: NeedLogin-ish failures map to UserError,
// ProviderError(401) maps to UserError, everything else maps to Error.
// All responses keep HTTP 200 like the Python implementation.
func v2Fail(w http.ResponseWriter, e error) {
	var pe *v2ProviderError
	if errors.As(e, &pe) {
		st := StatusError
		if pe.status == 401 {
			st = StatusUserError
		}
		writeJSON(w, 200, errSt(st, pe.msg))
		return
	}
	if is401Err(e) {
		writeJSON(w, 200, errSt(StatusUserError, e.Error()))
		return
	}
	writeJSON(w, 200, errSt(StatusError, apiErrMsg(e)))
}

func v2OK(w http.ResponseWriter, data any) {
	writeJSON(w, 200, ok(data, ""))
}

// v2GateBlocked replicates the FastAPI gate used on auth/login + auth/register:
// the source comparison lower-cases, while get_provider later does not.
func v2GateBlocked(w http.ResponseWriter, r *http.Request, source string) bool {
	if strings.ToLower(source) != "jm" || getSiteUser(r) != "" {
		return false
	}
	writeJSON(w, 401, errSt(StatusNotLogin, "Aura login required"))
	return true
}

func v2ProviderCheck(source string) error {
	if source == "jm" {
		return nil
	}
	return v2ProviderErr(fmt.Sprintf("Not supported source: %s", source), 400)
}

// v2DecodeBody emulates FastAPI body validation happening before the handler.
func v2DecodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		httpDetail(w, 422, err.Error())
		return false
	}
	if len(bytes.TrimSpace(body)) == 0 {
		httpDetail(w, 422, "Field required")
		return false
	}
	if uerr := json.Unmarshal(body, dst); uerr != nil {
		httpDetail(w, 422, uerr.Error())
		return false
	}
	return true
}

func v2RequireFields(w http.ResponseWriter, fields ...*string) bool {
	for _, f := range fields {
		if f == nil {
			httpDetail(w, 422, "Field required")
			return false
		}
	}
	return true
}

func v2QueryInt(w http.ResponseWriter, r *http.Request, name string, def int) (int, bool) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return def, true
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		httpDetail(w, 422, "Input should be a valid integer, unable to parse string as an integer")
		return 0, false
	}
	return n, true
}

type v2AuthRequest struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
}

type v2RegisterRequest struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
	Name     *string `json:"name"`
	Gender   *string `json:"gender"`
	Birthday *string `json:"birthday"`
}

type v2UpdateProfileRequest struct {
	Signature *string `json:"signature"`
}

type v2UpdatePasswordRequest struct {
	OldPassword *string `json:"old_password"`
	NewPassword *string `json:"new_password"`
}

type v2SendCommentRequest struct {
	Content *string `json:"content"`
	ReplyTo *string `json:"reply_to"`
}

type v2DownloadTaskRequest struct {
	ComicID    *string             `json:"comic_id"`
	ComicTitle *string             `json:"comic_title"`
	Chapters   []map[string]string `json:"chapters"`
	IncludeAll bool                `json:"include_all"`
}

// Response shapes follow models/schemas.py field order exactly; pointer
// fields serialize as null, slices always serialize as arrays.
type v2UserProfile struct {
	Source    string         `json:"source"`
	Username  *string        `json:"username"`
	Nickname  *string        `json:"nickname"`
	AvatarURL *string        `json:"avatar_url"`
	Signature *string        `json:"signature"`
	Raw       map[string]any `json:"raw"`
}

type v2ComicSummary struct {
	Source   string         `json:"source"`
	ComicID  string         `json:"comic_id"`
	Title    string         `json:"title"`
	Author   *string        `json:"author"`
	CoverURL *string        `json:"cover_url"`
	Tags     []string       `json:"tags"`
	Category *string        `json:"category"`
	Raw      map[string]any `json:"raw"`
}

type v2ChapterSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Order int    `json:"order"`
}

type v2ComicDetail struct {
	Source      string             `json:"source"`
	ComicID     string             `json:"comic_id"`
	Title       string             `json:"title"`
	Author      *string            `json:"author"`
	CoverURL    *string            `json:"cover_url"`
	Description *string            `json:"description"`
	Tags        []string           `json:"tags"`
	Category    *string            `json:"category"`
	Chapters    []v2ChapterSummary `json:"chapters"`
	Raw         map[string]any     `json:"raw"`
}

type v2ChapterPage struct {
	Name string  `json:"name"`
	URL  *string `json:"url"`
}

type v2ChapterDetail struct {
	Source    string          `json:"source"`
	ChapterID string          `json:"chapter_id"`
	Title     *string         `json:"title"`
	Images    []v2ChapterPage `json:"images"`
	Raw       map[string]any  `json:"raw"`
}

func v2StrPtr(s string) *string { return &s }

func v2CoverURL(aid string) string {
	base := imgBase()
	if base == "" {
		return ""
	}
	return base + "/media/albums/" + aid + ".jpg"
}

func v2SummaryFromAdapt(it map[string]any, withCategory bool) v2ComicSummary {
	s := v2ComicSummary{
		Source:   "jm",
		ComicID:  pyStr(it["album_id"]),
		Title:    pyStr(it["title"]),
		Author:   v2StrPtr(pyStr(it["author"])),
		CoverURL: v2StrPtr(pyStr(it["image"])),
		Tags:     []string{},
		Raw:      it,
	}
	if withCategory {
		s.Category = v2StrPtr(pyStr(it["category"]))
	}
	return s
}

func v2SummaryFromLatestItem(m map[string]any) (v2ComicSummary, bool) {
	if !pyTruthy(m["id"]) {
		return v2ComicSummary{}, false
	}
	aid := strings.TrimSpace(pyStr(m["id"]))
	if aid == "" {
		return v2ComicSummary{}, false
	}
	img := strings.TrimSpace(pyStr(m["image"]))
	if img == "" {
		img = v2CoverURL(aid)
	}
	return v2ComicSummary{
		Source:   "jm",
		ComicID:  aid,
		Title:    pyStr(m["name"]),
		Author:   v2StrPtr(pyStr(m["author"])),
		CoverURL: v2StrPtr(img),
		Tags:     []string{},
		Raw:      m,
	}, true
}

func v2CatID(c any) string {
	switch t := c.(type) {
	case nil:
		return "0"
	case bool:
		if !t {
			return "0"
		}
		return "True"
	case string:
		if t == "" {
			return "0"
		}
		return t
	case json.Number:
		return t.String()
	case map[string]any:
		slug := t["slug"]
		if !pyTruthy(slug) {
			slug = t["SLUG"]
		}
		if pyTruthy(slug) {
			return pyStr(slug)
		}
		v := t["CID"]
		if !pyTruthy(v) {
			v = t["id"]
		}
		if !pyTruthy(v) {
			v = t["category_id"]
		}
		if !pyTruthy(v) {
			v = t["cid"]
		}
		if !pyTruthy(v) {
			return "0"
		}
		return pyStr(v)
	default:
		return "0"
	}
}

func v2FetchCategoryIDs(ctx context.Context, ck map[string]string) []string {
	out := []string{"0"}
	res, err := apiClient().Categories(ctx, ck)
	if err != nil {
		return out
	}
	m := rawMap(decodeAny(res.Data))
	if m == nil {
		return out
	}
	cats := rawList(m["categories"])
	if len(cats) == 0 {
		cats = rawList(m["data"])
	}
	ids := make([]string, 0, len(cats))
	for _, c := range cats {
		id := v2CatID(c)
		if id != "" && id != "None" {
			ids = append(ids, id)
		}
	}
	all := append([]string{"0"}, ids...)
	seen := make(map[string]bool, len(all))
	final := make([]string, 0, len(all))
	for _, id := range all {
		if seen[id] {
			continue
		}
		seen[id] = true
		final = append(final, id)
	}
	return final
}

// v2LeaderboardItems reproduces GetSearchCategoryReq2 emissions plus the
// provider-side summary mapping (no category field).
func v2LeaderboardItems(ctx context.Context, ck map[string]string, category string, page int, sort, tag string) ([]v2ComicSummary, error) {
	q := url.Values{}
	if page > 1 {
		q.Set("page", strconv.Itoa(page))
	}
	if sort != "" {
		q.Set("o", sort)
	}
	if category != "" {
		q.Set("c", category)
	}
	if tag != "" {
		q.Set("t", tag)
	}
	res, err := apiClient().APIGet(ctx, "/categories/filter", q, ck)
	if err != nil {
		return nil, err
	}
	items := adaptSearchResult(decodeAny(res.Data))
	out := make([]v2ComicSummary, 0, len(items))
	for _, it := range items {
		if pyStr(it["album_id"]) == "" {
			continue
		}
		out = append(out, v2SummaryFromAdapt(it, false))
	}
	return out, nil
}

func handleV2Login(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	var req v2AuthRequest
	if !v2DecodeBody(w, r, &req) {
		return
	}
	if !v2RequireFields(w, req.Username, req.Password) {
		return
	}
	if v2GateBlocked(w, r, source) {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	_, captured, raw, lerr := jm.NewClient().Login(r.Context(), *req.Username, *req.Password)
	if lerr != nil {
		v2Fail(w, lerr)
		return
	}
	identity := effIdentityOf(r)
	_ = store.SaveCookies(identity, captured)
	if siteU := getSiteUser(r); siteU != "" {
		_ = store.CredSet(siteU, *req.Username, *req.Password)
	}
	if raw != nil {
		store.JmSetProfile(identity, raw)
		for _, k := range []string{"uid", "user_id", "id"} {
			if v := raw[k]; v != nil && pyTruthy(v) {
				store.JmSetUserID(identity, pyStr(v))
				break
			}
		}
	}
	if raw == nil {
		raw = map[string]any{}
	}
	v2OK(w, raw)
}

func handleV2Register(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	var req v2RegisterRequest
	if !v2DecodeBody(w, r, &req) {
		return
	}
	if !v2RequireFields(w, req.Username, req.Password) {
		return
	}
	if v2GateBlocked(w, r, source) {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	v2Fail(w, v2ProviderErr("JM register not supported in app API", 400))
}

func handleV2ProfileGet(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	raw := store.JmGetProfile(effIdentityOf(r))
	prof := v2UserProfile{
		Source:   "jm",
		Username: v2StrPtr(store.CredActiveUsername(getSiteUser(r))),
		Raw:      raw,
	}
	if raw != nil {
		if n, isStr := raw["username"].(string); isStr {
			prof.Nickname = v2StrPtr(n)
		}
	}
	v2OK(w, prof)
}

func handleV2Checkin(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	identity := effIdentityOf(r)
	uid := store.JmGetUserID(identity)
	if uid == "" {
		v2Fail(w, v2ProviderErr("Missing user_id, please login again", 400))
		return
	}
	ctx := r.Context()
	ck := store.LoadCookies(identity)
	dres, derr := apiClient().Daily(ctx, uid, ck)
	if derr != nil {
		v2Fail(w, derr)
		return
	}
	dailyID := ""
	if dm := rawMap(decodeAny(dres.Data)); dm != nil {
		for _, k := range []string{"daily_id", "id"} {
			if pyTruthy(dm[k]) {
				dailyID = pyStr(dm[k])
				break
			}
		}
		if dailyID == "" {
			for _, k := range []string{"list", "daily_list", "data"} {
				lst := rawList(dm[k])
				if len(lst) == 0 {
					continue
				}
				item := rawMap(lst[0])
				if item == nil {
					continue
				}
				v := item["daily_id"]
				if !pyTruthy(v) {
					v = item["id"]
				}
				if pyTruthy(v) {
					dailyID = pyStr(v)
					break
				}
			}
		}
	}
	if dailyID == "" {
		v2Fail(w, v2ProviderErr("Unable to get daily_id", 400))
		return
	}
	res, cerr := apiClient().DailyCheckIn(ctx, uid, dailyID, ck)
	if cerr != nil {
		v2Fail(w, cerr)
		return
	}
	out := decodeAny(res.Data)
	if _, isMap := out.(map[string]any); !isMap {
		out = map[string]any{"raw": out}
	}
	v2OK(w, out)
}

func handleV2ProfileUpdate(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	var req v2UpdateProfileRequest
	if !v2DecodeBody(w, r, &req) {
		return
	}
	if !v2RequireFields(w, req.Signature) {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	v2Fail(w, v2ProviderErr("Not supported", 400))
}

func handleV2PasswordUpdate(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	var req v2UpdatePasswordRequest
	if !v2DecodeBody(w, r, &req) {
		return
	}
	if !v2RequireFields(w, req.OldPassword, req.NewPassword) {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	v2Fail(w, v2ProviderErr("Not supported", 400))
}

func handleV2AvatarUpdate(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	f, _, ferr := r.FormFile("file")
	if ferr != nil {
		httpDetail(w, 422, "Field required")
		return
	}
	f.Close()
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	v2Fail(w, v2ProviderErr("Not supported", 400))
}

func handleV2Categories(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	res, err := apiClient().Categories(r.Context(), store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	out := []any{}
	if m := rawMap(decodeAny(res.Data)); m != nil {
		if l := rawList(m["categories"]); len(l) > 0 {
			out = l
		} else if l2 := rawList(m["data"]); len(l2) > 0 {
			out = l2
		}
	}
	v2OK(w, out)
}

func handleV2Search(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	qp := r.URL.Query()
	if _, present := qp["q"]; !present {
		httpDetail(w, 422, "Field required")
		return
	}
	q := qp.Get("q")
	page, pok := v2QueryInt(w, r, "page", 1)
	if !pok {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	sq := url.Values{}
	sq.Set("search_query", q)
	sq.Set("o", "mr")
	if page > 1 {
		sq.Set("page", strconv.Itoa(page))
	}
	res, err := apiClient().APIGet(r.Context(), "/search", sq, store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	items := adaptSearchResult(decodeAny(res.Data))
	out := make([]v2ComicSummary, 0, len(items))
	for _, it := range items {
		if pyStr(it["album_id"]) == "" {
			continue
		}
		out = append(out, v2SummaryFromAdapt(it, true))
	}
	v2OK(w, out)
}

func handleV2Leaderboard(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	page, pok := v2QueryInt(w, r, "page", 1)
	if !pok {
		return
	}
	qp := r.URL.Query()
	category := qp.Get("category")
	if category == "" {
		category = "0"
	}
	sort := qp.Get("sort")
	if sort == "" {
		sort = "tf"
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	items, err := v2LeaderboardItems(r.Context(), store.LoadCookies(effIdentityOf(r)), category, page, sort, qp.Get("tag"))
	if err != nil {
		v2Fail(w, err)
		return
	}
	v2OK(w, items)
}

func handleV2Random(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	ctx := r.Context()
	ck := store.LoadCookies(effIdentityOf(r))
	catIDs := v2FetchCategoryIDs(ctx, ck)
	sorts := []string{"mr", "tf", "mv", "mp"}
	for i := 0; i < 8; i++ {
		items, lerr := v2LeaderboardItems(ctx, ck, catIDs[rand.Intn(len(catIDs))], rand.Intn(50)+1, sorts[rand.Intn(len(sorts))], "")
		if lerr != nil {
			continue
		}
		if len(items) > 0 {
			v2OK(w, items[rand.Intn(len(items))])
			return
		}
	}
	lres, lerr := apiClient().Latest(ctx, "0", ck)
	if lerr != nil {
		v2Fail(w, lerr)
		return
	}
	raw := decodeAny(lres.Data)
	if list, isList := raw.([]any); isList && len(list) > 0 {
		if m := rawMap(list[rand.Intn(len(list))]); m != nil {
			if s, ok2 := v2SummaryFromLatestItem(m); ok2 {
				v2OK(w, s)
				return
			}
		}
	}
	items := adaptSearchResult(raw)
	if len(items) == 0 {
		v2OK(w, nil)
		return
	}
	it2 := items[rand.Intn(len(items))]
	aid := strings.TrimSpace(pyStr(it2["album_id"]))
	if aid == "" {
		v2OK(w, nil)
		return
	}
	img := strings.TrimSpace(pyStr(it2["image"]))
	if img == "" {
		img = v2CoverURL(aid)
	}
	v2OK(w, v2ComicSummary{
		Source:   "jm",
		ComicID:  aid,
		Title:    pyStr(it2["title"]),
		Author:   v2StrPtr(pyStr(it2["author"])),
		CoverURL: v2StrPtr(img),
		Tags:     []string{},
		Raw:      it2,
	})
}

func handleV2AlsoViewed(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	ctx := r.Context()
	ck := store.LoadCookies(effIdentityOf(r))
	cur := strings.TrimSpace(r.PathValue("comic_id"))
	seen := map[string]bool{}
	out := []v2ComicSummary{}
	add := func(m map[string]any) bool {
		aid := strings.TrimSpace(pyStr(m["id"]))
		if aid == "" || aid == cur || seen[aid] {
			return false
		}
		seen[aid] = true
		img := strings.TrimSpace(pyStr(m["image"]))
		if img == "" {
			img = v2CoverURL(aid)
		}
		out = append(out, v2ComicSummary{
			Source:   "jm",
			ComicID:  aid,
			Title:    pyStr(m["name"]),
			Author:   v2StrPtr(pyStr(m["author"])),
			CoverURL: v2StrPtr(img),
			Tags:     []string{},
			Raw:      m,
		})
		return true
	}
	pres, perr := apiClient().Promote(ctx, "0", ck)
	if perr != nil {
		v2Fail(w, perr)
		return
	}
	if sections, isList := decodeAny(pres.Data).([]any); isList {
		for _, sec := range sections {
			sm := rawMap(sec)
			if sm == nil {
				continue
			}
			for _, c := range rawList(sm["content"]) {
				cm := rawMap(c)
				if cm == nil {
					continue
				}
				add(cm)
				if len(out) >= 24 {
					v2OK(w, out)
					return
				}
			}
		}
	}
	if len(out) > 0 {
		v2OK(w, out)
		return
	}
	lres, lerr := apiClient().Latest(ctx, "0", ck)
	if lerr != nil {
		v2Fail(w, lerr)
		return
	}
	raw2 := decodeAny(lres.Data)
	if list, isList := raw2.([]any); isList {
		for _, x := range list {
			xm := rawMap(x)
			if xm == nil {
				continue
			}
			add(xm)
			if len(out) >= 24 {
				break
			}
		}
	} else {
		for _, it := range adaptSearchResult(raw2) {
			aid := strings.TrimSpace(pyStr(it["album_id"]))
			if aid == "" || aid == cur || seen[aid] {
				continue
			}
			seen[aid] = true
			img := strings.TrimSpace(pyStr(it["image"]))
			if img == "" {
				img = v2CoverURL(aid)
			}
			out = append(out, v2ComicSummary{
				Source:   "jm",
				ComicID:  aid,
				Title:    pyStr(it["title"]),
				Author:   v2StrPtr(pyStr(it["author"])),
				CoverURL: v2StrPtr(img),
				Tags:     []string{},
				Raw:      it,
			})
			if len(out) >= 24 {
				break
			}
		}
	}
	v2OK(w, out)
}

func handleV2ComicDetail(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	comicID := r.PathValue("comic_id")
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	aq := url.Values{}
	aq.Set("comicName", "")
	aq.Set("id", comicID)
	res, err := apiClient().APIGet(r.Context(), "/album", aq, store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	d := adaptAlbumDetail(decodeRawMap(res.Data))
	chapters := []v2ChapterSummary{}
	if eps, ok2 := d["episode_list"].([]map[string]any); ok2 {
		for idx, ep := range eps {
			cid := pyStr(ep["id"])
			if cid == "" {
				continue
			}
			chapters = append(chapters, v2ChapterSummary{ID: cid, Title: pyStr(ep["title"]), Order: idx})
		}
	}
	comicIDOut := pyStr(d["album_id"])
	if comicIDOut == "" {
		comicIDOut = comicID
	}
	tags, _ := d["tags"].([]string)
	if tags == nil {
		tags = []string{}
	}
	v2OK(w, v2ComicDetail{
		Source:      "jm",
		ComicID:     comicIDOut,
		Title:       pyStr(d["title"]),
		Author:      v2StrPtr(pyStr(d["author"])),
		CoverURL:    v2StrPtr(pyStr(d["image"])),
		Description: v2StrPtr(pyStr(d["description"])),
		Tags:        tags,
		Category:    nil,
		Chapters:    chapters,
		Raw:         d,
	})
}

func handleV2ChapterDetail(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	chapterID := r.PathValue("chapter_id")
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	info, err := fetchJmChapter(r.Context(), store.LoadCookies(effIdentityOf(r)), chapterID)
	if err != nil {
		v2Fail(w, err)
		return
	}
	images := make([]v2ChapterPage, 0, len(info.Names))
	for _, s := range info.Names {
		if s == "" {
			continue
		}
		images = append(images, v2ChapterPage{Name: s})
	}
	v2OK(w, v2ChapterDetail{
		Source:    "jm",
		ChapterID: chapterID,
		Title:     v2StrPtr(info.Title),
		Images:    images,
		Raw:       chapterInfoMap(info, chapterID),
	})
}

func handleV2Comments(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	comicID := r.PathValue("comic_id")
	page, pok := v2QueryInt(w, r, "page", 1)
	if !pok {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	cq := url.Values{}
	cq.Set("mode", "manhua")
	if comicID != "" {
		cq.Set("aid", comicID)
	}
	cq.Set("page", strconv.Itoa(page))
	res, err := apiClient().APIGet(r.Context(), "/forum", cq, store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	v2OK(w, decodeAny(res.Data))
}

func handleV2SendComment(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	comicID := r.PathValue("comic_id")
	var req v2SendCommentRequest
	if !v2DecodeBody(w, r, &req) {
		return
	}
	if !v2RequireFields(w, req.Content) {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	cid := ""
	if req.ReplyTo != nil {
		cid = *req.ReplyTo
	}
	form := url.Values{}
	form.Set("comment", *req.Content)
	form.Set("aid", comicID)
	if cid != "" {
		form.Set("comment_id", cid)
	}
	res, err := apiClient().APIPost(r.Context(), "/comment", form, store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	v2OK(w, decodeAny(res.Data))
}

func handleV2LikeComment(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	res, err := apiClient().LikeComment(r.Context(), r.PathValue("comment_id"), store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	v2OK(w, decodeAny(res.Data))
}

func handleV2ToggleFavorite(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	res, err := apiClient().AddFavorite(r.Context(), r.PathValue("comic_id"), store.LoadCookies(effIdentityOf(r)))
	if err != nil {
		v2Fail(w, err)
		return
	}
	v2OK(w, decodeAny(res.Data))
}

func handleV2LikeComic(w http.ResponseWriter, r *http.Request) {
	if perr := v2ProviderCheck(r.PathValue("source")); perr != nil {
		v2Fail(w, perr)
		return
	}
	v2Fail(w, v2ProviderErr("JM comic like not supported in current API", 400))
}

// v2TaskSnapshot reads shared download-task state without touching dl.go.
func v2TaskSnapshot(id string) (pub map[string]any, status, zipPath string, found bool) {
	taskManager.mu.Lock()
	defer taskManager.mu.Unlock()
	t, ok := taskManager.tasks[id]
	if !ok {
		return nil, "", "", false
	}
	return t.toPublic(), t.Status, t.ZipPath, true
}

func handleV2CreateDownloadTask(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	var req v2DownloadTaskRequest
	if !v2DecodeBody(w, r, &req) {
		return
	}
	if !v2RequireFields(w, req.ComicID) {
		return
	}
	if perr := v2ProviderCheck(source); perr != nil {
		v2Fail(w, perr)
		return
	}
	var cached map[string]any
	fetchDetail := func() (map[string]any, error) {
		if cached != nil {
			return cached, nil
		}
		aq := url.Values{}
		aq.Set("comicName", "")
		aq.Set("id", *req.ComicID)
		res, err := apiClient().APIGet(r.Context(), "/album", aq, store.LoadCookies(effIdentityOf(r)))
		if err != nil {
			return nil, err
		}
		cached = adaptAlbumDetail(decodeRawMap(res.Data))
		return cached, nil
	}
	chapters := make([]downloadChapter, 0, len(req.Chapters))
	for _, cm := range req.Chapters {
		chapters = append(chapters, downloadChapter{ID: cm["id"], Title: cm["title"]})
	}
	if req.IncludeAll || len(chapters) == 0 {
		d, ferr := fetchDetail()
		if ferr != nil {
			v2Fail(w, ferr)
			return
		}
		chapters = []downloadChapter{}
		if eps, ok2 := d["episode_list"].([]map[string]any); ok2 {
			for _, ep := range eps {
				cid := pyStr(ep["id"])
				if cid == "" {
					continue
				}
				ct := pyStr(ep["title"])
				if ct == "" {
					ct = cid
				}
				chapters = append(chapters, downloadChapter{ID: cid, Title: ct})
			}
		}
	}
	title := ""
	if req.ComicTitle != nil {
		title = *req.ComicTitle
	}
	if title == "" {
		d, terr := fetchDetail()
		if terr != nil || d == nil {
			title = *req.ComicID
		} else {
			title = pyStr(d["title"])
		}
	}
	if source == "jm" {
		task := taskManager.createTask(*req.ComicID, title, chapters, effIdentityOf(r))
		pub := task.toPublic()
		dlURL := ""
		if task.Status == "completed" && task.ZipPath != "" {
			dlURL = fmt.Sprintf("/api/v2/%s/download/tasks/%s/download", source, task.TaskID)
		}
		pub["download_url"] = dlURL
		v2OK(w, pub)
		return
	}
	v2Fail(w, v2ProviderErr("Unknown source", 400))
}

func handleV2GetDownloadTask(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	taskID := r.PathValue("task_id")
	if source == "jm" {
		pub, status, zipPath, found := v2TaskSnapshot(taskID)
		if !found {
			v2Fail(w, v2ProviderErr("Task not found", 404))
			return
		}
		if status == "completed" && zipPath != "" {
			pub["download_url"] = fmt.Sprintf("/api/v2/%s/download/tasks/%s/download", source, taskID)
		}
		v2OK(w, pub)
		return
	}
	v2Fail(w, v2ProviderErr("Unknown source", 400))
}

func handleV2CancelDownloadTask(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	taskID := r.PathValue("task_id")
	if source == "jm" {
		if taskManager.cancelQueued(taskID) {
			v2OK(w, map[string]any{"status": "cancelled"})
			return
		}
		v2Fail(w, v2ProviderErr("Task not found or cannot be cancelled", 400))
		return
	}
	v2Fail(w, v2ProviderErr("Unknown source", 400))
}

func handleV2DownloadTaskZip(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("source") != "jm" {
		httpDetail(w, 400, "Unknown source")
		return
	}
	_, status, zipPath, found := v2TaskSnapshot(r.PathValue("task_id"))
	if !found || status != "completed" || zipPath == "" {
		httpDetail(w, 404, "Zip not available")
		return
	}
	f, oerr := os.Open(zipPath)
	if oerr != nil {
		httpDetail(w, 404, "File not found")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(zipPath)))
	if fi, serr := f.Stat(); serr == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}

func handleV2CacheCleanup(w http.ResponseWriter, r *http.Request) {
	keepDays, pok := v2QueryInt(w, r, "keep_days", 7)
	if !pok {
		return
	}
	dirs, work := dlCleanupCache(keepDays)
	writeJSON(w, 200, ok(map[string]any{"removed_dirs": dirs, "removed_work": work}, ""))
}
