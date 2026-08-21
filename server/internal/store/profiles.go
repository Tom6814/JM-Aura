package store

import (
	"os"
	"strings"
	"time"
)

func profilesFile() string {
	if v := os.Getenv("JM_AURA_SITE_PROFILE_PATH"); v != "" {
		return v
	}
	return "site_profiles.json"
}

func loadProfileDoc() map[string]any {
	if doc, ok := LoadJSON(profilesFile()); ok {
		if _, ok := doc["users"].(map[string]any); !ok {
			doc["users"] = map[string]any{}
		}
		return doc
	}
	return map[string]any{"v": 1, "users": map[string]any{}}
}

// ProfileGet returns the stored profile map (never nil).
func ProfileGet(username string) map[string]any {
	u := strings.TrimSpace(username)
	if u == "" {
		return map[string]any{}
	}
	doc := loadProfileDoc()
	users, _ := doc["users"].(map[string]any)
	v, _ := users[u].(map[string]any)
	if v == nil {
		return map[string]any{}
	}
	return v
}

// ProfilePatch applies the legacy whitelist: theme.dark/color and
// features.savePassword/autoLogin/autoCheckin, then stamps updated_at.
func ProfilePatch(username string, patch map[string]any) (map[string]any, error) {
	u := strings.TrimSpace(username)
	if u == "" {
		return map[string]any{}, nil
	}
	doc := loadProfileDoc()
	users, _ := doc["users"].(map[string]any)
	if users == nil {
		users = map[string]any{}
		doc["users"] = users
	}
	cur, _ := users[u].(map[string]any)
	if cur == nil {
		cur = map[string]any{}
		users[u] = cur
	}

	if t, ok := patch["theme"].(map[string]any); ok {
		out := map[string]any{}
		if d, ok2 := t["dark"].(bool); ok2 {
			out["dark"] = d
		}
		c := strings.ToLower(strings.TrimSpace(getStr(t, "color")))
		switch c {
		case "default", "orange", "green", "yuuka":
			out["color"] = c
		}
		prev, _ := cur["theme"].(map[string]any)
		if prev == nil {
			prev = map[string]any{}
		}
		for k, v := range out {
			prev[k] = v
		}
		cur["theme"] = prev
	}

	if f, ok := patch["features"].(map[string]any); ok {
		out := map[string]any{}
		for _, k := range []string{"savePassword", "autoLogin", "autoCheckin"} {
			if b, ok2 := f[k].(bool); ok2 {
				out[k] = b
			}
		}
		prev, _ := cur["features"].(map[string]any)
		if prev == nil {
			prev = map[string]any{}
		}
		for k, v := range out {
			prev[k] = v
		}
		cur["features"] = prev
	}

	cur["updated_at"] = time.Now().Unix()
	doc["v"] = 1
	if err := SaveJSON(profilesFile(), doc); err != nil {
		return nil, err
	}
	return cur, nil
}
