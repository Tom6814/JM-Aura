package store

import (
	"errors"
	"os"
	"sort"
	"strings"
)

func credentialsFile() string {
	if v := os.Getenv("JM_AURA_CREDENTIALS_PATH"); v != "" {
		return v
	}
	return "credentials.json"
}

func loadCredDoc() map[string]any {
	if doc, ok := LoadJSON(credentialsFile()); ok {
		if _, ok := doc["users"].(map[string]any); !ok {
			doc["users"] = map[string]any{}
		}
		doc["v"] = 2
		return doc
	}
	return map[string]any{"v": 2, "users": map[string]any{}}
}

func saveCredDoc(doc map[string]any) {
	doc["v"] = 2
	_ = SaveJSON(credentialsFile(), doc)
}

func credBucket(doc map[string]any, siteUser string) map[string]any {
	users, _ := doc["users"].(map[string]any)
	if users == nil {
		users = map[string]any{}
		doc["users"] = users
	}
	k := strings.TrimSpace(siteUser)
	if k == "" {
		k = "anon"
	}
	b, _ := users[k].(map[string]any)
	if b == nil {
		b = map[string]any{}
		users[k] = b
	}
	return b
}

func credAccounts(b map[string]any) (map[string]any, string) {
	acc, _ := b["accounts"].(map[string]any)
	if acc == nil {
		acc = map[string]any{}
		b["accounts"] = acc
	}
	active := strings.TrimSpace(getStr(b, "active"))
	return acc, active
}

// credHasPassword mirrors the non-Windows branch of legacy has-password checks.
func credHasPassword(rec map[string]any) bool {
	if rec == nil {
		return false
	}
	if kr, ok := rec["password_keyring"].(bool); ok && kr {
		return true
	}
	return strings.TrimSpace(getStr(rec, "password_plain")) != ""
}

type CredAccount struct {
	Username    string `json:"username"`
	Active      bool   `json:"active"`
	HasPassword bool   `json:"has_password"`
}

type CredList struct {
	Active   string        `json:"active"`
	Accounts []CredAccount `json:"accounts"`
}

func CredListAccounts(siteUser string) CredList {
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	acc, active := credAccounts(b)
	names := make([]string, 0, len(acc))
	for k := range acc {
		u := strings.TrimSpace(k)
		if u != "" {
			names = append(names, u)
		}
	}
	sort.Strings(names)
	out := make([]CredAccount, 0, len(names))
	for _, u := range names {
		rec, _ := acc[u].(map[string]any)
		out = append(out, CredAccount{Username: u, Active: u == active, HasPassword: credHasPassword(rec)})
	}
	return CredList{Active: active, Accounts: out}
}

func CredSetActive(siteUser, username string) error {
	u := strings.TrimSpace(username)
	if u == "" {
		return errors.New("Missing username")
	}
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	acc, _ := credAccounts(b)
	if _, ok := acc[u]; !ok {
		return errors.New("Account not found")
	}
	b["active"] = u
	saveCredDoc(doc)
	return nil
}

func CredRemoveAccount(siteUser, username string) error {
	u := strings.TrimSpace(username)
	if u == "" {
		return errors.New("Missing username")
	}
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	acc, active := credAccounts(b)
	delete(acc, u)
	if active == u {
		keys := make([]string, 0, len(acc))
		for k := range acc {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) > 0 {
			b["active"] = keys[0]
		} else {
			delete(b, "active")
		}
	}
	saveCredDoc(doc)
	return nil
}

// CredSet stores a JM account password in server mode (plain file, keyring off),
// mirroring the legacy JM_AURA_DISABLE_KEYRING path.
func CredSet(siteUser, jmUsername, jmPassword string) error {
	u := strings.TrimSpace(jmUsername)
	p := jmPassword
	if u == "" || p == "" {
		return errors.New("Missing username or password")
	}
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	acc, _ := credAccounts(b)
	rec, _ := acc[u].(map[string]any)
	if rec == nil {
		rec = map[string]any{}
		acc[u] = rec
	}
	rec["password_plain"] = p
	rec["password_keyring"] = false
	delete(rec, "password_dpapi_b64")
	b["active"] = u
	saveCredDoc(doc)
	return nil
}

func CredClear(siteUser string) error {
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	b["accounts"] = map[string]any{}
	delete(b, "active")
	saveCredDoc(doc)
	return nil
}

func CredActiveUsername(siteUser string) string {
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	_, active := credAccounts(b)
	return active
}

func CredHas(siteUser string) bool {
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	acc, active := credAccounts(b)
	if len(acc) == 0 {
		return false
	}
	u := active
	if u == "" {
		keys := make([]string, 0, len(acc))
		for k := range acc {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			return false
		}
		u = keys[0]
	}
	rec, _ := acc[u].(map[string]any)
	return credHasPassword(rec)
}

// CredGet returns (jm_username, password). want=="" selects active, else first sorted.
func CredGet(siteUser, want string) (string, string) {
	doc := loadCredDoc()
	b := credBucket(doc, siteUser)
	acc, active := credAccounts(b)
	u := strings.TrimSpace(want)
	if u == "" {
		u = active
	}
	if u == "" {
		keys := make([]string, 0, len(acc))
		for k := range acc {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			return "", ""
		}
		u = keys[0]
	}
	rec, _ := acc[u].(map[string]any)
	if rec == nil {
		return "", ""
	}
	return u, getStr(rec, "password_plain")
}
