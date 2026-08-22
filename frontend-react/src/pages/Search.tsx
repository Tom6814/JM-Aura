import { useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Pagination from '@mui/material/Pagination'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { api } from '../api'
import { ComicGrid, CenterLoading, EmptyState, ErrorState, useAsync } from '../components'
import type { ComicSummary } from '../types'

export default function Search() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
  const q = params.get('q') ?? ''
  const [input, setInput] = useState(q)

  const state = useAsync(
    async () => {
      if (!q.trim()) return null
      return api.get<ComicSummary[]>(`/api/v2/jm/search${api.qs({ q, page })}`)
    },
    [q, page],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setParams(input.trim() ? { q: input.trim(), page: '1' } : {})
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={2} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SearchIcon color="primary" /> 搜索
      </Typography>

      <Paper
        component="form"
        onSubmit={submit}
        sx={{ p: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', borderRadius: 999, mb: 3 }}
      >
        <InputBase
          sx={{ ml: 1, flex: 1 }}
          placeholder="输入作品名 / 作者 / ID…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <IconButton type="submit" aria-label="搜索">
          <SearchIcon />
        </IconButton>
      </Paper>

      {!q.trim() ? (
        <EmptyState text="输入关键词开始探索" icon={<SearchIcon />} />
      ) : state.loading ? (
        <CenterLoading label={`正在搜索「${q}」`} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState text={`没有找到与「${q}」相关的作品`} icon={<SearchIcon />} />
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" mb={2}>
            「{q}」共 {state.data.length} 条结果
          </Typography>
          <ComicGrid items={state.data} />
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <Pagination
              count={100}
              page={page}
              onChange={(_, p) => {
                setParams({ q, page: String(p) })
                window.scrollTo({ top: 0 })
              }}
              color="primary"
            />
          </Box>
        </>
      )}
    </Box>
  )
}
