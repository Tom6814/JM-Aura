import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { api } from './api'
import type { ComicSummary } from './types'

/** 异步数据加载 Hook：自动执行、可重载、卸载安全。 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): {
  loading: boolean
  error: string | null
  data: T | null
  reload: () => void
} {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    data: T | null
  }>({ loading: true, error: null, data: null })
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    loaderRef.current().then(
      (data) => {
        if (alive) setState({ loading: false, error: null, data })
      },
      (err: unknown) => {
        if (alive)
          setState({
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            data: null,
          })
      },
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export function CenterLoading({ label }: { label?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 10 }}>
      <CircularProgress size={36} thickness={4} />
      {label && (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      severity="error"
      sx={{ borderRadius: 3 }}
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            重试
          </Button>
        )
      }
    >
      {message}
    </Alert>
  )
}

export function EmptyState({ icon, text, action }: { icon?: ReactNode; text: string; action?: ReactNode }) {
  return (
    <Box sx={{ textAlign: 'center', py: 10, px: 2 }}>
      {icon && <Box sx={{ mb: 1.5, '& .MuiSvgIcon-root': { fontSize: 52, opacity: 0.45 } }}>{icon}</Box>}
      <Typography color="text.secondary">{text}</Typography>
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1, mb: 1.5 }}>
      <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {children}
      </Typography>
      {action}
    </Box>
  )
}

export function ComicCard({ comic }: { comic: ComicSummary }) {
  return (
    <Card sx={{ height: '100%', transition: 'transform .18s ease, box-shadow .18s ease', '&:hover': { transform: 'translateY(-3px)', boxShadow: 8 } }}>
      <CardActionArea
        component={RouterLink}
        to={`/comic/${encodeURIComponent(comic.comic_id)}`}
        sx={{ display: 'block', height: '100%' }}
      >
        <Box
          sx={{
            position: 'relative',
            paddingTop: '138%',
            overflow: 'hidden',
            bgcolor: 'action.hover',
          }}
        >
          {comic.cover_url ? (
            <CardMedia
              component="img"
              image={api.url(comic.cover_url.startsWith('http') ? `/api/image-proxy?url=${encodeURIComponent(comic.cover_url)}` : comic.cover_url)}
              alt={comic.title}
              loading="lazy"
              decoding="async"
              sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 40,
                opacity: 0.3,
              }}
            >
              📖
            </Box>
          )}
        </Box>
        <Box sx={{ p: 1.25 }}>
          <Typography variant="body2" fontWeight={600} noWrap title={comic.title}>
            {comic.title || comic.comic_id}
          </Typography>
          {comic.author ? (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {comic.author}
            </Typography>
          ) : null}
        </Box>
      </CardActionArea>
    </Card>
  )
}

const GRID_COLUMNS = { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(6, 1fr)' }

export function ComicGrid({ items }: { items: ComicSummary[] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 2 }}>
      {items.map((c) => (
        <ComicCard key={`${c.source}-${c.comic_id}`} comic={c} />
      ))}
    </Box>
  )
}
