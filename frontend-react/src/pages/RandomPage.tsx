import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CasinoIcon from '@mui/icons-material/Casino'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import { Link as RouterLink } from 'react-router-dom'
import { api } from '../api'
import type { ComicSummary } from '../types'

export default function RandomPage() {
  const [comic, setComic] = useState<ComicSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    api
      .get<ComicSummary>('/api/v2/jm/random')
      .then((d) => alive && setComic(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [tick])

  const roll = useCallback(() => setTick((t) => t + 1), [])

  return (
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <Typography variant="h5" fontWeight={800} mb={3} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <CasinoIcon color="primary" /> 随机漫游
      </Typography>

      {loading ? (
        <Typography color="text.secondary" py={6}>
          正在掷骰子…
        </Typography>
      ) : error ? (
        <>
          <Typography color="error" py={3}>
            {error}
          </Typography>
          <Button variant="contained" onClick={roll}>
            再试一次
          </Button>
        </>
      ) : comic ? (
        <Card
          sx={{
            maxWidth: 420,
            mx: 'auto',
            borderRadius: 5,
            transition: 'transform .2s ease',
            '&:hover': { transform: 'translateY(-4px)' },
          }}
        >
          {comic.cover_url && (
            <CardMedia
              component="img"
              image={api.url(
                comic.cover_url.startsWith('http')
                  ? `/api/image-proxy?url=${encodeURIComponent(comic.cover_url)}`
                  : comic.cover_url,
              )}
              alt={comic.title}
              decoding="async"
              sx={{ aspectRatio: '3/4', objectFit: 'cover' }}
            />
          )}
          <Box p={2.5}>
            <Typography variant="h6" fontWeight={700} gutterBottom noWrap>
              {comic.title || comic.comic_id}
            </Typography>
            {comic.author && (
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {comic.author}
              </Typography>
            )}
            {comic.tags.length > 0 && (
              <Stack direction="row" spacing={0.75} justifyContent="center" flexWrap="wrap" useFlexGap mt={1}>
                {comic.tags.slice(0, 6).map((t) => (
                  <Chip key={t} label={t} size="small" variant="outlined" />
                ))}
              </Stack>
            )}
            <Stack direction="row" spacing={1.5} justifyContent="center" mt={2.5}>
              <Button variant="contained" startIcon={<MenuBookIcon />} component={RouterLink} to={`/comic/${encodeURIComponent(comic.comic_id)}`}>
                查看详情
              </Button>
              <Button variant="outlined" onClick={roll}>
                再来一本
              </Button>
            </Stack>
          </Box>
        </Card>
      ) : null}
    </Box>
  )
}
