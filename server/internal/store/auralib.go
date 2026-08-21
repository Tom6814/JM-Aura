package store

import (
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

func auraLibFile() string {
	if v := os.Getenv("JM_AURA_AURA_LIBRARY_PATH"); v != "" {
		return v
	}
	return "aura_library.json"
}

func loadAuraDoc() map[string]any {
	if doc, ok := LoadJSON(auraLibFile()); ok {
		if _, ok := doc["users"].(map[string]any); !ok {
			doc["users"] = map[string]any{}
		}
		return doc
	}
	return map[string]any{"v": 1, "users": map[string]any{}}
}

func saveAuraDoc(doc map[string]any) {
	doc["v"] = 1
	_ = SaveJSON(auraLibFile(), doc)
}

func auraBucket(doc map[string]any, user string) map[string]any {
	users, _ := doc["users"].(map[string]any)
	if users == nil {
		users = map[string]any{}
		doc["users"] = users
	}
	u := strings.TrimSpace(user)
	if u == "" {
		panic(errors.New("Missing user"))
	}
	b, _ := users[u].(map[string]any)
	if b == nil {
		b = map[string]any{}
		users[u] = b
	}
	for _, k := range []string{"history", "folders", "notes"} {
		if _, ok := b[k].(map[string]any); !ok {
			b[k] = map[string]any{}
		}
	}
	return b
}

func nowMS() int64 { return time.Now().UnixMilli() }

func AuraPushHistory(user, albumID, albumTitle, photoID, title string, pageIndex int64, hasPage bool, tsMS int64) error {
	aid := strings.TrimSpace(albumID)
	if aid == "" {
		return errors.New("Missing album_id")
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	h, _ := b["history"].(map[string]any)
	now := tsMS
	if now <= 0 {
		now = nowMS()
	}
	rec, _ := h[aid].(map[string]any)
	if rec == nil {
		rec = map[string]any{}
		h[aid] = rec
	}
	if albumTitle != "" {
		rec["album_title"] = albumTitle
	}
	if photoID != "" {
		rec["photo_id"] = photoID
	}
	if title != "" {
		rec["title"] = title
	}
	if hasPage {
		if pageIndex < 0 {
			pageIndex = 0
		}
		rec["page_index"] = pageIndex
	}
	rec["timestamp"] = now
	saveAuraDoc(doc)
	return nil
}

// AuraListHistory returns entries sorted by timestamp desc, limit>=1.
func AuraListHistory(user string, limit int) []map[string]any {
	if limit < 1 {
		limit = 50
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	h, _ := b["history"].(map[string]any)
	type entry struct {
		key string
		m   map[string]any
	}
	var list []entry
	for aid, v := range h {
		rec, ok := v.(map[string]any)
		if !ok {
			continue
		}
		list = append(list, entry{aid, rec})
	}
	sort.Slice(list, func(i, j int) bool {
		return numF(list[i].m["timestamp"]) > numF(list[j].m["timestamp"])
	})
	if len(list) > limit {
		list = list[:limit]
	}
	out := make([]map[string]any, 0, len(list))
	for _, e := range list {
		pi := int64(numF(e.m["page_index"]))
		if pi < 0 {
			pi = 0
		}
		out = append(out, map[string]any{
			"album_id":    e.key,
			"album_title": getStr(e.m, "album_title"),
			"photo_id":    getStr(e.m, "photo_id"),
			"title":       getStr(e.m, "title"),
			"page_index":  pi,
			"timestamp":   int64(numF(e.m["timestamp"])),
		})
	}
	return out
}

func numF(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int64:
		return float64(n)
	case int:
		return float64(n)
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	}
	return 0
}

func auraFolder(b map[string]any) map[string]any {
	f, _ := b["folders"].(map[string]any)
	if f == nil {
		f = map[string]any{}
		b["folders"] = f
	}
	return f
}

func AuraCreateFolder(user, name string) (map[string]any, error) {
	n := strings.TrimSpace(name)
	if n == "" {
		return nil, errors.New("Missing folder name")
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	folders := auraFolder(b)
	fid := "f_" + strconv.FormatInt(nowMS(), 10)
	f := map[string]any{"id": fid, "name": n, "album_ids": []any{}, "created_at": time.Now().Unix()}
	folders[fid] = f
	saveAuraDoc(doc)
	return f, nil
}

func AuraRenameFolder(user, folderID, name string) error {
	fid := strings.TrimSpace(folderID)
	n := strings.TrimSpace(name)
	if fid == "" || n == "" {
		return errors.New("Missing folder_id or name")
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	f, _ := auraFolder(b)[fid].(map[string]any)
	if f == nil {
		return errors.New("Folder not found")
	}
	f["name"] = n
	saveAuraDoc(doc)
	return nil
}

func AuraDeleteFolder(user, folderID string) error {
	fid := strings.TrimSpace(folderID)
	if fid == "" {
		return errors.New("Missing folder_id")
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	delete(auraFolder(b), fid)
	saveAuraDoc(doc)
	return nil
}

func AuraToggleFolderItem(user, folderID, albumID string, present bool) error {
	fid := strings.TrimSpace(folderID)
	aid := strings.TrimSpace(albumID)
	if fid == "" || aid == "" {
		return errors.New("Missing folder_id or album_id")
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	f, _ := auraFolder(b)[fid].(map[string]any)
	if f == nil {
		return errors.New("Folder not found")
	}
	raw, _ := f["album_ids"].([]any)
	set := map[string]bool{}
	for _, x := range raw {
		s := strings.TrimSpace(strOf(x))
		if s != "" {
			set[s] = true
		}
	}
	if present {
		set[aid] = true
	} else {
		delete(set, aid)
	}
	f["album_ids"] = sortedKeys(set)
	saveAuraDoc(doc)
	return nil
}

func auraFolderOut(fid string, f map[string]any, withIDs bool) map[string]any {
	raw, _ := f["album_ids"].([]any)
	set := map[string]bool{}
	for _, x := range raw {
		s := strings.TrimSpace(strOf(x))
		if s != "" {
			set[s] = true
		}
	}
	out := map[string]any{"id": fid, "name": getStr(f, "name")}
	if withIDs {
		out["album_ids"] = sortedKeys(set)
	}
	out["count"] = len(set)
	return out
}

func auraFoldersSorted(user string, withIDs bool) []map[string]any {
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	folders, _ := b["folders"].(map[string]any)
	out := make([]map[string]any, 0, len(folders))
	for fid, v := range folders {
		f, ok := v.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, auraFolderOut(fid, f, withIDs))
	}
	sort.Slice(out, func(i, j int) bool { return getStr(out[i], "name") < getStr(out[j], "name") })
	return out
}

func AuraListFolders(user string) []map[string]any       { return auraFoldersSorted(user, false) }
func AuraListFoldersWithIDs(user string) []map[string]any { return auraFoldersSorted(user, true) }

type NoteUpdate struct {
	Tags    []string
	HasTags bool
	Note    string
	HasNote bool
}

func AuraSetNote(user, albumID string, up NoteUpdate) error {
	aid := strings.TrimSpace(albumID)
	if aid == "" {
		return errors.New("Missing album_id")
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	notes, _ := b["notes"].(map[string]any)
	if notes == nil {
		notes = map[string]any{}
		b["notes"] = notes
	}
	rec, _ := notes[aid].(map[string]any)
	if rec == nil {
		rec = map[string]any{}
		notes[aid] = rec
	}
	if up.HasTags {
		cleaned := []string{}
		for _, t := range up.Tags {
			s := strings.TrimSpace(t)
			if s != "" && len([]rune(s)) <= 24 {
				cleaned = append(cleaned, s)
			}
		}
		uniq := []string{}
		for _, x := range cleaned {
			dup := false
			for _, y := range uniq {
				if y == x {
					dup = true
					break
				}
			}
			if !dup {
				uniq = append(uniq, x)
			}
		}
		if len(uniq) > 20 {
			uniq = uniq[:20]
		}
		rec["tags"] = uniq
	}
	if up.HasNote {
		r := []rune(up.Note)
		if len(r) > 2000 {
			r = r[:2000]
		}
		rec["note"] = string(r)
	}
	rec["updated_at"] = time.Now().Unix()
	saveAuraDoc(doc)
	return nil
}

func AuraGetNote(user, albumID string) map[string]any {
	aid := strings.TrimSpace(albumID)
	if aid == "" {
		return map[string]any{}
	}
	doc := loadAuraDoc()
	b := auraBucket(doc, user)
	notes, _ := b["notes"].(map[string]any)
	rec, _ := notes[aid].(map[string]any)
	if rec == nil {
		return map[string]any{}
	}
	return rec
}

func AuraSummary(user string) map[string]any {
	return map[string]any{"history": AuraListHistory(user, 12), "folders": AuraListFolders(user)}
}
