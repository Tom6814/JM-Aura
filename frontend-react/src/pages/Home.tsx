import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CasinoIcon from '@mui/icons-material/Casino'
import SearchIcon from '@mui/icons-material/Search'
import Typography from '@mui/material/Typography'
import { api } from '../api'
import { BRAND_GRADIENT } from '../theme'
import { ComicGrid, CenterLoading, ErrorState, SectionTitle, useAsync } from '../components'
import type { ComicSummary } from '../types'

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

export default function Home() {
  const hot = useAsync(() => api.get<ComicSummary[]>('/api/v2/jm/leaderboard?sort=tf&category=0&page=1'), [])
  const fresh = useAsync(async () => {
    const data = await api.get<unknown>('/api/latest?page=1')
    return rawListToSummaries(data)
  }, [])

  return (
    <Box>
      <Card
        sx={{
          mb: 4,
          borderRadius: 3.5,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: (t) =>
              `radial-gradient(700px 300px at 15% 0%, ${t.palette.aura.primary}${t.palette.mode === 'dark' ? '38' : '4D'}, transparent 60%), radial-gradient(600px 300px at 90% 100%, ${t.palette.aura.tertiary}${t.palette.mode === 'dark' ? '24' : '33'}, transparent 55%)`,
          }}
        />
        <CardContent sx={{ position: 'relative', py: { xs: 4, md: 6 }, px: { xs: 3, md: 5 }, textAlign: 'center' }}>
          <Typography
            variant="h3"
            component="h1"
            fontWeight={500}
            gutterBottom
            sx={{
              backgroundImage: BRAND_GRADIENT,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              width: 'fit-content',
              mx: 'auto',
            }}
          >
            探索你的漫画宇宙
          </Typography>
          <Typography color="text.secondary" mb={3}>
            轻快、纯净、单二进制自托管 —— 由 Go 与 React 驱动的 JM 阅读器
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="contained" size="large" startIcon={<CasinoIcon />} component={RouterLink} to="/random">
              随机来一本
            </Button>
            <Button variant="outlined" size="large" startIcon={<SearchIcon />} component={RouterLink} to="/search">
              搜索作品
            </Button>
          </Box>
        </CardContent>
      </Card>

      <SectionTitle
        action={
          <Button size="small" component={RouterLink} to="/leaderboard">
            查看全部
          </Button>
        }
      >
        🔥 热门推荐
      </SectionTitle>
      {hot.loading ? (
        <CenterLoading />
      ) : hot.error ? (
        <ErrorState message={hot.error} onRetry={hot.reload} />
      ) : (
        <ComicGrid items={(hot.data ?? []).slice(0, 12)} />
      )}

      <SectionTitle
        action={
          <Button size="small" component={RouterLink} to="/latest">
            查看全部
          </Button>
        }
      >
        🆕 最新上架
      </SectionTitle>
      {fresh.loading ? (
        <CenterLoading />
      ) : fresh.error ? (
        <ErrorState message={fresh.error} onRetry={fresh.reload} />
      ) : (
        <ComicGrid items={(fresh.data ?? []).slice(0, 12)} />
      )}
    </Box>
  )
}
