package app

import (
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const chrome120UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

var (
	proxyClientVerify   = newProxyClient(true)
	proxyClientNoVerify = newProxyClient(false)
)

func newProxyClient(verify bool) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
			MaxIdleConnsPerHost:   8,
			TLSClientConfig:       &tls.Config{InsecureSkipVerify: !verify},
		},
	}
}

func streamImageResponse(w http.ResponseWriter, resp *http.Response, cacheControl string) {
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", cacheControl)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	if raw == "" {
		httpDetail(w, 400, "Missing URL")
		return
	}
	u, perr := url.Parse(raw)
	if perr != nil {
		httpDetail(w, 500, perr.Error())
		return
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		httpDetail(w, 400, "Invalid scheme")
		return
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasPrefix(host, "192.168.") {
		httpDetail(w, 403, "Access denied")
		return
	}
	ref := "https://jmcomic.me/"
	if u.Scheme != "" && u.Host != "" {
		ref = u.Scheme + "://" + u.Host + "/"
	}
	req, rerr := http.NewRequestWithContext(r.Context(), http.MethodGet, raw, nil)
	if rerr != nil {
		httpDetail(w, 500, rerr.Error())
		return
	}
	req.Header.Set("Referer", ref)
	req.Header.Set("User-Agent", chrome120UA)
	resp, ferr := proxyClientVerify.Do(req)
	if ferr != nil {
		httpDetail(w, 500, ferr.Error())
		return
	}
	defer drainClose(resp)
	if resp.StatusCode != http.StatusOK {
		httpDetail(w, resp.StatusCode, "Image fetch failed")
		return
	}
	streamImageResponse(w, resp, "public, max-age=86400")
}

func handleChapterImage(w http.ResponseWriter, r *http.Request) {
	photoID := r.PathValue("photo_id")
	imageName := r.PathValue("image_name")
	domain := r.URL.Query().Get("domain")

	candidates := []string{}
	dv := domain
	if dv != "" && !strings.Contains(dv, ":") && !strings.Contains(dv, "localhost") &&
		!strings.HasPrefix(dv, "192.168.") && !strings.HasPrefix(dv, "127.") {
		candidates = append(candidates, dv)
	}
	for _, h := range apiClient().ImageDomains() {
		if h != "" {
			candidates = append(candidates, h)
		}
	}
	if len(candidates) == 0 {
		candidates = append(candidates, "cdn-msp.jmapinodeudzn.net")
	}

	seen := map[string]bool{}
	lastStatus := 0
	for _, host := range candidates {
		if seen[host] {
			continue
		}
		seen[host] = true
		imgURL := "https://" + host + "/media/photos/" + photoID + "/" + imageName
		req, rerr := http.NewRequestWithContext(r.Context(), http.MethodGet, imgURL, nil)
		if rerr != nil {
			httpDetail(w, 500, rerr.Error())
			return
		}
		req.Header.Set("Referer", "https://"+host+"/")
		req.Header.Set("User-Agent", chrome120UA)
		resp, ferr := proxyClientNoVerify.Do(req)
		if ferr != nil {
			httpDetail(w, 500, ferr.Error())
			return
		}
		lastStatus = resp.StatusCode
		if resp.StatusCode == http.StatusOK {
			streamImageResponse(w, resp, "public, max-age=31536000")
			_ = resp.Body.Close()
			return
		}
		_ = resp.Body.Close()
	}
	if lastStatus == 0 {
		httpDetail(w, 404, "Image not found")
		return
	}
	httpDetail(w, lastStatus, "Image not found")
}
