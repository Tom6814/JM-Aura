package db

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"jmaura/internal/store"
)

// DownloadRecord persists download task state snapshots so tasks survive restarts.
type DownloadRecord struct {
	TaskID      string    `gorm:"primaryKey;size:64" json:"task_id"`
	SiteUser    string    `gorm:"size:128;index" json:"site_user"`
	AlbumID     string    `gorm:"size:64;index" json:"album_id"`
	Title       string    `gorm:"size:512" json:"title"`
	Status      string    `gorm:"size:32;index" json:"status"`
	TotalImages int       `json:"total_images"`
	DoneImages  int       `json:"done_images"`
	Percent     float64   `json:"percent"`
	ZipPath     string    `gorm:"size:1024" json:"zip_path"`
	ErrorMsg    string    `gorm:"size:1024" json:"error"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

var (
	mu  sync.Mutex
	gdb *gorm.DB
)

// Open initializes the global GORM handle. DATABASE_URL selects the driver
// (mysql:// / postgres:// / sqlite); when unset a pure-Go SQLite file is used
// under the shared data dir, keeping single-binary deployment zero-config.
func Open() (*gorm.DB, error) {
	mu.Lock()
	defer mu.Unlock()
	if gdb != nil {
		return gdb, nil
	}
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	cfg := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	}
	var (
		db  *gorm.DB
		err error
	)
	switch {
	case dsn == "":
		p := store.Path(filepath.Join("jmaura.db"))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return nil, err
		}
		db, err = gorm.Open(sqlite.Open(p), cfg)
	case strings.HasPrefix(dsn, "mysql://"), strings.HasPrefix(dsn, "mariadb://"):
		db, err = gorm.Open(mysql.Open(strings.TrimPrefix(strings.TrimPrefix(dsn, "mysql://"), "mariadb://")), cfg)
	case strings.HasPrefix(dsn, "postgres://"), strings.HasPrefix(dsn, "postgresql://"):
		db, err = gorm.Open(postgres.Open(dsn), cfg)
	case strings.HasPrefix(dsn, "sqlite://"):
		db, err = gorm.Open(sqlite.Open(strings.TrimPrefix(dsn, "sqlite://")), cfg)
	default:
		return nil, errors.New("db: unsupported DATABASE_URL scheme")
	}
	if err != nil {
		return nil, err
	}
	if err := db.AutoMigrate(&DownloadRecord{}); err != nil {
		return nil, err
	}
	gdb = db
	return gdb, nil
}

// G returns the initialized handle or nil when the DB is unavailable.
func G() *gorm.DB {
	mu.Lock()
	defer mu.Unlock()
	return gdb
}
