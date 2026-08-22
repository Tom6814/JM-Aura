import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import CasinoIcon from '@mui/icons-material/Casino'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SearchIcon from '@mui/icons-material/Search'
import Typography from '@mui/material/Typography'
import { api } from '../api'
import { BRAND_GRADIENT, HEADING_FONT } from '../theme'
import { CenterLoading, ComicCard, ErrorState, SectionTitle, useAsync } from '../components'
import type { ComicSummary } from '../types'
import { useAuth } from '../auth'

const PROMOTE_CACHE_KEY = 'jm.promote.v1'
const PROMOTE_TTL = 10 * 60 * 1000

/** legacy /api/latest 等原始 JM 列表 → v2ComicSummary 的宽松映射 */
export function rawListToSummaries(data: unknown): ComicSummary[] {
  const list = Array.isArray(data) ? data : []
  const out: ComicSummary[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const id = it.id ?? it.album_id ?? it.aid
    if (id === undefined || id === null || String(id) === '') continue
    const authorRaw = it.author
    out.push({
      source: 'jm',
      comic_id: String(id),
      title: String(it.name ?? it.title ?? ''),
      author: Array.isArray(authorRaw)
        ? authorRaw.map(String).join(', ')
        : authorRaw
          ? String(authorRaw)
          : null,
      cover_url: it.image ? String(it.image) : null,
      tags: [],
    })
  }
  return out
}

/** 官方首页推荐链路（/api/promote）的分区形状 */
interface PromoteSection {
  id?: number | string
  title?: string
  slug?: string
  content?: unknown[]
}

function normalizeSections(data: unknown): PromoteSection[] {
  if (Array.isArray(data)) return data.filter((s) => s && typeof s === 'object') as PromoteSection[]
  if (data && typeof data === 'object') {
    return Object.values(data as Record<string, unknown>).filter(
      (s) => s && typeof s === 'object' && Array.isArray((s as PromoteSection).content),
    ) as PromoteSection[]
  }
  return []
}

async function loadPromote(): Promise<PromoteSection[]> {
  try {
    const d = await api.get<unknown>('/api/promote')
    const sections = normalizeSections(d)
    if (sections.length > 0) {
      try {
        sessionStorage.setItem(PROMOTE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: sections }))
      } catch {
        /* 隐私模式等场景写入失败可忽略 */
      }
      return sections
    }
    throw new Error('推荐数据为空')
  } catch (err) {
    try {
      const raw = sessionStorage.getItem(PROMOTE_CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as { ts: number; data: PromoteSection[] }
        if (Date.now() - cached.ts < PROMOTE_TTL && Array.isArray(cached.data)) return cached.data
      }
    } catch {
      /* 缓存损坏时走错误分支 */
    }
    throw err
  }
}

interface ResumeItem {
  album_id: string
  album_title?: string
  photo_id?: string
  title?: string
  page_index: number
}

function ContinueReading() {
  const { user } = useAuth()
  const last = useAsync<ResumeItem | null>(async () => {
    if (!user) return null
    try {
      const d = await api.get<unknown>(`/api/aura/library/history${api.qs({ limit: 1 })}`)
      const arr = Array.isArray(d) ? (d as ResumeItem[]) : []
      return arr.length > 0 ? arr[0] : null
    } catch {
      return null
    }
  }, [user?.username])

  if (!user || last.loading || last.error || !last.data) return null
  const it = last.data
  const pageQs = it.page_index > 0 ? `?page=${it.page_index}` : ''
  const target = `/reader/${encodeURIComponent(it.photo_id || it.album_id)}${pageQs}`
  return (
    <Card sx={{ mb: 3, borderRadius: 3 }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: { xs: 1.5, sm: 2 } }}>
        <Box
          sx={{
            flex: '0 0 auto',
            width: 72,
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'action.hover',
          }}
        >
          <CardMedia
            component="img"
            image={api.url(`/api/image-proxy?url=${encodeURIComponent(`https://cdn-msp.jmapiproxy2.jp/media/albums/${it.album_id}.jpg`)}`)}
            alt={it.album_title || it.album_id}
            sx={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            继续阅读
          </Typography>
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            {it.title || it.album_title || `作品 ${it.album_id}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            上次看到第 {(it.page_index ?? 0) + 1} 页
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          component={RouterLink}
          to={target}
          sx={{ flex: '0 0 auto', borderRadius: 3 }}
        >
          继续看
        </Button>
      </CardContent>
    </Card>
  )
}

/** 官方推荐分区的横向封面行：scroll-snap + 隐藏滚动条 + iOS 惯性滚动 */
function CoverRow({ items }: { items: ComicSummary[] }) {
  if (items.length === 0) return null
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        overflowX: 'auto',
        overscrollBehaviorX: 'contain',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        mx: { xs: -2, sm: -3 },
        px: { xs: 2, sm: 3 },
        pb: 1,
      }}
    >
      {items.map((c) => (
        <Box
          key={`${c.source}-${c.comic_id}`}
          sx={{ flex: '0 0 auto', width: { xs: 108, sm: 128 }, scrollSnapAlign: 'start' }}
        >
          <ComicCard comic={c} />
        </Box>
      ))}
    </Box>
  )
}

export default function Home() {
  const promote = useAsync(loadPromote, [])

  return (
    <Box>
      <ContinueReading />

      {promote.loading ? (
        <CenterLoading />
      ) : promote.error ? (
        <ErrorState message={`推荐加载失败：${promote.error}`} onRetry={promote.reload} />
      ) : (
        (promote.data ?? []).map((section, i) => {
          const items = rawListToSummaries(section.content)
          if (items.length === 0) return null
          return (
            <Box key={section.id ?? section.slug ?? i} sx={{ mb: 3.5 }}>
              <SectionTitle>{section.title || '编辑推荐'}</SectionTitle>
              <CoverRow items={items} />
            </Box>
          )
        })
      )}
    </Box>
  )
}
