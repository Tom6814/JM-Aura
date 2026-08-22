import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Pagination from '@mui/material/Pagination'
import Typography from '@mui/material/Typography'
import SwipeVerticalIcon from '@mui/icons-material/SwipeVertical'
import { api } from '../api'
import { ComicGrid, CenterLoading, EmptyState, ErrorState, useAsync } from '../components'
import { rawListToSummaries } from './Home'

export default function Latest() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const state = useAsync(async () => {
    const data = await api.get<unknown>(`/api/latest${api.qs({ page })}`)
    return rawListToSummaries(data)
  }, [page])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [page])

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={2} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SwipeVerticalIcon color="primary" /> 最新上架
      </Typography>
      {state.loading ? (
        <CenterLoading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState text="暂时没有新内容" icon={<SwipeVerticalIcon />} />
      ) : (
        <>
          <ComicGrid items={state.data} />
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <Pagination
              count={50}
              page={page}
              onChange={(_, p) => setParams(p > 1 ? { page: String(p) } : {})}
              color="primary"
            />
          </Box>
        </>
      )}
    </Box>
  )
}
