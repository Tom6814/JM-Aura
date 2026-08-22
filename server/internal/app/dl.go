package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"jmaura/internal/jm"
	"jmaura/internal/store"
)

var reUnsafeChars = regexp.MustCompile(`[<>:"/\\|?*]+`)

func dlSafeName(name string, maxLen int) string {
	s := strings.TrimSpace(name)
	if s == "" {
		return "untitled"
	}
	s = reUnsafeChars.ReplaceAllString(s, "_")
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > maxLen {
		return string(r[:maxLen])
	}
	return s
}

func dlSegmentationNum(epsID, scrambleID int, pictureName string) int {
	if epsID < scrambleID {
		return 0
	}
	if epsID < 268850 {
		return 10
	}
	sum := md5.Sum([]byte(strconv.Itoa(epsID) + pictureName))
	hexStr := hex.EncodeToString(sum[:])
	keyCode := int(hexStr[len(hexStr)-1])
	if epsID > 421926 {
		return (keyCode%8)*2 + 2
	}
	return (keyCode%10)*2 + 2
}

func dlDecodeImageBytes(imgBytes []byte, epsID, scrambleID int, pictureName string, isGIF bool) []byte {
	if isGIF {
		return imgBytes
	}
	num := dlSegmentationNum(epsID, scrambleID, pictureName)
	if num <= 1 {
		return imgBytes
	}

	ct := http.DetectContentType(imgBytes)
	var src image.Image
	isPNG := false
	switch ct {
	case "image/jpeg":
		im, err := jpeg.Decode(bytes.NewReader(imgBytes))
		if err != nil {
			return imgBytes
		}
		src = im
	case "image/png":
		im, err := png.Decode(bytes.NewReader(imgBytes))
		if err != nil {
			return imgBytes
		}
		src = im
		isPNG = true
	default:
		return imgBytes
	}

	b := src.Bounds()
	width, height := b.Dx(), b.Dy()
	des := image.NewRGBA(image.Rect(0, 0, width, height))

	rem := height % num
	copyHeight := height / num
	type blk struct{ start, end int }
	blocks := make([]blk, 0, num)
	totalH := 0
	for i := 0; i < num; i++ {
		h := copyHeight * (i + 1)
		if i == num-1 {
			h += rem
		}
		blocks = append(blocks, blk{totalH, h})
		totalH = h
	}
	destY := 0
	for i := len(blocks) - 1; i >= 0; i-- {
		start, end := blocks[i].start, blocks[i].end
		sliceH := end - start
		draw.Draw(des, image.Rect(0, destY, width, destY+sliceH), src, image.Pt(b.Min.X, b.Min.Y+start), draw.Src)
		destY += sliceH
	}

	var out bytes.Buffer
	var encErr error
	if isPNG {
		encErr = png.Encode(&out, des)
	} else {
		encErr = jpeg.Encode(&out, des, nil)
	}
	if encErr != nil {
		return imgBytes
	}
	return out.Bytes()
}

func dlCandidateHosts(domain string) []string {
	out := []string{}
	if d := strings.TrimSpace(domain); d != "" {
		d = strings.ReplaceAll(d, "https://", "")
		d = strings.ReplaceAll(d, "http://", "")
		d = strings.Trim(d, "/")
		if d != "" {
			out = append(out, d)
		}
	}
	for _, u := range apiClient().ImageDomains() {
		host := strings.TrimSpace(u)
		if host == "" {
			continue
		}
		if parsed, perr := url.Parse(host); perr == nil && parsed.Host != "" {
			host = parsed.Host
		}
		out = append(out, host)
	}
	out = append(out, "cdn-msp.jmapinodeudzn.net")
	seen := map[string]bool{}
	uniq := make([]string, 0, len(out))
	for _, h := range out {
		if seen[h] {
			continue
		}
		seen[h] = true
		uniq = append(uniq, h)
	}
	return uniq
}

func dlDownloadOneImage(ctx context.Context, photoID, imageName, domain string) ([]byte, string, error) {
	client := proxyClientNoVerify
	lastErr := fmt.Errorf("no candidate host")
	for _, host := range dlCandidateHosts(domain) {
		u := fmt.Sprintf("https://%s/media/photos/%s/%s", host, photoID, imageName)
		actx, cancel := context.WithTimeout(ctx, 25*time.Second)
		req, rerr := http.NewRequestWithContext(actx, http.MethodGet, u, nil)
		if rerr != nil {
			cancel()
			lastErr = rerr
			continue
		}
		req.Header.Set("User-Agent", chrome120UA)
		req.Header.Set("Referer", "https://"+host+"/")
		resp, derr := client.Do(req)
		if derr != nil {
			cancel()
			lastErr = derr
			continue
		}
		data, rderr := io.ReadAll(resp.Body)
		resp.Body.Close()
		cancel()
		if rderr != nil {
			lastErr = rderr
			continue
		}
		if resp.StatusCode == http.StatusOK && len(data) > 0 {
			return data, host, nil
		}
		lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil, "", fmt.Errorf("Image download failed: %s/%s (%v)", photoID, imageName, lastErr)
}

type downloadChapter struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type downloadTask struct {
	TaskID          string            `json:"task_id"`
	AlbumID         string            `json:"album_id"`
	AlbumTitle      string            `json:"album_title"`
	Chapters        []downloadChapter `json:"chapters"`
	Status          string            `json:"status"`
	Stage           string            `json:"stage"`
	Message         string            `json:"message"`
	CreatedAt       time.Time         `json:"-"`
	UpdatedAt       time.Time         `json:"-"`
	TotalImages     int               `json:"total_images"`
	DownloadedImages int              `json:"downloaded_images"`
	ZippedFiles     int               `json:"zipped_files"`
	TotalZipFiles   int               `json:"total_zip_files"`
	Percent         float64           `json:"percent"`
	ZipPath         string            `json:"-"`

	identity string
}

func (t *downloadTask) toPublic() map[string]any {
	downloadURL := ""
	if t.Status == "completed" && t.ZipPath != "" {
		downloadURL = "/api/download/tasks/" + t.TaskID + "/download"
	}
	return map[string]any{
		"task_id":           t.TaskID,
		"album_id":          t.AlbumID,
		"album_title":       t.AlbumTitle,
		"status":            t.Status,
		"stage":             t.Stage,
		"message":           t.Message,
		"total_images":      t.TotalImages,
		"downloaded_images": t.DownloadedImages,
		"total_zip_files":   t.TotalZipFiles,
		"zipped_files":      t.ZippedFiles,
		"percent":           math.Round(t.Percent*10000) / 10000,
		"download_url":      downloadURL,
	}
}

func newTaskUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

type downloadTaskManager struct {
	baseDir string
	mu      sync.Mutex
	tasks   map[string]*downloadTask
	queue   chan string
}

func newDownloadTaskManager(baseDir string) *downloadTaskManager {
	_ = os.MkdirAll(baseDir, 0o755)
	m := &downloadTaskManager{
		baseDir: baseDir,
		tasks:   make(map[string]*downloadTask),
		queue:   make(chan string, 256),
	}
	go m.run()
	return m
}

func (m *downloadTaskManager) createTask(albumID, albumTitle string, chapters []downloadChapter, identity string) *downloadTask {
	t := &downloadTask{
		TaskID:     newTaskUUID(),
		AlbumID:    albumID,
		AlbumTitle: albumTitle,
		Chapters:   chapters,
		Status:     "queued",
		Stage:      "queued",
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		identity:   identity,
	}
	m.mu.Lock()
	m.tasks[t.TaskID] = t
	m.mu.Unlock()
	m.queue <- t.TaskID
	return t
}

func (m *downloadTaskManager) publicSnapshot(id string) (map[string]any, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tasks[id]
	if !ok {
		return nil, false
	}
	return t.toPublic(), true
}

func (m *downloadTaskManager) update(id string, fn func(*downloadTask)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[id]; ok {
		fn(t)
		t.UpdatedAt = time.Now()
	}
}

func (m *downloadTaskManager) calcPercent(t *downloadTask) float64 {
	switch {
	case t.Status == "completed":
		return 1.0
	case t.Status == "failed":
		return t.Percent
	case t.Stage == "zipping":
		if t.TotalZipFiles > 0 {
			r := float64(t.ZippedFiles) / float64(t.TotalZipFiles)
			if r > 1 {
				r = 1
			}
			return 0.9 + 0.1*r
		}
		return 0.9
	case t.Stage == "downloading":
		if t.TotalImages > 0 {
			r := float64(t.DownloadedImages) / float64(t.TotalImages)
			if r > 1 {
				r = 1
			}
			return 0.9 * r
		}
		return 0.0
	}
	return 0.0
}

func (m *downloadTaskManager) recompute(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[id]; ok {
		t.Percent = m.calcPercent(t)
	}
}

func (m *downloadTaskManager) cancelQueued(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tasks[id]
	if !ok || t.Status != "queued" {
		return false
	}
	t.Status = "failed"
	t.Stage = "cancelled"
	t.Message = "Cancelled"
	t.UpdatedAt = time.Now()
	return true
}

func (m *downloadTaskManager) run() {
	for id := range m.queue {
		m.mu.Lock()
		t, ok := m.tasks[id]
		m.mu.Unlock()
		if !ok || t.Status != "queued" {
			continue
		}
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					m.update(id, func(t *downloadTask) {
						t.Status = "failed"
						t.Stage = "failed"
						t.Message = fmt.Sprintf("%v", rec)
					})
				}
				m.recompute(id)
			}()
			if err := m.execute(t); err != nil {
				m.update(id, func(t *downloadTask) {
					t.Status = "failed"
					t.Stage = "failed"
					t.Message = err.Error()
				})
			}
		}()
	}
}

type dlChapterMeta struct {
	photoID    string
	title      string
	domain     string
	scrambleID int
	names      []string
}

func dlCollectChapterMetas(chapters []downloadChapter, ck map[string]string) ([]dlChapterMeta, int, error) {
	metas := make([]dlChapterMeta, 0, len(chapters))
	total := 0
	for _, c := range chapters {
		pid := strings.TrimSpace(c.ID)
		title := strings.TrimSpace(c.Title)
		if title == "" {
			title = pid
		}
		if pid == "" {
			continue
		}
		cctx, ccancel := context.WithTimeout(context.Background(), 30*time.Second)
		info, err := fetchJmChapter(cctx, ck, pid)
		ccancel()
		if err != nil {
			return nil, 0, err
		}
		sc := atoiDefault(info.ScrambleID, int(jm.DefaultScrambleID))
		if sc <= 0 {
			sc = int(jm.DefaultScrambleID)
		}
		meta := dlChapterMeta{photoID: pid, title: title, domain: pyStr(info.DataOriginalDomain), scrambleID: sc, names: info.Names}
		metas = append(metas, meta)
		total += len(info.Names)
	}
	return metas, total, nil
}

func dlSaveChapterImages(rootOut string, meta dlChapterMeta, onImage func()) error {
	chapterFolder := filepath.Join(rootOut, dlSafeName(meta.title, 80))
	if err := os.MkdirAll(chapterFolder, 0o755); err != nil {
		return err
	}
	epsID, aerr := strconv.Atoi(strings.TrimSpace(meta.photoID))
	if aerr != nil {
		return aerr
	}
	for _, imgName := range meta.names {
		isGIF := strings.HasSuffix(strings.ToLower(imgName), ".gif")
		rawBytes, _, derr := dlDownloadOneImage(context.Background(), meta.photoID, imgName, meta.domain)
		if derr != nil {
			return derr
		}
		picName := imgName
		if i := strings.Index(imgName, "."); i > 0 {
			picName = imgName[:i]
		}
		outBytes := dlDecodeImageBytes(rawBytes, epsID, meta.scrambleID, picName, isGIF)
		outPath := filepath.Join(chapterFolder, filepath.Base(imgName))
		if werr := os.WriteFile(outPath, outBytes, 0o644); werr != nil {
			return werr
		}
		if onImage != nil {
			onImage()
		}
	}
	return nil
}

func (m *downloadTaskManager) execute(t *downloadTask) error {
	taskID := t.TaskID
	taskDir := filepath.Join(m.baseDir, taskID)
	workDir := filepath.Join(taskDir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}

	albumFolder := t.AlbumID
	if t.AlbumTitle != "" {
		albumFolder = dlSafeName(t.AlbumTitle, 80)
	}
	rootOut := filepath.Join(workDir, albumFolder)
	if err := os.MkdirAll(rootOut, 0o755); err != nil {
		return err
	}

	if len(t.Chapters) == 0 {
		return fmt.Errorf("No chapters selected")
	}

	m.update(taskID, func(t *downloadTask) {
		t.Status = "downloading"
		t.Stage = "downloading"
		t.Message = "Downloading..."
		t.DownloadedImages = 0
		t.TotalImages = 0
		t.Percent = 0.0
	})

	ck := store.LoadCookies(t.identity)
	metas, total, err := dlCollectChapterMetas(t.Chapters, ck)
	if err != nil {
		return err
	}
	if total <= 0 {
		return fmt.Errorf("No images found for selected chapters")
	}

	m.update(taskID, func(t *downloadTask) { t.TotalImages = total; t.Message = "Downloading images..." })
	m.recompute(taskID)

	downloaded := 0
	for _, meta := range metas {
		serr := dlSaveChapterImages(rootOut, meta, func() {
			downloaded++
			d := downloaded
			m.update(taskID, func(t *downloadTask) { t.DownloadedImages = d })
			m.recompute(taskID)
		})
		if serr != nil {
			return serr
		}
	}

	m.update(taskID, func(t *downloadTask) { t.Stage = "zipping"; t.Message = "Packaging..." })
	m.recompute(taskID)

	zipDir := filepath.Join(taskDir, "zips")
	if err := os.MkdirAll(zipDir, 0o755); err != nil {
		return err
	}
	zipBase := t.AlbumID
	if t.AlbumTitle != "" {
		zipBase = dlSafeName(t.AlbumTitle, 80)
	}
	zipPath := filepath.Join(zipDir, fmt.Sprintf("%s_%s.zip", zipBase, taskID[:8]))

	fileCount := 0
	werr := filepath.Walk(rootOut, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			fileCount++
		}
		return nil
	})
	if werr != nil {
		return werr
	}
	m.update(taskID, func(t *downloadTask) { t.TotalZipFiles = fileCount; t.ZippedFiles = 0 })
	m.recompute(taskID)

	zerr := zipTree(rootOut, zipPath, workDir, func(done, total int) {
		m.update(taskID, func(t *downloadTask) { t.ZippedFiles = done })
		m.recompute(taskID)
	})
	if zerr != nil {
		return zerr
	}

	_ = os.RemoveAll(workDir)

	m.update(taskID, func(t *downloadTask) {
		t.Status = "completed"
		t.Stage = "completed"
		t.Message = "Completed"
		t.ZipPath = zipPath
		t.Percent = 1.0
	})
	return nil
}

func zipTree(srcRoot, zipPath, arcBase string, progress func(done, total int)) error {
	type zfile struct{ path, rel string }
	files := []zfile{}
	werr := filepath.Walk(srcRoot, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(arcBase, p)
		if rerr != nil {
			return rerr
		}
		files = append(files, zfile{p, rel})
		return nil
	})
	if werr != nil {
		return werr
	}
	out, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(out)
	for i, f := range files {
		fh := &zip.FileHeader{Name: filepath.ToSlash(f.rel), Method: zip.Deflate}
		fw, ferr := zw.CreateHeader(fh)
		if ferr != nil {
			_ = zw.Close()
			_ = out.Close()
			return ferr
		}
		data, derr := os.ReadFile(f.path)
		if derr != nil {
			_ = zw.Close()
			_ = out.Close()
			return derr
		}
		if _, werr2 := fw.Write(data); werr2 != nil {
			_ = zw.Close()
			_ = out.Close()
			return werr2
		}
		if progress != nil {
			progress(i+1, len(files))
		}
	}
	if cerr := zw.Close(); cerr != nil {
		_ = out.Close()
		return cerr
	}
	return out.Close()
}

var (
	taskManager = newDownloadTaskManager(filepath.Join(store.DataDir(), "downloads", "tasks"))
	dlAlbumsDir = filepath.Join(store.DataDir(), "downloads")
)

type legacyDlJob struct {
	albumID    string
	chapterIDs []string
	identity   string
}

var legacyDlQueue = make(chan legacyDlJob, 256)

func init() {
	go func() {
		for job := range legacyDlQueue {
			func() {
				defer func() { _ = recover() }()
				_ = legacyDownloadAlbum(job)
			}()
		}
	}()
}

func dlChapterRefs(ad *jm.AlbumData, albumID string, chapterIDs []string) [][2]string {
	allowed := map[string]bool{}
	for _, c := range chapterIDs {
		allowed[strings.TrimSpace(c)] = true
	}
	filter := len(chapterIDs) > 0
	refs := [][2]string{}
	for _, se := range ad.Series {
		sid := strings.TrimSpace(se.ID)
		if sid == "" {
			continue
		}
		if filter && !allowed[sid] {
			continue
		}
		refs = append(refs, [2]string{sid, strings.TrimSpace(se.Name)})
	}
	if len(refs) == 0 && (!filter || allowed[albumID]) {
		refs = append(refs, [2]string{albumID, ad.Name.String()})
	}
	return refs
}

func legacyDownloadAlbum(job legacyDlJob) error {
	aid := strings.TrimSpace(job.albumID)
	if aid == "" {
		return fmt.Errorf("missing album id")
	}
	actx, acancel := context.WithTimeout(context.Background(), 30*time.Second)
	ad, _, aerr := apiClient().Album(actx, aid, store.LoadCookies(job.identity))
	acancel()
	if aerr != nil {
		return aerr
	}
	if s := ad.ID.String(); s != "" {
		aid = s
	}
	refs := dlChapterRefs(ad, aid, job.chapterIDs)
	if len(refs) == 0 {
		return fmt.Errorf("no downloadable chapters for %s", aid)
	}
	albumFolder := dlSafeName(ad.Name.String(), 80)
	if ad.Name.String() == "" || albumFolder == "untitled" {
		albumFolder = aid
	}
	rootOut := filepath.Join(dlAlbumsDir, albumFolder)
	if err := os.MkdirAll(rootOut, 0o755); err != nil {
		return err
	}
	ck := store.LoadCookies(job.identity)
	for _, ref := range refs {
		title := ref[1]
		if title == "" {
			title = ref[0]
		}
		cctx, ccancel := context.WithTimeout(context.Background(), 30*time.Second)
		info, err := fetchJmChapter(cctx, ck, ref[0])
		ccancel()
		if err != nil {
			return err
		}
		sc := atoiDefault(info.ScrambleID, int(jm.DefaultScrambleID))
		if sc <= 0 {
			sc = int(jm.DefaultScrambleID)
		}
		meta := dlChapterMeta{photoID: ref[0], title: title, domain: pyStr(info.DataOriginalDomain), scrambleID: sc, names: info.Names}
		if err := dlSaveChapterImages(rootOut, meta, nil); err != nil {
			return err
		}
	}
	zipDir := filepath.Join(dlAlbumsDir, "zips")
	if err := os.MkdirAll(zipDir, 0o755); err != nil {
		return err
	}
	zipPath := filepath.Join(zipDir, fmt.Sprintf("%s_%d.zip", albumFolder, time.Now().Unix()))
	if err := zipTree(rootOut, zipPath, dlAlbumsDir, nil); err != nil {
		return err
	}
	_ = os.RemoveAll(rootOut)
	return nil
}

func buildAlbumZip(ctx context.Context, albumID, identity string) (string, error) {
	actx, acancel := context.WithTimeout(ctx, 30*time.Second)
	ad, _, aerr := apiClient().Album(actx, albumID, store.LoadCookies(identity))
	acancel()
	if aerr != nil {
		return "", aerr
	}
	aid := ad.ID.String()
	if aid == "" {
		aid = albumID
	}
	tmpRoot, err := os.MkdirTemp("", "jmaura-zip-")
	if err != nil {
		return "", err
	}
	albumFolder := dlSafeName(ad.Name.String(), 80)
	if ad.Name.String() == "" || albumFolder == "untitled" {
		albumFolder = aid
	}
	rootOut := filepath.Join(tmpRoot, albumFolder)
	if err := os.MkdirAll(rootOut, 0o755); err != nil {
		os.RemoveAll(tmpRoot)
		return "", err
	}
	refs := dlChapterRefs(ad, aid, nil)
	if len(refs) == 0 {
		os.RemoveAll(tmpRoot)
		return "", fmt.Errorf("No images found for album %s", aid)
	}
	ck := store.LoadCookies(identity)
	for _, ref := range refs {
		title := ref[1]
		if title == "" {
			title = ref[0]
		}
		cctx, ccancel := context.WithTimeout(ctx, 30*time.Second)
		info, err := fetchJmChapter(cctx, ck, ref[0])
		ccancel()
		if err != nil {
			os.RemoveAll(tmpRoot)
			return "", err
		}
		sc := atoiDefault(info.ScrambleID, int(jm.DefaultScrambleID))
		if sc <= 0 {
			sc = int(jm.DefaultScrambleID)
		}
		meta := dlChapterMeta{photoID: ref[0], title: title, domain: pyStr(info.DataOriginalDomain), scrambleID: sc, names: info.Names}
		if err := dlSaveChapterImages(rootOut, meta, nil); err != nil {
			os.RemoveAll(tmpRoot)
			return "", err
		}
	}
	zipPath := filepath.Join(tmpRoot, fmt.Sprintf("%s_%d.zip", aid, time.Now().Unix()))
	if err := zipTree(rootOut, zipPath, rootOut, nil); err != nil {
		os.RemoveAll(tmpRoot)
		return "", err
	}
	return zipPath, nil
}

type dlLegacyRequest struct {
	AlbumID    string   `json:"album_id"`
	ChapterIDs []string `json:"chapter_ids"`
}

type dlTaskCreateRequest struct {
	AlbumID    string            `json:"album_id"`
	AlbumTitle string            `json:"album_title"`
	Chapters   []downloadChapter `json:"chapters"`
}

func handleDownloadZip(w http.ResponseWriter, r *http.Request) {
	albumID := strings.TrimSpace(r.URL.Query().Get("album_id"))
	if albumID == "" {
		httpDetail(w, http.StatusBadRequest, "Missing album_id")
		return
	}
	zipPath, err := buildAlbumZip(r.Context(), albumID, effIdentityOf(r))
	if err != nil {
		httpDetail(w, http.StatusInternalServerError, "Download failed: "+err.Error())
		return
	}
	defer os.RemoveAll(filepath.Dir(zipPath))
	f, oerr := os.Open(zipPath)
	if oerr != nil {
		httpDetail(w, http.StatusInternalServerError, "Download failed: "+oerr.Error())
		return
	}
	defer f.Close()
	fi, _ := f.Stat()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"album_%s.zip\"", albumID))
	if fi != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}

func handleDownloadAlbum(w http.ResponseWriter, r *http.Request) {
	var req dlLegacyRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	select {
	case legacyDlQueue <- legacyDlJob{albumID: strings.TrimSpace(req.AlbumID), chapterIDs: req.ChapterIDs, identity: effIdentityOf(r)}:
	default:
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("Download task for %s queued", req.AlbumID),
	})
}

func handleCreateDownloadTask(w http.ResponseWriter, r *http.Request) {
	var req dlTaskCreateRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	chapters := []downloadChapter{}
	for _, c := range req.Chapters {
		if c.ID == "" {
			continue
		}
		chapters = append(chapters, c)
	}
	if len(chapters) == 0 {
		writeJSON(w, http.StatusOK, errSt(StatusUserError, "No chapters selected"))
		return
	}
	t := taskManager.createTask(req.AlbumID, req.AlbumTitle, chapters, effIdentityOf(r))
	pub, _ := taskManager.publicSnapshot(t.TaskID)
	writeJSON(w, http.StatusOK, mergeOK(pub, ""))
}

func handleGetDownloadTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("task_id")
	pub, ok := taskManager.publicSnapshot(id)
	if !ok {
		httpDetail(w, http.StatusNotFound, "Task not found")
		return
	}
	writeJSON(w, http.StatusOK, mergeOK(pub, ""))
}

func handleDownloadTaskZip(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("task_id")
	taskManager.mu.Lock()
	t, ok := taskManager.tasks[id]
	var status, zipPath string
	if ok {
		status, zipPath = t.Status, t.ZipPath
	}
	taskManager.mu.Unlock()
	if !ok {
		httpDetail(w, http.StatusNotFound, "Task not found")
		return
	}
	if status != "completed" || zipPath == "" {
		httpDetail(w, http.StatusBadRequest, "Task not completed")
		return
	}
	f, oerr := os.Open(zipPath)
	if oerr != nil {
		httpDetail(w, http.StatusNotFound, "File not found")
		return
	}
	defer f.Close()
	fi, _ := f.Stat()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(zipPath)))
	if fi != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}

func dlCleanupCache(keepDays int) (int, int) {
	bases := []string{filepath.Join(store.DataDir(), "downloads", "tasks")}
	now := time.Now()
	if keepDays < 0 {
		keepDays = 0
	}
	removedDirs, removedWork := 0, 0
	for _, base := range bases {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			p := filepath.Join(base, e.Name())
			mtime := now
			if fi, ferr := e.Info(); ferr == nil {
				mtime = fi.ModTime()
			}
			work := filepath.Join(p, "work")
			if fi2, ferr := os.Stat(work); ferr == nil && fi2.IsDir() {
				_ = os.RemoveAll(work)
				removedWork++
			}
			if now.Sub(mtime) <= time.Duration(keepDays)*24*time.Hour {
				continue
			}
			zips := filepath.Join(p, "zips")
			if zs, zerr := os.ReadDir(zips); zerr == nil && len(zs) > 0 {
				continue
			}
			_ = os.RemoveAll(p)
			removedDirs++
		}
	}
	return removedDirs, removedWork
}
