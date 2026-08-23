# syntax=docker/dockerfile:1

# ---- Stage 1: build frontend (Vite output -> server embed dir) ----
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend-react/package.json frontend-react/package-lock.json ./frontend-react/
RUN cd frontend-react && npm ci --no-audit --no-fund
COPY frontend-react/ ./frontend-react/
RUN mkdir -p /build/server/internal/app/webdist
RUN cd frontend-react && npm run build

# ---- Stage 2: build Go backend (static binary, embed fresh frontend) ----
FROM golang:1.25-alpine AS backend
WORKDIR /src
ENV CGO_ENABLED=0 GOOS=linux
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=frontend /build/server/internal/app/webdist ./internal/app/webdist
RUN go build -trimpath -ldflags="-s -w" -o /out/jmaura .

# ---- Stage 3: runtime (minimal image, ca-certs + tzdata, non-root) ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 10001 app
WORKDIR /app
COPY --from=backend /out/jmaura ./
RUN mkdir -p /data && chown -R app:app /app /data
USER app
ENV JM_AURA_HOST=0.0.0.0 \
    JM_AURA_DATA_DIR=/data
EXPOSE 8000
ENTRYPOINT ["/app/jmaura"]
