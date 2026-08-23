package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"jmaura/internal/app"
)

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func main() {
	host := envOr("JM_AURA_HOST", "0.0.0.0")
	port := envOr("JM_AURA_PORT", envOr("PORT", "8000"))
	addr := host + ":" + port
	log.Printf("JM-Aura server listening on http://%s", addr)
	if err := http.ListenAndServe(addr, app.Wrap(app.NewRouter())); err != nil {
		log.Fatal(err)
	}
}
