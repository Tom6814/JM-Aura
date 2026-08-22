package app

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"jmaura/internal/jm"
	"jmaura/internal/store"
)

const (
	StatusOK              = 1001
	StatusLoad            = 1002
	StatusError           = 1003
	StatusWaitLoad        = 1004
	StatusNetError        = 1005
	StatusUserError       = 1006
	StatusRegisterError   = 1007
	StatusUnKnowError     = 1008
	StatusNotFoundBook    = 1009
	StatusParseError      = 1010
	StatusNeedGoogle      = 1011
	StatusSetHeadError    = 1012
	StatusUnderReviewBook = 1013
	StatusNotLogin        = 1014
	StatusSaveError       = 1015
	StatusAddError        = 1017
	StatusPathError       = 1018
	StatusFileError       = 1019
	StatusFileFormatError = 1020
	StatusTimeOut         = 1021
	StatusConnectErr      = 1022
	StatusSSLErr          = 1023
	StatusResetErr        = 1024
	StatusProxyError      = 1025
	StatusDownloadFail    = 1026
	StatusOfflineModel    = 1027
	StatusDownloadBusy    = 1032
)

func ok(data any, msg string) map[string]any {
	return map[string]any{"st": StatusOK, "msg": msg, "data": data}
}

func errSt(st int, msg string) map[string]any {
	return map[string]any{"st": st, "msg": msg, "data": nil}
}

func errData(st int, msg string, data any) map[string]any {
	return map[string]any{"st": st, "msg": msg, "data": data}
}

func mergeOK(payload map[string]any, msg string) map[string]any {
	out := make(map[string]any, len(payload)+2)
	for k, v := range payload {
		out[k] = v
	}
	if _, has := out["st"]; !has {
		out["st"] = StatusOK
	}
	if _, has := out["msg"]; !has {
		out["msg"] = msg
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func httpDetail(w http.ResponseWriter, code int, detail any) {
	writeJSON(w, code, map[string]any{"detail": detail})
}

func decodeRawMap(b []byte) map[string]any {
	m := map[string]any{}
	if len(b) == 0 {
		return m
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return map[string]any{}
	}
	return m
}

type ctxKey string

const (
	ctxSiteUser ctxKey = "siteUser"
	ctxLoggedIn ctxKey = "loggedIn"
)

func siteUserOf(r *http.Request) (string, bool) {
	u, _ := r.Context().Value(ctxSiteUser).(string)
	logged, _ := r.Context().Value(ctxLoggedIn).(bool)
	return u, logged
}

func effIdentityOf(r *http.Request) string {
	u, loggedIn := siteUserOf(r)
	identity := strings.TrimSpace(u)
	if identity == "" {
		identity = "anon"
	}
	if loggedIn {
		if active := store.CredActiveUsername(identity); active != "" {
			identity = identity + "#jm#" + active
		}
	}
	return identity
}

func plainSiteUserOf(r *http.Request) string {
	u, loggedIn := siteUserOf(r)
	if !loggedIn {
		return ""
	}
	return strings.TrimSpace(u)
}

func middlewareAllowPath(p string) bool {
	if !strings.HasPrefix(p, "/api/") {
		return true
	}
	if strings.HasPrefix(p, "/api/client-info") {
		return true
	}
	return false
}

func shouldSecureCookie(r *http.Request) bool {
	if xf := strings.TrimSpace(strings.ToLower(r.Header.Get("X-Forwarded-Proto"))); xf != "" {
		return xf == "https"
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.URL.Scheme, "https")
}

func Wrap(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				writeJSON(w, 500, map[string]any{"st": 500, "msg": "Internal Server Error", "detail": fmt.Sprint(rec)})
			}
		}()
		bw := &bufWriter{rw: w, accepts: acceptsGzip(r)}
		defer bw.finish()
		var inner http.Handler
		if middlewareAllowPath(r.URL.Path) {
			inner = h
		} else {
			u, isAuth, newGid := store.EffectiveUser(r)
			ctx := context.WithValue(r.Context(), ctxSiteUser, u)
			ctx = context.WithValue(ctx, ctxLoggedIn, isAuth)
			r = r.WithContext(ctx)
			if newGid != "" {
				http.SetCookie(bw, &http.Cookie{
					Name:     "jm_aura_gid",
					Value:    newGid,
					Path:     "/",
					HttpOnly: true,
					SameSite: http.SameSiteLaxMode,
					Secure:   shouldSecureCookie(r),
					MaxAge:   365 * 86400,
				})
			}
			inner = h
		}
		gz := &gzipMiddleware{next: inner}
		gz.ServeHTTP(bw, r)
	})
}

const gzipMinSize = 800

func acceptsGzip(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Accept-Encoding")), "gzip")
}

type bufWriter struct {
	rw        http.ResponseWriter
	accepts   bool
	status    int
	statusSet bool
	buf       bytes.Buffer
	decided   bool
	useGzip   bool
	gzw       *gzip.Writer
	sink      io.Writer
}

func (b *bufWriter) Header() http.Header { return b.rw.Header() }

func (b *bufWriter) canGzip() bool {
	if !b.accepts {
		return false
	}
	hdr := b.rw.Header()
	if hdr.Get("Content-Encoding") != "" {
		return false
	}
	if ct := hdr.Get("Content-Type"); strings.HasPrefix(ct, "image/") {
		return false
	}
	st := b.status
	if !b.statusSet {
		st = 200
	}
	return st >= 200 && st != 204 && st != 304
}

func (b *bufWriter) decide(startGzip bool) {
	if b.decided {
		return
	}
	b.decided = true
	if startGzip && b.canGzip() {
		hdr := b.rw.Header()
		hdr.Del("Content-Length")
		hdr.Set("Content-Encoding", "gzip")
		hdr.Add("Vary", "Accept-Encoding")
		b.gzw = gzip.NewWriter(b.rw)
		b.sink = b.gzw
		b.useGzip = true
	} else {
		b.sink = b.rw
	}
	st := b.status
	if !b.statusSet {
		st = 200
	}
	b.rw.WriteHeader(st)
	if b.buf.Len() > 0 {
		_, _ = b.sink.Write(b.buf.Bytes())
		b.buf.Reset()
	}
}

func (b *bufWriter) WriteHeader(code int) {
	if b.statusSet || b.decided {
		return
	}
	b.status = code
	b.statusSet = true
	if b.buf.Len() > gzipMinSize {
		b.decide(true)
	}
}

func (b *bufWriter) Write(p []byte) (int, error) {
	if b.decided {
		return b.sink.Write(p)
	}
	b.buf.Write(p)
	if b.buf.Len() > gzipMinSize {
		b.decide(true)
	}
	return len(p), nil
}

func (b *bufWriter) Flush() {
	if !b.decided {
		b.decide(false)
	}
	if f, ok := b.sink.(http.Flusher); ok {
		f.Flush()
	}
}

func (b *bufWriter) finish() {
	if b.decided {
		if b.useGzip && b.gzw != nil {
			_ = b.gzw.Close()
		}
		return
	}
	b.decide(false)
}

type gzipMiddleware struct {
	next http.Handler
}

func (g *gzipMiddleware) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.next.ServeHTTP(w, r)
}

type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	window time.Duration
}

func newRateLimiter(window time.Duration) *rateLimiter {
	return &rateLimiter{hits: map[string][]time.Time{}, window: window}
}

func (l *rateLimiter) allow(key string, max int) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	arr := l.hits[key]
	keep := arr[:0]
	for _, t := range arr {
		if now.Sub(t) < l.window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= max {
		l.hits[key] = keep
		return false
	}
	l.hits[key] = append(keep, now)
	return true
}

func remoteAddrKey(r *http.Request) string {
	host := r.Header.Get("X-Forwarded-For")
	if host != "" {
		parts := strings.Split(host, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

var (
	registerMu      sync.Mutex
	registerClients = map[string]*http.Client{}
)

func registerSession(key string) *http.Client {
	registerMu.Lock()
	defer registerMu.Unlock()
	if c := registerClients[key]; c != nil {
		return c
	}
	jar, _ := cookiejar.New(nil)
	c := &http.Client{
		Jar: jar,
		Transport: &http.Transport{
			MaxIdleConnsPerHost: 20,
			MaxConnsPerHost:     20,
		},
		Timeout: 30 * time.Second,
	}
	registerClients[key] = c
	return c
}

type promoteEntry struct {
	exp  time.Time
	body []byte
}

var (
	promoteMu    sync.Mutex
	promoteCache = map[string]promoteEntry{}
)

func promoteGet(page string) ([]byte, bool) {
	promoteMu.Lock()
	defer promoteMu.Unlock()
	e, has := promoteCache[page]
	if !has || time.Now().After(e.exp) {
		if has {
			delete(promoteCache, page)
		}
		return nil, false
	}
	out := make([]byte, len(e.body))
	copy(out, e.body)
	return out, true
}

func promotePut(page string, body []byte) {
	cp := make([]byte, len(body))
	copy(cp, body)
	promoteMu.Lock()
	defer promoteMu.Unlock()
	promoteCache[page] = promoteEntry{exp: time.Now().Add(5 * time.Second), body: cp}
}

func is401Err(err error) bool {
	return err != nil && strings.Contains(err.Error(), "HTTP 401")
}

func liveJMSession(r *http.Request) bool {
	ck := store.LoadCookies(effIdentityOf(r))
	if len(ck) == 0 {
		return false
	}
	cli := jm.NewClient()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if _, ferr := cli.Favorite(ctx, 1, "0", "", ck); ferr != nil {
		if is401Err(ferr) {
			return false
		}
		return true
	}
	return true
}

func opYmlPath() string {
	if v := strings.TrimSpace(os.Getenv("JM_AURA_CONFIG_PATH")); v != "" {
		return v
	}
	cands := []string{
		filepath.Join("config", "op.yml"),
		filepath.Join("..", "config", "op.yml"),
		filepath.Join(store.DataDir(), "op.yml"),
	}
	for _, c := range cands {
		if st, serr := os.Stat(c); serr == nil && !st.IsDir() {
			return c
		}
	}
	return cands[0]
}

func opYmlClientBlock(path string) (lines []string, ok bool) {
	b, rerr := os.ReadFile(path)
	if rerr != nil {
		return nil, false
	}
	return strings.Split(string(b), "\n"), true
}

func opLineIndent(line string) int {
	n := 0
	for n < len(line) && line[n] == ' ' {
		n++
	}
	return n
}

func opKV(body string) (string, string, bool) {
	i := strings.Index(body, ":")
	if i < 0 {
		return "", "", false
	}
	k := strings.TrimSpace(body[:i])
	v := strings.TrimSpace(body[i+1:])
	return k, v, k != ""
}

func yamlUnquote(v string) string {
	if i := strings.Index(v, " #"); i >= 0 {
		v = strings.TrimSpace(v[:i])
	}
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			return v[1 : len(v)-1]
		}
	}
	return v
}

func parseOpYmlClient(path string) (u, pw string, hasKeys bool) {
	lines, okRead := opYmlClientBlock(path)
	if !okRead {
		return "", "", false
	}
	inClient := false
	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		indent := opLineIndent(line)
		body := strings.TrimSpace(line)
		if indent == 0 {
			inClient = body == "client:" || strings.HasPrefix(body, "client:")
			continue
		}
		if !inClient {
			continue
		}
		if k, v, isKV := opKV(body); isKV {
			switch k {
			case "username":
				u = yamlUnquote(v)
				hasKeys = true
			case "password":
				pw = yamlUnquote(v)
				hasKeys = true
			}
		}
	}
	return u, pw, hasKeys
}

func migrateOpYmlCredentials(targetSiteUser string) {
	path := opYmlPath()
	u, pw, hasKeys := parseOpYmlClient(path)
	if u != "" && pw != "" && !store.CredHas(targetSiteUser) {
		_ = store.CredSet(targetSiteUser, u, pw)
	}
	if hasKeys {
		clearOpYmlCredsAt(path)
	}
}

func clearOpYmlCredsAt(path string) {
	lines, okRead := opYmlClientBlock(path)
	if !okRead {
		return
	}
	out := make([]string, 0, len(lines))
	inClient := false
	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		indent := opLineIndent(line)
		body := strings.TrimSpace(line)
		if body == "" {
			out = append(out, line)
			continue
		}
		if indent == 0 {
			inClient = strings.HasPrefix(body, "client:")
			out = append(out, line)
			continue
		}
		if inClient {
			if k, _, isKV := opKV(body); isKV && (k == "username" || k == "password") {
				continue
			}
		}
		out = append(out, line)
	}
	_ = os.WriteFile(path, []byte(strings.Join(out, "\n")), 0o644)
}

func itoa(n int) string { return strconv.Itoa(n) }
