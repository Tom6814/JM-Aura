package jm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultScrambleID = 220980
	requestTimeout    = 15 * time.Second
	maxFailoverRounds = 2
)

var DefaultWebDomains = []string{
	"https://18comic-hok.vip",
	"https://18comic.vip",
	"https://jmcomic.me",
	"https://18comic-16promax.club",
	"https://18comic.tw",
	"https://18comic-doa.xyz",
}

type CallResult struct {
	Data   json.RawMessage
	Raw    []byte
	Header http.Header
}

type APIError struct {
	Code int
	Msg  string
}

func (e *APIError) Error() string { return fmt.Sprintf("jm api error %d: %s", e.Code, e.Msg) }

type Client struct {
	http *http.Client

	mu           sync.RWMutex
	apiDomains   []string
	imageDomains []string
	webDomains   []string
}

func NewClient() *Client {
	return &Client{
		http:         &http.Client{Timeout: requestTimeout},
		apiDomains:   append([]string(nil), DefaultAPIDomains...),
		imageDomains: append([]string(nil), DefaultImageDomains...),
		webDomains:   append([]string(nil), DefaultWebDomains...),
	}
}

func copyList(in []string) []string {
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func (c *Client) APIDomains() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return copyList(c.apiDomains)
}

func (c *Client) ImageDomains() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return copyList(c.imageDomains)
}

func (c *Client) WebDomains() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return copyList(c.webDomains)
}

func (c *Client) SetAPIDomains(ds []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(ds) > 0 {
		c.apiDomains = ds
	}
}

func (c *Client) SetImageDomains(ds []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(ds) > 0 {
		c.imageDomains = ds
	}
}

func (c *Client) noteOK(d string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []string{d}
	for _, x := range c.apiDomains {
		if x != d {
			out = append(out, x)
		}
	}
	c.apiDomains = out
}

func (c *Client) doRequest(ctx context.Context, method, fullURL string, form url.Values, header http.Header) (int, []byte, http.Header, error) {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, body)
	if err != nil {
		return 0, nil, nil, err
	}
	for k, vs := range header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	if form != nil && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, resp.Header, err
	}
	return resp.StatusCode, data, resp.Header, nil
}

func BuildCookieHeader(cookies map[string]string) string {
	if len(cookies) == 0 {
		return ""
	}
	parts := make([]string, 0, len(cookies))
	for k, v := range cookies {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

func CaptureSetCookies(h http.Header) map[string]string {
	out := map[string]string{}
	for _, sc := range h.Values("Set-Cookie") {
		idx := strings.IndexByte(sc, '=')
		if idx <= 0 {
			continue
		}
		name := strings.TrimSpace(sc[:idx])
		rest := sc[idx+1:]
		end := strings.IndexByte(rest, ';')
		val := rest
		if end >= 0 {
			val = rest[:end]
		}
		val = strings.TrimSpace(val)
		if name != "" && val != "" {
			out[name] = val
		}
	}
	return out
}

func looksLikeJSON(body []byte) bool {
	for _, b := range body {
		switch b {
		case ' ', '\t', '\r', '\n':
			continue
		case '{', '[':
			return true
		default:
			return false
		}
	}
	return false
}

func baseHeaders(cookies map[string]string) http.Header {
	h := http.Header{}
	h.Set("User-Agent", UserAgent)
	h.Set("Accept", "application/json")
	h.Set("Accept-Encoding", "gzip")
	if ck := BuildCookieHeader(cookies); ck != "" {
		h.Set("Cookie", ck)
	}
	return h
}

// DecodeDomainServerText decodes the TOS domain-server payload:
// strip leading non-ascii chars -> base64 -> AES-ECB(md5hex(""+DomainServerSecret)) -> {"Server":[...]}.
func DecodeDomainServerText(text string) ([]string, error) {
	cleaned := strings.TrimLeftFunc(strings.TrimSpace(text), func(r rune) bool { return r > 127 })
	raw, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		return nil, fmt.Errorf("jm: domain server b64: %w", err)
	}
	key := []byte(MD5Hex("" + DomainServerSecret))
	plain, err := DecryptAESCBPRaw(raw, key)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Server []string `json:"Server"`
	}
	if err := json.Unmarshal(plain, &parsed); err != nil {
		return nil, err
	}
	domains := make([]string, 0, len(parsed.Server))
	for _, d := range parsed.Server {
		d = strings.TrimSpace(d)
		if d != "" {
			domains = append(domains, strings.TrimPrefix(strings.TrimPrefix(d, "https://"), "http://"))
		}
	}
	return domains, nil
}

func (c *Client) refreshDomainsFromTOS(ctx context.Context) ([]string, bool) {
	for _, u := range DomainServerList {
		h := http.Header{}
		h.Set("User-Agent", UserAgent)
		status, body, _, err := c.doRequest(ctx, http.MethodGet, u, nil, h)
		if err != nil || status != http.StatusOK || len(body) == 0 {
			continue
		}
		ds, derr := DecodeDomainServerText(string(body))
		if derr != nil || len(ds) == 0 {
			continue
		}
		c.mu.Lock()
		c.apiDomains = ds
		c.mu.Unlock()
		return ds, true
	}
	return nil, false
}

func (c *Client) APICall(ctx context.Context, method, path string, query url.Values, form url.Values, cookies map[string]string) (*CallResult, error) {
	var lastErr error
	domains := c.APIDomains()
	for round := 0; round < maxFailoverRounds; round++ {
		for _, d := range domains {
			ts := strconv.FormatInt(time.Now().Unix(), 10)
			token, tokenparam := TokenAndTokenParam(ts, TokenSecret)
			h := baseHeaders(cookies)
			h.Set("token", token)
			h.Set("tokenparam", tokenparam)
			full := "https://" + d + path
			if len(query) > 0 {
				full += "?" + query.Encode()
			}
			status, body, hdr, err := c.doRequest(ctx, method, full, form, h)
			if err == nil && status >= 500 {
				err = fmt.Errorf("jm: http %d from %s", status, d)
			}
			if err != nil {
				lastErr = err
				continue
			}
			if !looksLikeJSON(body) {
				lastErr = fmt.Errorf("jm: non-json response from %s (status %d)", d, status)
				continue
			}
			var env Envelope
			if jerr := json.Unmarshal(body, &env); jerr != nil {
				lastErr = jerr
				continue
			}
			if env.Code != 200 {
				return &CallResult{Header: hdr}, &APIError{Code: env.Code, Msg: env.ErrorMsg}
			}
			payload := env.Data
			if len(payload) > 0 && payload[0] == '"' {
				var encoded string
				if jerr := json.Unmarshal(payload, &encoded); jerr == nil && encoded != "" {
					dec, derr := DecryptRespData(encoded, ts, "")
					if derr != nil {
						return &CallResult{Header: hdr}, derr
					}
					payload = dec
				}
			}
			c.noteOK(d)
			return &CallResult{Data: payload, Raw: body, Header: hdr}, nil
		}
		if round == 0 {
			if refreshed, ok := c.refreshDomainsFromTOS(ctx); ok {
				domains = refreshed
			} else {
				break
			}
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("jm: all api domains failed")
	}
	return nil, lastErr
}

func (c *Client) APIGet(ctx context.Context, path string, query url.Values, cookies map[string]string) (*CallResult, error) {
	return c.APICall(ctx, http.MethodGet, path, query, nil, cookies)
}

func (c *Client) APIPost(ctx context.Context, path string, form url.Values, cookies map[string]string) (*CallResult, error) {
	return c.APICall(ctx, http.MethodPost, path, nil, form, cookies)
}

// PostWebForm posts a form to the legacy web domains in order (used by signup).
func (c *Client) PostWebForm(ctx context.Context, path string, form url.Values, cookies map[string]string) ([]byte, error) {
	var lastErr error
	for _, base := range c.WebDomains() {
		h := http.Header{}
		h.Set("User-Agent", UserAgent)
		h.Set("Referer", base+"/")
		if ck := BuildCookieHeader(cookies); ck != "" {
			h.Set("Cookie", ck)
		}
		status, body, _, err := c.doRequest(ctx, http.MethodPost, base+path, form, h)
		if err != nil {
			lastErr = err
			continue
		}
		if status >= 400 {
			lastErr = fmt.Errorf("jm: web %s http %d", base, status)
			continue
		}
		return body, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("jm: all web domains failed")
	}
	return nil, lastErr
}

var scrambleRe = regexp.MustCompile(`var\s+scramble_id\s*=\s*(\d+)\s*;`)

// ScrambleID fetches /chapter_view_template for a chapter's scramble id.
// Falls back to DefaultScrambleID when unavailable.
func (c *Client) ScrambleID(ctx context.Context, chapterID string, cookies map[string]string) (int64, error) {
	q := url.Values{}
	q.Set("id", chapterID)
	q.Set("mode", "vertical")
	q.Set("page", "0")
	q.Set("app_img_shunt", "NaN")
	q.Set("express", "off")
	for _, d := range c.APIDomains() {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		token, tokenparam := TokenAndTokenParam(ts, ContentTokenSecret)
		h := baseHeaders(cookies)
		h.Set("token", token)
		h.Set("tokenparam", tokenparam)
		full := "https://" + d + "/chapter_view_template?" + q.Encode() + "&v=" + ts
		status, body, hdr, err := c.doRequest(ctx, http.MethodGet, full, nil, h)
		_ = hdr
		if err != nil || status != http.StatusOK {
			continue
		}
		if m := scrambleRe.FindSubmatch(body); m != nil {
			id, cerr := strconv.ParseInt(string(m[1]), 10, 64)
			if cerr == nil {
				return id, nil
			}
		}
	}
	return DefaultScrambleID, nil
}

// Latest fetches /latest?page= (GetLatestInfoReq2).
func (c *Client) Latest(ctx context.Context, page int, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	return c.APIGet(ctx, "/latest", q, cookies)
}

// ChapterViewTemplate fetches the raw /chapter_view_template HTML
// (GetBookEpsScrambleReq2), used by the chapter-detail fallback path.
func (c *Client) ChapterViewTemplate(ctx context.Context, chapterID string, cookies map[string]string) ([]byte, error) {
	q := url.Values{}
	q.Set("id", chapterID)
	q.Set("mode", "vertical")
	q.Set("page", "0")
	q.Set("app_img_shunt", "NaN")
	q.Set("express", "off")
	var lastErr error
	for _, d := range c.APIDomains() {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		token, tokenparam := TokenAndTokenParam(ts, ContentTokenSecret)
		h := baseHeaders(cookies)
		h.Set("token", token)
		h.Set("tokenparam", tokenparam)
		full := "https://" + d + "/chapter_view_template?" + q.Encode() + "&v=" + ts
		status, body, _, err := c.doRequest(ctx, http.MethodGet, full, nil, h)
		if err != nil || status != http.StatusOK {
			lastErr = fmt.Errorf("jm: chapter_view_template from %s failed", d)
			continue
		}
		return body, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("jm: all api domains failed")
	}
	return nil, lastErr
}

// ImageURL builds a photo image URL. v=ts is required or the CDN returns empty.
func ImageURL(domain, photoID, filename string, ts int64) string {
	if ts <= 0 {
		ts = time.Now().Unix()
	}
	return fmt.Sprintf("https://%s/media/photos/%s/%s?v=%d", domain, photoID, filename, ts)
}
