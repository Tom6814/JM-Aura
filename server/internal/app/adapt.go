package app

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"jmaura/internal/jm"
)

var defaultClient = jm.NewClient()

func apiClient() *jm.Client { return defaultClient }

func imgBase() string {
	ds := defaultClient.ImageDomains()
	if len(ds) == 0 {
		return ""
	}
	d := ds[0]
	if strings.Contains(d, "://") {
		return strings.TrimRight(d, "/")
	}
	return "https://" + d
}

func coverURL(albumID string) string {
	return imgBase() + "/media/albums/" + albumID + ".jpg"
}

func pyStr(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case json.Number:
		return t.String()
	case bool:
		if t {
			return "True"
		}
		return "False"
	case []any:
		return pyReprList(t)
	case map[string]any:
		return pyReprDict(t)
	default:
		return fmt.Sprint(v)
	}
}

func pyReprString(s string) string {
	var b strings.Builder
	b.WriteByte('\'')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '\'':
			b.WriteString(`\'`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('\'')
	return b.String()
}

func pyReprList(items []any) string {
	parts := make([]string, 0, len(items))
	for _, it := range items {
		parts = append(parts, pyReprValue(it))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func pyReprDict(m map[string]any) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, pyReprString(k)+": "+pyReprValue(m[k]))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func pyReprValue(v any) string {
	switch t := v.(type) {
	case nil:
		return "None"
	case string:
		return pyReprString(t)
	case json.Number:
		return t.String()
	case bool:
		if t {
			return "True"
		}
		return "False"
	case []any:
		return pyReprList(t)
	case map[string]any:
		return pyReprDict(t)
	default:
		return fmt.Sprint(v)
	}
}

func pyTruthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case string:
		return t != ""
	case bool:
		return t
	case json.Number:
		f, err := t.Float64()
		return err == nil && f != 0
	case int:
		return t != 0
	case int64:
		return t != 0
	case float64:
		return t != 0
	case []any:
		return len(t) > 0
	case map[string]any:
		return len(t) > 0
	default:
		return true
	}
}

func pyOrStr(v any, fallback ...string) string {
	if !pyTruthy(v) {
		if len(fallback) > 0 {
			return fallback[0]
		}
		return ""
	}
	return pyStr(v)
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func formatTimestamp(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		s := strings.TrimSpace(t)
		if isDigits(s) {
			n, nerr := strconv.ParseInt(s, 10, 64)
			if nerr != nil {
				return s
			}
			return formatTsFloat(float64(n))
		}
		return s
	case json.Number:
		f, ferr := t.Float64()
		if ferr != nil {
			return ""
		}
		return formatTsFloat(f)
	case int:
		return formatTsFloat(float64(t))
	case int64:
		return formatTsFloat(float64(t))
	case float64:
		return formatTsFloat(t)
	default:
		return strings.TrimSpace(pyStr(v))
	}
}

func formatTsFloat(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return ""
	}
	if f > 1e10 {
		f = f / 1000.0
	}
	secs := int64(math.Floor(f))
	return time.Unix(secs, 0).UTC().Format("2006-01-02")
}

func rawList(v any) []any {
	l, _ := v.([]any)
	return l
}

func rawMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func rawStr(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	return pyStr(m[key])
}

func extractTags(data map[string]any) []string {
	candidates := []any{
		data["tags"],
		data["tag_list"],
		data["tag"],
		data["keywords"],
		data["keyword"],
	}
	out := []string{}
	add := func(x string) {
		s := strings.TrimSpace(x)
		if s == "" {
			return
		}
		for _, e := range out {
			if e == s {
				return
			}
		}
		out = append(out, s)
	}
	for _, c := range candidates {
		switch t := c.(type) {
		case nil:
			continue
		case string:
			for _, part := range strings.Split(strings.ReplaceAll(t, "，", ","), ",") {
				add(part)
			}
		case []any:
			for _, it := range t {
				switch iv := it.(type) {
				case string:
					add(iv)
				case map[string]any:
					v := iv["title"]
					if !pyTruthy(v) {
						v = iv["name"]
					}
					if !pyTruthy(v) {
						v = iv["tag"]
					}
					add(pyStr(v))
				}
			}
		case map[string]any:
			v := t["title"]
			if !pyTruthy(v) {
				v = t["name"]
			}
			add(pyStr(v))
		}
	}
	return out
}

var updateTimeKeys = []string{"update_time", "update_at", "updated_at", "update", "last_update", "last_updated", "update_date", "addtime"}

func extractUpdateTime(data map[string]any) string {
	for _, k := range updateTimeKeys {
		v, has := data[k]
		if !has {
			continue
		}
		if v == nil {
			continue
		}
		if s, isStr := v.(string); isStr && s == "" {
			continue
		}
		return formatTimestamp(v)
	}
	return ""
}

func adaptSearchResult(data any) []map[string]any {
	dm, isMap := data.(map[string]any)
	if !isMap {
		return []map[string]any{}
	}
	contentV := dm["content"]
	if !pyTruthy(contentV) {
		contentV = nil
	}
	results := []map[string]any{}
	for _, item := range rawList(contentV) {
		im := rawMap(item)
		if im == nil {
			continue
		}
		albumID := pyOrStr(im["id"])
		if albumID == "" {
			continue
		}
		category := ""
		catObj, hasCat := im["category"]
		if hasCat {
			if cm := rawMap(catObj); cm != nil {
				category = pyStr(cm["title"])
			} else if catObj != nil {
				category = pyStr(catObj)
			}
		}
		image := im["image"]
		if !pyTruthy(image) {
			image = coverURL(albumID)
		}
		results = append(results, map[string]any{
			"album_id": albumID,
			"title":    pyOrStr(im["name"]),
			"author":   pyOrStr(im["author"]),
			"category": category,
			"image":    pyStr(image),
		})
	}
	return results
}

func adaptAlbumDetail(data map[string]any) map[string]any {
	if data == nil {
		return map[string]any{}
	}
	albumID := pyOrStr(data["id"])
	if albumID == "" {
		return map[string]any{}
	}

	episodes := []map[string]any{}
	series := data["series"]
	sl := rawList(series)
	if len(sl) > 0 {
		for idx, ep := range sl {
			em := rawMap(ep)
			if em == nil {
				continue
			}
			epID := pyOrStr(em["id"])
			if epID == "" {
				continue
			}
			title := strings.TrimSpace(pyOrStr(em["name"]))
			if title == "" {
				sortV := em["sort"]
				if pyTruthy(sortV) {
					title = fmt.Sprintf("第 %s 话", pyStr(sortV))
				} else {
					title = fmt.Sprintf("第 %d 话", idx+1)
				}
			}
			episodes = append(episodes, map[string]any{
				"id":          epID,
				"title":       title,
				"update_time": extractUpdateTime(em),
			})
		}
	} else {
		episodes = append(episodes, map[string]any{
			"id":          albumID,
			"title":       "第 1 话",
			"update_time": "",
		})
	}

	descV := data["description"]
	if !pyTruthy(descV) {
		descV = ""
	}

	return map[string]any{
		"album_id":     albumID,
		"title":        pyOrStr(data["name"]),
		"author":       pyOrStr(data["author"]),
		"description":  descV,
		"tags":         extractTags(data),
		"update_time":  extractUpdateTime(data),
		"episode_list": episodes,
		"image_count":  len(episodes),
		"image":        coverURL(albumID),
	}
}

func toInt(v any) int {
	switch t := v.(type) {
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return int(i)
		}
		if f, err := t.Float64(); err == nil {
			return int(f)
		}
		return 0
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	case string:
		i, _ := strconv.Atoi(strings.TrimSpace(t))
		return i
	default:
		return 0
	}
}

func adaptFavorites(data any) map[string]any {
	dm, isMap := data.(map[string]any)
	if !isMap {
		return map[string]any{"content": []any{}, "total": 0, "pages": 1, "folders": []any{}}
	}

	contentV := dm["content"]
	if !pyTruthy(contentV) {
		contentV = dm["list"]
	}
	if !pyTruthy(contentV) {
		contentV = nil
	}
	content := rawList(contentV)

	out := []map[string]any{}
	for _, item := range content {
		im := rawMap(item)
		if im == nil {
			continue
		}
		albumID := pyOrStr(im["id"])
		if albumID == "" {
			albumID = pyOrStr(im["album_id"])
		}
		if albumID == "" {
			continue
		}
		image := im["image"]
		if !pyTruthy(image) {
			image = coverURL(albumID)
		}
		category := ""
		if catObj, has := im["category"]; has {
			if cm := rawMap(catObj); cm != nil {
				category = pyStr(cm["title"])
			} else if catObj != nil {
				category = pyStr(catObj)
			}
		}
		title := pyOrStr(im["name"])
		if title == "" {
			title = pyOrStr(im["title"])
		}
		if category == "" {
			category = "Favorite"
		}
		out = append(out, map[string]any{
			"album_id": albumID,
			"title":    title,
			"author":   pyOrStr(im["author"]),
			"image":    pyStr(image),
			"category": category,
		})
	}

	foldersV := dm["folder_list"]
	if !pyTruthy(foldersV) {
		foldersV = dm["folders"]
	}
	folderOut := []map[string]string{}
	for _, f := range rawList(foldersV) {
		fm := rawMap(f)
		if fm == nil {
			continue
		}
		id := pyOrStr(fm["FID"])
		if id == "" {
			id = pyOrStr(fm["id"])
		}
		if id == "" {
			id = "0"
		}
		folderOut = append(folderOut, map[string]string{"id": id, "name": pyStr(fm["name"])})
	}

	totalV := dm["total"]
	total := 0
	if pyTruthy(totalV) {
		total = toInt(totalV)
	}
	pageSize := len(content)
	if pyTruthy(dm["count"]) {
		pageSize = toInt(dm["count"])
	}
	pagesV := dm["page_count"]
	if !pyTruthy(pagesV) {
		pagesV = dm["pages"]
	}
	pages := 0
	if pyTruthy(pagesV) {
		pages = toInt(pagesV)
	}
	if pages <= 0 {
		if total > 0 && pageSize > 0 {
			pages = int(math.Ceil(float64(total) / float64(pageSize)))
		} else {
			pages = 1
		}
	}

	return map[string]any{
		"content": out,
		"total":   total,
		"pages":   pages,
		"folders": folderOut,
	}
}

func adaptChapterDetail(chapterData, templateData map[string]any, photoID string) map[string]any {
	images := []string{}
	title := ""
	albumID := ""

	if chapterData != nil {
		title = pyOrStr(chapterData["name"])
		albumID = pyOrStr(chapterData["series_id"])
		if albumID == "" {
			albumID = pyOrStr(chapterData["album_id"])
		}
		for _, x := range rawList(chapterData["images"]) {
			if pyTruthy(x) {
				images = append(images, pyStr(x))
			}
		}
	}

	scrambleID := "0"
	var dataOriginalDomain any
	if templateData != nil {
		sv := templateData["scramble_id"]
		if pyTruthy(sv) {
			scrambleID = pyStr(sv)
		}
		dataOriginalDomain = templateData["data_original_domain"]
	}

	return map[string]any{
		"photo_id":             photoID,
		"album_id":             albumID,
		"scramble_id":          scrambleID,
		"data_original_domain": dataOriginalDomain,
		"images":               images,
		"title":                title,
		"index":                0,
	}
}
