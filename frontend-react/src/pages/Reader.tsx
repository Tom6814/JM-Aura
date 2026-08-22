import { useEffect } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import { api } from '../api'
import { useAuth } from '../auth'
import { CenterLoading, ErrorState, useAsync } from '../components'
import DscImage from '../components/DscImage'
import { chapterImageUrl } from '../types'
import type { ChapterDetail } from '../types'

export default function Reader() {
  const { chapterId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const state = useAsync<ChapterDetail>(
    () => api.get<ChapterDetail>(`/api/v2/jm/chapter/${encodeURIComponent(chapterId)}`),
    [chapterId],
  )

  const albumId = state.data?.raw?.album_id ?? ''
  const album = useAsync(
    () =>
      albumId
        ? api.get<{ chapters: Array<{ id: string; title: string }> }>(
            `/api/v2/jm/comic/${encodeURIComponent(albumId)}`,
          )
        : Promise.resolve(null),
    [albumId],
  )

  // 尽力记录阅读历史（未登录则忽略）
  useEffect(() => {
    if (!user || !albumId) return
    void api
      .post('/api/aura/library/history', {
        album_id: albumId,
        photo_id: chapterId,
        title: state.data?.title ?? '',
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, albumId, chapterId])

  if (state.loading) return <CenterLoading label="加载章节…" />
  if (state.error || !state.data)
    return (
      <Box>
        <ErrorState message={state.error ?? '章节不存在'} onRetry={state.reload} />
        <Button component={RouterLink} to="/" sx={{ mt: 2 }}>
          返回首页
        </Button>
      </Box>
    )

  const d = state.data
  const names = d.images.map((im) => im.name ?? '').filter((n) => n !== '')
  const scrambleId = String(d.raw?.scramble_id ?? '0')

  const chapters = album.data?.chapters ?? []
  const idx = chapters.findIndex((c) => c.id === chapterId)
  const prevCh = idx > 0 ? chapters[idx - 1] : null
  const nextCh = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null
  const jump = (cid: string | undefined | null) => {
    if (cid) navigate(`/reader/${encodeURIComponent(cid)}`)
  }

  return (
    <Box sx={{ mx: 'auto', maxWidth: 1000 }}>
      {/* 悬浮工具条 */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          position: 'sticky',
          top: { xs: 60, md: 72 },
          zIndex: (t) => t.zIndex.appBar - 1,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          bgcolor: (t) =>
            t.palette.mode === 'dark' ? 'rgba(19,17,24,0.72)' : 'rgba(247,244,251,0.78)',
          borderRadius: 999,
          px: 1.5,
          py: 0.75,
          mb: 2,
        }}
      >
        <IconButton
          component={RouterLink}
          to={`/comic/${encodeURIComponent(comicIdFor(albumId))}`}
          size="small"
          aria-label="返回详情"
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {d.title || `#${chapterId}`}
        </Typography>
        <Chip label={`${names.length}P`} size="small" variant="outlined" />
        <IconButton size="small" disabled={!prevCh} onClick={() => jump(prevCh?.id)} aria-label="上一话">
          <NavigateBeforeIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" disabled={!nextCh} onClick={() => jump(nextCh?.id)} aria-label="下一话">
          <NavigateNextIcon fontSize="small" />
        </IconButton>
      </Stack>

      {names.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" py={8}>
          本话没有可用图片
        </Typography>
      ) : (
        <Stack spacing={1}>
          {names.map((name, i) => (
            <DscImage
              key={`${name}-${i}`}
              src={chapterImageUrl(chapterId, name)}
              comicId={albumId}
              scrambleId={scrambleId}
              index={i}
              lazyAfter={6}
            />
          ))}
        </Stack>
      )}

      {/* 底部章节导航 */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" py={5}>
        <Button startIcon={<NavigateBeforeIcon />} disabled={!prevCh} onClick={() => jump(prevCh?.id)}>
          上一话
        </Button>
        <Button component={RouterLink} to={`/comic/${encodeURIComponent(albumId)}`} color="inherit">
          目录
        </Button>
        <Button endIcon={<NavigateNextIcon />} disabled={!nextCh} onClick={() => jump(nextCh?.id)}>
          下一话
        </Button>
      </Stack>
    </Box>
  )
}

function comicIdFor(albumId: string): string {
  return albumId || ''
}
