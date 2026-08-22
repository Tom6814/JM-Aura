// 沉浸式阅读器：对齐旧版 reader.html 的全部能力
// 真全屏 fixed 层 + 自动隐藏双栏 + 底部四键 dock + 拖拽进度条 + 选话/设置抽屉
// 渐进加载（初始/追加/回滚补偿）+ 阅读进度保存与恢复 + Safari/iOS 兼容
import * as React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import TuneIcon from '@mui/icons-material/Tune'
import { api, ApiError, UNAUTHORIZED_EVENT } from '../api'
import { useAsync } from '../components'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import DscImage from '../components/DscImage'
import { chapterImageUrl } from '../types'
import type { ChapterDetail, ComicDetail } from '../types'

interface ReaderSettings {
  width: number
  gap: number
  initial: number
  batch: number
}

const DEFAULT_SETTINGS: ReaderSettings = { width: 100, gap: 8, initial: 4, batch: 3 }
const SETTINGS_KEY = 'jm.reader.settings.v1'

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const p = JSON.parse(raw) as Partial<ReaderSettings>
    const clamp = (v: unknown, min: number, max: number, fb: number) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb
    }
    return {
      width: clamp(p.width, 20, 100, DEFAULT_SETTINGS.width),
      gap: clamp(p.gap, 0, 50, DEFAULT_SETTINGS.gap),
      initial: clamp(p.initial, 1, 12, DEFAULT_SETTINGS.initial),
      batch: clamp(p.batch, 1, 6, DEFAULT_SETTINGS.batch),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function SettingSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="body2" fontWeight={700} color="text.secondary">
          {label}
        </Typography>
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{
            px: 1.5,
            py: 0.5,
            borderRadius: 999,
            bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(144,202,249,0.12)' : 'rgba(2,136,209,0.08)'),
            color: 'primary.main',
          }}
        >
          {value}
          {unit}
        </Typography>
      </Box>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(_, v) => onChange(Array.isArray(v) ? (v[0] ?? value) : v)}
        sx={{ touchAction: 'none' }}
      />
    </Box>
  )
}

export default function Reader() {
  const { chapterId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()

  const [settings, setSettings] = useState<ReaderSettings>(loadSettings)
  const [sheet, setSheet] = useState<null | 'chapters' | 'settings'>(null)
  const [sheetTab, setSheetTab] = useState<'chapters' | 'settings'>('chapters')
  const [controls, setControls] = useState(true)
  const [favOn, setFavOn] = useState(false)
  const [favBusy, setFavBusy] = useState(false)

  const [start, setStart] = useState(0)
  const [limit, setLimit] = useState(DEFAULT_SETTINGS.initial)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTop = useRef(0)
  const touchY = useRef(0)
  const dragging = useRef(false)
  const indicator = useRef({ h: 58, top: 0 })
  const [indicatorOn, setIndicatorOn] = useState(false)
  const indicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prependRef = useRef<{ h: number; st: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageIdx = useRef(0)

  const resumePage = useMemo(() => {
    const n = Number(params.get('page') ?? 0)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }, [params])

  const state = useAsyncChapter(chapterId)
  const d = state.data
  const albumId = d?.raw?.album_id ?? ''
  const album = useAsyncAlbum(albumId)
  const chapters = album.data?.chapters ?? []
  const chIdx = chapters.findIndex((c) => c.id === chapterId)
  const prevCh = chIdx > 0 ? chapters[chIdx - 1] : null
  const nextCh = chIdx >= 0 && chIdx < chapters.length - 1 ? chapters[chIdx + 1] : null
  const names = useMemo(
    () => (d ? d.images.map((im) => im.name ?? '').filter((n) => n !== '') : []),
    [d],
  )
  const scrambleId = String(d?.raw?.scramble_id ?? '0')
  const albumTitle = album.data?.title || d?.raw?.title || ''

  const showControls = () => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), 2200)
  }
  const hideControls = () => {
    setControls(false)
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  // 切话：重置渲染窗口、回到顶部、唤起控制栏
  useEffect(() => {
    setStart(0)
    setLimit(settings.initial)
    pageIdx.current = 0
    lastTop.current = 0
    scrollRef.current?.scrollTo({ top: 0 })
    showControls()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  // 章节数据到达：按续读页计算初始窗口 + 记录历史
  useEffect(() => {
    if (!d) return
    const total = d.images.length
    const ini = settings.initial
    const s = resumePage > 1 ? Math.max(0, resumePage - 1) : 0
    const end =
      resumePage > 0
        ? Math.min(total, Math.max(resumePage + Math.max(2, ini), s + ini))
        : Math.min(total, ini)
    setStart(s)
    setLimit(total > 0 ? Math.max(s + 1, end) : ini)
    if (user && albumId) {
      void api
        .post('/api/aura/library/history', {
          album_id: albumId,
          album_title: albumTitle,
          photo_id: chapterId,
          title: d.title ?? '',
          page_index: resumePage,
          timestamp: Date.now(),
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, chapterId])

  // 续读定位：等待页面节点出现后滚动到目标页
  useEffect(() => {
    if (!d || resumePage <= 0) return
    let tries = 0
    let raf = 0
    const tick = () => {
      const root = scrollRef.current
      const node = root?.querySelector<HTMLElement>(`[data-page-index="${resumePage}"]`)
      if (root && node) {
        root.scrollTo({ top: Math.max(0, node.offsetTop - 12), behavior: 'auto' })
        return
      }
      if (++tries < 40) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [d, resumePage])

  // 设置持久化
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* 隐私模式写入失败可忽略 */
    }
  }, [settings])

  // 卸载时兜底上报最后进度
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (user && albumId) {
        void api
          .post('/api/aura/library/history', {
            album_id: albumId,
            photo_id: chapterId,
            page_index: pageIdx.current,
          })
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  const updateIndicator = (root: HTMLDivElement) => {
    const sh = root.scrollHeight
    const ch = root.clientHeight
    if (!sh || !ch || sh <= ch + 2) {
      setIndicatorOn(false)
      return
    }
    const maxTop = Math.max(1, sh - ch)
    const cur = Math.min(Math.max(0, root.scrollTop), maxTop)
    const h = Math.max(58, Math.round(ch * (ch / sh)))
    const maxThumbTop = Math.max(0, ch - h)
    indicator.current = { h, top: Math.round(maxThumbTop * (cur / maxTop)) }
    setIndicatorOn(true)
    if (!dragging.current) {
      if (indicatorTimer.current) clearTimeout(indicatorTimer.current)
      indicatorTimer.current = setTimeout(() => setIndicatorOn(false), 700)
    }
  }

  const saveProgress = (root: HTMLDivElement) => {
    if (!d) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const nodes = root.querySelectorAll<HTMLElement>('[data-page-index]')
      if (!nodes.length) return
      const threshold = root.scrollTop + root.clientHeight * 0.35
      let cur = 0
      for (const n of nodes) {
        const idx = Number(n.dataset.pageIndex ?? 0)
        if (n.offsetTop <= threshold) cur = idx
        else break
      }
      pageIdx.current = cur
      if (user && albumId) {
        void api
          .post('/api/aura/library/history', {
            album_id: albumId,
            album_title: albumTitle,
            photo_id: chapterId,
            title: d.title ?? '',
            page_index: cur,
          })
          .catch(() => {})
      }
    }, 500)
  }

  const maybeLoadMore = (root: HTMLDivElement) => {
    if (!d) return
    const total = d.images.length
    if (total <= 0) return
    const sh = root.scrollHeight
    const ch = root.clientHeight
    const st = root.scrollTop
    if (!sh || !ch) return
    const batch = Math.max(1, settings.batch)
    if (st < 800 && start > 0) {
      const nextStart = Math.max(0, start - batch)
      if (nextStart < start) {
        prependRef.current = { h: sh, st }
        setStart(nextStart)
      }
      return
    }
    const cur = Math.max(start, limit)
    if (cur >= total) return
    if (sh - (st + ch) > 1200) return
    setLimit(Math.min(total, cur + batch))
  }

  // 向前补页后保持视觉位置不跳动
  useLayoutEffect(() => {
    const p = prependRef.current
    const root = scrollRef.current
    if (p && root) {
      prependRef.current = null
      const delta = root.scrollHeight - p.h
      if (delta > 0) root.scrollTop = p.st + delta
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const root = e.currentTarget
    updateIndicator(root)
    maybeLoadMore(root)
    saveProgress(root)
    if (root.scrollTop < lastTop.current - 8) hideControls()
    lastTop.current = root.scrollTop
  }

  const setScrollFromClientY = (clientY: number) => {
    const root = scrollRef.current
    const hit = hitRef.current
    if (!root || !hit) return
    const sh = root.scrollHeight
    const ch = root.clientHeight
    if (!sh || !ch || sh <= ch + 2) return
    const rect = hit.getBoundingClientRect()
    const trackH = Math.max(1, rect.height)
    const thumbH = Math.max(58, indicator.current.h)
    const maxTop = Math.max(1, sh - ch)
    const maxThumbTop = Math.max(1, trackH - thumbH)
    let y = clientY - rect.top - thumbH / 2
    y = Math.min(Math.max(0, y), maxThumbTop)
    root.scrollTop = Math.round((y / maxThumbTop) * maxTop)
    updateIndicator(root)
  }

  const onCanvasClick = () => {
    if (sheet) {
      setSheet(null)
      return
    }
    if (controls) {
      hideControls()
      return
    }
    showControls()
  }

  const jump = (cid: string | null | undefined) => {
    if (!cid) return
    navigate(`/reader/${encodeURIComponent(cid)}`)
  }

  const toggleFav = async () => {
    if (!albumId || favBusy) return
    setFavBusy(true)
    try {
      await api.post(`/api/v2/jm/comic/${encodeURIComponent(albumId)}/favorite`)
      setFavOn((v) => !v)
      toast('收藏状态已更新')
    } catch (e) {
      if (e instanceof ApiError && e.st === 1014) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
      else toast(e instanceof ApiError ? e.message : '操作失败', 'error')
    } finally {
      setFavBusy(false)
    }
  }

  const openSheet = (tab: 'chapters' | 'settings') => {
    setSheetTab(tab)
    setSheet(tab)
    showControls()
  }

  const barsHidden = !controls
  const count = chapters.length

  return (
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      onClick={onCanvasClick}
      onTouchStart={(e) => {
        touchY.current = e.touches[0]?.clientY ?? 0
      }}
      onTouchEnd={(e) => {
        const endY = e.changedTouches[0]?.clientY ?? 0
        if (touchY.current - endY > 40) hideControls()
      }}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        bgcolor: '#000',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        WebkitTapHighlightColor: 'transparent',
        cursor: 'pointer',
      }}
    >
      {/* 顶栏（自动隐藏） */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1220,
          pointerEvents: 'none',
          paddingTop: 'env(safe-area-inset-top)',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.82), rgba(0,0,0,0.42) 60%, transparent)',
          transition: 'transform .3s ease, opacity .3s ease',
          transform: barsHidden ? 'translateY(-110%)' : 'none',
          opacity: barsHidden ? 0 : 1,
          visibility: barsHidden ? 'hidden' : 'visible',
        }}
      >
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{ pointerEvents: controls ? 'auto' : 'none', display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5 }}
        >
          <IconButton
            aria-label="退出阅读"
            onClick={() => {
              if (albumId) navigate(`/comic/${encodeURIComponent(albumId)}`)
              else navigate(-1)
            }}
            sx={{
              bgcolor: 'rgba(255,255,255,0.12)',
              color: '#fff',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              px: 2,
              py: 1,
              borderRadius: 999,
              bgcolor: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <MenuBookIcon sx={{ color: '#90caf9', fontSize: 20 }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                {d?.title || `#${chapterId}`}
              </Typography>
              <Typography noWrap sx={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, lineHeight: 1.4 }}>
                {albumId ? `ID: ${albumId}` : ''}
                {count > 0 && chIdx >= 0 ? ` · ${chIdx + 1} / ${count}` : ''}
              </Typography>
            </Box>
          </Box>
          <IconButton
            aria-label="阅读设置"
            onClick={() => openSheet('settings')}
            sx={{
              bgcolor: sheet === 'settings' ? 'primary.main' : 'rgba(255,255,255,0.12)',
              color: '#fff',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
            }}
          >
            <TuneIcon />
          </IconButton>
        </Box>
      </Box>

      {/* 底部 dock（自动隐藏）：上一话 / 选话 / 喜欢 / 下一话 */}
      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1220,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          paddingBottom: 'max(env(safe-area-inset-bottom), 14px)',
          transition: 'transform .3s ease, opacity .3s ease',
          transform: barsHidden ? 'translateY(130%)' : 'none',
          opacity: barsHidden ? 0 : 1,
          visibility: barsHidden ? 'hidden' : 'visible',
        }}
      >
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{
            pointerEvents: controls ? 'auto' : 'none',
            width: '92%',
            maxWidth: 520,
            borderRadius: '26px',
            bgcolor: 'rgba(12,12,14,0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, px: 1.5, pt: 1.5 }}>
            <DockButton icon={<NavigateBeforeIcon fontSize="small" />} label="上一话" disabled={!prevCh} onClick={() => jump(prevCh?.id)} />
            <DockButton
              icon={<MenuBookIcon fontSize="small" />}
              label="选话"
              disabled={count === 0}
              onClick={() => openSheet('chapters')}
            />
            <DockButton
              icon={favOn ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
              label="喜欢"
              disabled={!albumId || favBusy}
              active={favOn}
              onClick={() => void toggleFav()}
            />
            <DockButton icon={<NavigateNextIcon fontSize="small" />} label="下一话" disabled={!nextCh} onClick={() => jump(nextCh?.id)} trailing />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, px: 2.5, pt: 0.75, pb: 1.5 }}>
            <Typography noWrap sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, maxWidth: '60%' }}>
              {albumTitle}
            </Typography>
            {count > 0 && chIdx >= 0 && (
              <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, flexShrink: 0 }}>
                {chIdx + 1} / {count}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {/* 右侧拖拽进度条（触控热区） */}
      <Box
        sx={{
          position: 'fixed',
          right: 4,
          top: 72,
          bottom: 140,
          width: 26,
          zIndex: 1215,
          touchAction: 'none',
        }}
      >
        <Box
          ref={hitRef}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
            showControls()
            setScrollFromClientY(e.clientY)
          }}
          onPointerMove={(e) => {
            if (dragging.current) setScrollFromClientY(e.clientY)
          }}
          onPointerUp={() => {
            dragging.current = false
            if (!controls) {
              if (indicatorTimer.current) clearTimeout(indicatorTimer.current)
              indicatorTimer.current = setTimeout(() => setIndicatorOn(false), 700)
            }
          }}
          sx={{ width: '100%', height: '100%', cursor: 'ns-resize' }}
        >
          <Box
            sx={{
              position: 'absolute',
              right: 6,
              top: 0,
              bottom: 0,
              width: 4,
              borderRadius: 999,
              bgcolor: 'rgba(255,255,255,0.14)',
              opacity: indicatorOn || controls || dragging.current ? 1 : 0,
              transition: 'opacity .3s ease',
              pointerEvents: 'none',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: indicator.current.top,
                height: indicator.current.h,
                width: '100%',
                borderRadius: 999,
                bgcolor: 'rgba(255,255,255,0.5)',
              }}
            />
          </Box>
        </Box>
      </Box>

      {/* 画布区 */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 0,
          mx: 'auto',
          width: `${settings.width}%`,
          maxWidth: `${settings.width}%`,
          minHeight: '100%',
          bgcolor: '#000',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pb: '150px',
          transition: 'width .3s ease',
        }}
      >
        {state.loading ? (
          <Box sx={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <CircularProgress size={36} sx={{ color: 'rgba(255,255,255,0.85)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>正在加载章节…</Typography>
          </Box>
        ) : state.error || !d ? (
          <Box sx={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, px: 4, textAlign: 'center' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.7)' }}>{state.error ?? '章节不存在'}</Typography>
            <Button variant="contained" onClick={state.reload}>
              重试
            </Button>
            {albumId && (
              <Button component={RouterLink} to={`/comic/${encodeURIComponent(albumId)}`} sx={{ color: 'rgba(255,255,255,0.6)' }}>
                返回详情
              </Button>
            )}
          </Box>
        ) : names.length === 0 ? (
          <Box sx={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.5)' }}>本话没有可用图片</Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center', gap: `${settings.gap}px` }}>
              {names.map((name, i) =>
                i >= start && i < limit ? (
                  <Box
                    key={`${chapterId}-${name}-${i}`}
                    data-page-index={i}
                    sx={{ width: '100%', display: 'flex', justifyContent: 'center', bgcolor: '#000', lineHeight: 0, fontSize: 0 }}
                  >
                    <DscImage
                      src={chapterImageUrl(chapterId, name)}
                      comicId={chapterId}
                      scrambleId={scrambleId}
                      index={i}
                      fullWidth
                    />
                  </Box>
                ) : null,
              )}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, py: 10 }}>
              <Box sx={{ width: 80, height: 4, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.12)' }} />
              <CheckCircleIcon sx={{ fontSize: 48, color: '#66bb6a' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>已读完本话</Typography>
              {albumId && (
                <Button
                  variant="contained"
                  onClick={(e) => e.stopPropagation()}
                  component={RouterLink}
                  to={`/comic/${encodeURIComponent(albumId)}`}
                  sx={{ borderRadius: 999, px: 4, py: 1.2, fontWeight: 700 }}
                >
                  返回详情
                </Button>
              )}
            </Box>
          </>
        )}
      </Box>

      {/* 选话 / 设置 抽屉 */}
      <Drawer
        anchor="bottom"
        open={sheet !== null}
        onClose={() => setSheet(null)}
        slotProps={{
          paper: {
            sx: {
              bgcolor: 'background.paper',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '76vh',
              paddingBottom: 'max(env(safe-area-inset-bottom), 14px)',
            },
          },
        }}
      >
        <Box onClick={(e) => e.stopPropagation()} sx={{ px: 2.5, pt: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, pb: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={700} noWrap>
                {d?.title || albumTitle || 'Reader'}
              </Typography>
              {count > 0 && chIdx >= 0 && (
                <Typography variant="caption" color="text.secondary">
                  {chIdx + 1} / {count}
                </Typography>
              )}
            </Box>
            <IconButton onClick={() => setSheet(null)} aria-label="关闭" sx={{ bgcolor: 'action.hover' }}>
              ✕
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', p: 0.5, borderRadius: 999, bgcolor: 'action.hover', mb: 2 }}>
            {(['chapters', 'settings'] as const).map((t) => (
              <Box
                key={t}
                component="button"
                onClick={() => setSheetTab(t)}
                sx={{
                  flex: 1,
                  height: 38,
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 13,
                  transition: 'all .2s ease',
                  ...(sheetTab === t
                    ? { bgcolor: 'primary.main', color: 'primary.contrastText' }
                    : { bgcolor: 'transparent', color: 'text.secondary' }),
                }}
              >
                {t === 'chapters' ? '选话' : '设置'}
              </Box>
            ))}
          </Box>

          {sheetTab === 'chapters' ? (
            <Box sx={{ maxHeight: '56vh', overflowY: 'auto', pb: 2, WebkitOverflowScrolling: 'touch' }}>
              {chapters.map((c) => {
                const current = c.id === chapterId
                return (
                  <Box
                    key={c.id}
                    component="button"
                    onClick={() => {
                      setSheet(null)
                      jump(c.id)
                    }}
                    sx={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 2,
                      textAlign: 'left',
                      border: 'none',
                      cursor: 'pointer',
                      p: 1.75,
                      mb: 1,
                      borderRadius: 3,
                      bgcolor: current ? 'rgba(144,202,249,0.12)' : 'action.hover',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap sx={{ fontSize: 14 }}>
                        {c.title || `Chapter ${c.id}`}
                      </Typography>
                      {current && (
                        <Typography variant="caption" color="primary" fontWeight={700}>
                          当前阅读
                        </Typography>
                      )}
                    </Box>
                    <NavigateNextIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                  </Box>
                )
              })}
            </Box>
          ) : (
            <Box sx={{ pb: 3, display: 'flex', flexDirection: 'column', gap: 3.5 }}>
              <SettingSlider
                label="图片宽度"
                unit="%"
                min={20}
                max={100}
                step={5}
                value={settings.width}
                onChange={(v) => setSettings((s) => ({ ...s, width: v }))}
              />
              <SettingSlider
                label="页面间距"
                unit="px"
                min={0}
                max={50}
                step={5}
                value={settings.gap}
                onChange={(v) => setSettings((s) => ({ ...s, gap: v }))}
              />
              <SettingSlider
                label="初始加载"
                unit="页"
                min={1}
                max={12}
                step={1}
                value={settings.initial}
                onChange={(v) => setSettings((s) => ({ ...s, initial: v }))}
              />
              <SettingSlider
                label="追加批量"
                unit="页"
                min={1}
                max={6}
                step={1}
                value={settings.batch}
                onChange={(v) => setSettings((s) => ({ ...s, batch: v }))}
              />
            </Box>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}

function DockButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  trailing,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  trailing?: boolean
}) {
  return (
    <Box
      component="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        height: 46,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: '14px',
        bgcolor: active ? 'primary.main' : 'rgba(255,255,255,0.06)',
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        opacity: disabled ? 0.4 : 1,
        transition: 'background .2s ease, transform .1s ease',
        '&:active': { transform: 'scale(0.95)' },
        '&:hover': { bgcolor: active ? 'primary.main' : 'rgba(255,255,255,0.12)' },
      }}
    >
      {!trailing && icon}
      {label}
      {trailing && icon}
    </Box>
  )
}

// 章节数据加载（保留旧数据，切话时平滑过渡）
function useAsyncChapter(chapterId: string) {
  return useAsync<ChapterDetail>(
    () => api.get<ChapterDetail>(`/api/v2/jm/chapter/${encodeURIComponent(chapterId)}`),
    [chapterId],
  )
}

function useAsyncAlbum(albumId: string) {
  return useAsync<ComicDetail | null>(
    () => (albumId ? api.get<ComicDetail>(`/api/v2/jm/comic/${encodeURIComponent(albumId)}`) : Promise.resolve(null)),
    [albumId],
  )
}
