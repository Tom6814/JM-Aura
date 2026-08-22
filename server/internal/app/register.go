package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const jmWebBaseURL = "https://18-comicblade.art"

var (
	regSessionsMu sync.Mutex
	regSessions   = map[string]*http.Client{}
	reTitleTag    = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

func getJmRegisterSession(key string) *http.Client {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "anon"
	}
	regSessionsMu.Lock()
	defer regSessionsMu.Unlock()
	if c, ok := regSessions[key]; ok {
		return c
	}
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	regSessions[key] = c
	return c
}

func jmWebHeaders(referer string) http.Header {
	h := http.Header{}
	h.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
	h.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
	h.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Pragma", "no-cache")
	if referer != "" {
		h.Set("Referer", referer)
	}
	return h
}

func jmWebGet(client *http.Client, rawURL, referer string, timeout time.Duration) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header = jmWebHeaders(referer)
	return client.Do(req)
}

func drainClose(resp *http.Response) {
	if resp == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
}

func handleJMRegisterCaptcha(w http.ResponseWriter, r *http.Request) {
	client := getJmRegisterSession(effIdentityOf(r))
	base := strings.TrimSpace(jmWebBaseURL)
	if base == "" {
		writeJSON(w, 200, errSt(StatusError, "Missing JM web base url"))
		return
	}
	if resp, err := jmWebGet(client, base+"/login", base+"/login", 8*time.Second); err == nil {
		drainClose(resp)
	}
	resp, err := jmWebGet(client, base+"/captcha", base+"/signup", 12*time.Second)
	if err != nil {
		msg := err.Error()
		if msg == "" {
			msg = "Captcha fetch failed"
		}
		writeJSON(w, 200, errSt(StatusError, msg))
		return
	}
	defer drainClose(resp)
	if resp.StatusCode >= 400 {
		writeJSON(w, 502, map[string]any{"st": StatusError, "msg": fmt.Sprintf("验证码获取失败: HTTP %d", resp.StatusCode)})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if !strings.HasPrefix(ct, "image/") {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		runes := []rune(strings.TrimSpace(string(b)))
		if len(runes) > 200 {
			runes = runes[:200]
		}
		msg := string(runes)
		if msg == "" {
			ctShown := ct
			if ctShown == "" {
				ctShown = "unknown"
			}
			msg = fmt.Sprintf("验证码返回格式异常: %s", ctShown)
		}
		writeJSON(w, 502, map[string]any{"st": StatusError, "msg": msg})
		return
	}
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

type jmWebRegisterRequest struct {
	Username        string `json:"username"`
	Email           string `json:"email"`
	Password        string `json:"password"`
	PasswordConfirm string `json:"password_confirm"`
	Gender          string `json:"gender"`
	Verification    string `json:"verification"`
}

func handleJMRegister(w http.ResponseWriter, r *http.Request) {
	var req jmWebRegisterRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	u := strings.TrimSpace(req.Username)
	em := strings.TrimSpace(req.Email)
	pw := req.Password
	pw2 := req.PasswordConfirm
	ver := strings.TrimSpace(req.Verification)
	gender := strings.TrimSpace(req.Gender)
	if gender == "" {
		gender = "Male"
	}
	if gender != "Male" && gender != "Female" {
		gender = "Male"
	}
	if u == "" || em == "" || pw == "" || pw2 == "" {
		writeJSON(w, 200, errSt(StatusUserError, "Missing fields"))
		return
	}
	if pw != pw2 {
		writeJSON(w, 200, errSt(StatusUserError, "Password not match"))
		return
	}
	base := strings.TrimSpace(jmWebBaseURL)
	if base == "" {
		writeJSON(w, 200, errSt(StatusError, "Missing JM web base url"))
		return
	}

	form := url.Values{}
	form.Set("username", u)
	form.Set("password", pw)
	form.Set("email", em)
	form.Set("verification", ver)
	form.Set("password_confirm", pw2)
	form.Set("gender", gender)
	form.Set("age", "on")
	form.Set("terms", "on")
	form.Set("submit_signup", "")

	signupURL := base + "/signup"
	client0 := getJmRegisterSession(effIdentityOf(r))
	c := *client0
	redirected := false
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		redirected = true
		if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	hreq, herr := http.NewRequestWithContext(ctx, http.MethodPost, signupURL, strings.NewReader(form.Encode()))
	if herr != nil {
		writeJSON(w, 200, errSt(StatusError, herr.Error()))
		return
	}
	h := jmWebHeaders(signupURL)
	h.Set("Content-Type", "application/x-www-form-urlencoded")
	hreq.Header = h
	resp, derr := c.Do(hreq)
	if derr != nil {
		msg := derr.Error()
		if msg == "" {
			msg = "Register failed"
		}
		writeJSON(w, 200, errSt(StatusError, msg))
		return
	}
	defer drainClose(resp)
	var pageText strings.Builder
	_, _ = io.Copy(&pageText, io.LimitReader(resp.Body, 1<<20))
	if redirected || resp.Request.URL.String() != signupURL {
		writeJSON(w, 200, mergeOK(map[string]any{"status": "success"}, ""))
		return
	}
	title := ""
	if m := reTitleTag.FindStringSubmatch(pageText.String()); m != nil {
		title = strings.TrimSpace(m[1])
	}
	if tr := []rune(title); len(tr) > 120 {
		title = string(tr[:120])
	}
	if title == "" {
		title = "Register failed"
	}
	writeJSON(w, 200, errSt(StatusUserError, title))
}
