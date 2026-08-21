package store

import (
	"os"
	"sort"
	"strings"
)

func jmStoreFile() string {
	if v := os.Getenv("JM_AURA_JM_STORE_PATH"); v != "" {
		return v
	}
	return "jm.json"
}

func jmIdentity(user string) string {
	u := strings.TrimSpace(user)
	if u == "" {
		return "anon"
	}
	return u
}

func loadJMDoc() map[string]any {
	if doc, ok := LoadJSON(jmStoreFile()); ok {
		if _, ok := doc["users"].(map[string]any); !ok {
			doc["users"] = map[string]any{}
		}
		return doc
	}
	return map[string]any{"v": 1, "users": map[string]any{}}
}

func jmBucket(doc map[string]any, identity string) map[string]any {
	users, _ := doc["users"].(map[string]any)
	if users == nil {
		users = map[string]any{}
		doc["users"] = users
	}
	key := jmIdentity(identity)
	b, _ := users[key].(map[string]any)
	if b == nil {
		b = map[string]any{}
		users[key] = b
	}
	return b
}

func saveJMDoc(doc map[string]any) {
	doc["v"] = 1
	_ = SaveJSON(jmStoreFile(), doc)
}

func JmGetUserID(identity string) string {
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	return getStr(b, "user_id")
}

func JmSetUserID(identity, userID string) {
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	setStr(b, "user_id", strings.TrimSpace(userID))
	saveJMDoc(doc)
}

func JmGetProfile(identity string) map[string]any {
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	p, _ := b["profile"].(map[string]any)
	return p
}

func JmSetProfile(identity string, profile map[string]any) {
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	if profile == nil {
		delete(b, "profile")
	} else {
		b["profile"] = profile
	}
	saveJMDoc(doc)
}

// JmFavoriteIDs returns the sorted favorite album id set.
func JmFavoriteIDs(identity string) []string {
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	v, _ := b["favorite_ids"].([]any)
	out := map[string]bool{}
	for _, x := range v {
		s := strings.TrimSpace(strOf(x))
		if s != "" {
			out[s] = true
		}
	}
	return sortedKeys(out)
}

func JmIsFavorite(identity, albumID string) bool {
	aid := strings.TrimSpace(albumID)
	if aid == "" {
		return false
	}
	for _, s := range JmFavoriteIDs(identity) {
		if s == aid {
			return true
		}
	}
	return false
}

func JmAddFavoriteIDs(identity string, albumIDs ...string) {
	cur := map[string]bool{}
	for _, s := range JmFavoriteIDs(identity) {
		cur[s] = true
	}
	for _, x := range albumIDs {
		s := strings.TrimSpace(x)
		if s != "" {
			cur[s] = true
		}
	}
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	b["favorite_ids"] = sortedKeys(cur)
	saveJMDoc(doc)
}

func JmSetFavoriteIDs(identity string, albumIDs []string) {
	out := map[string]bool{}
	for _, x := range albumIDs {
		s := strings.TrimSpace(x)
		if s != "" {
			out[s] = true
		}
	}
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	b["favorite_ids"] = sortedKeys(out)
	saveJMDoc(doc)
}

func JmSetFavorite(identity, albumID string, present bool) {
	aid := strings.TrimSpace(albumID)
	if aid == "" {
		return
	}
	cur := map[string]bool{}
	for _, s := range JmFavoriteIDs(identity) {
		cur[s] = true
	}
	if present {
		cur[aid] = true
	} else {
		delete(cur, aid)
	}
	doc := loadJMDoc()
	b := jmBucket(doc, identity)
	b["favorite_ids"] = sortedKeys(cur)
	saveJMDoc(doc)
}

func JmClearUserData(identity string) {
	doc := loadJMDoc()
	users, _ := doc["users"].(map[string]any)
	if users == nil {
		return
	}
	key := jmIdentity(identity)
	if _, ok := users[key]; ok {
		delete(users, key)
		saveJMDoc(doc)
	}
}

func strOf(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
