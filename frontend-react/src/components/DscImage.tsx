import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import BrokenImageIcon from '@mui/icons-material/BrokenImage'
import { md5 } from '../md5'

// 移植自旧版 Vue DescrambledImage：JM 图片切片乱序还原。
// 算法与阈值（220980 / 268850 / 421926）必须与后端解码及上游实现完全一致。

function isGif(url: string): boolean {
  return url.toLowerCase().includes('.gif')
}

export function getSegmentationNum(
  epsId: string,
  scrambleId: string,
  pictureName: string,
): number {
  const sid = parseInt(scrambleId, 10) || 220980
  const eid = parseInt(epsId, 10)
  if (isNaN(eid)) return 0
  if (eid < sid) return 0
  if (eid < 268850) return 10
  const keyCode = md5(String(eid) + String(pictureName)).charCodeAt(32 - 1)
  if (eid > 421926) {
    return (keyCode % 8) * 2 + 2
  }
  return (keyCode % 10) * 2 + 2
}

interface DscImageProps {
  src: string
  comicId: string
  scrambleId: string
  index?: number
  /** 超过该序号的图片进入视口后才真正加载（阅读器性能门控） */
  lazyAfter?: number
}

type Phase = 'idle' | 'loading' | 'error' | 'done'

export default function DscImage({ src, comicId, scrambleId, index = 0, lazyAfter }: DscImageProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [displaySrc, setDisplaySrc] = useState('')
  const [imgKey, setImgKey] = useState(0)
  const [visible, setVisible] = useState(false)

  const holderRef = useRef<HTMLDivElement | null>(null)
  const loadTokenRef = useRef(0)
  const retriesRef = useRef(0)

  const needDescramble = !isGif(src) && scrambleId !== '0'

  // 懒加载门控：仅当 index 超出预载窗口时才等待可见性
  useEffect(() => {
    if (!lazyAfter || index < lazyAfter) {
      setVisible(true)
      return
    }
    const el = holderRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            io.disconnect()
          }
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazyAfter, index])

  const cutImage = useCallback(
    (image: HTMLImageElement, token: number): boolean => {
      try {
        const width = image.naturalWidth
        const height = image.naturalHeight
        const pictureName = src.substring(src.lastIndexOf('/') + 1).split('?')[0]
        const sliceCount = getSegmentationNum(comicId, scrambleId, pictureName)
        if (!width || !height || sliceCount <= 1 || height < sliceCount * 2) {
          setDisplaySrc(src)
          return true
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          setDisplaySrc(src)
          return true
        }

        // 与旧版一致：先构建各块的 [startY, endY]，再从最后一块向前依次绘制
        const rem = height % sliceCount
        const copyHeight = Math.floor(height / sliceCount)
        const blocks: Array<[number, number]> = []
        let totalH = 0
        for (let i = 0; i < sliceCount; i++) {
          let h = copyHeight * (i + 1)
          if (i === sliceCount - 1) {
            h += rem
          }
          blocks.push([totalH, h])
          totalH = h
        }

        let destY = 0
        for (let i = blocks.length - 1; i >= 0; i--) {
          const start = blocks[i][0]
          const end = blocks[i][1]
          const sliceH = end - start
          context.drawImage(image, 0, start, width, sliceH, 0, destY, width, sliceH)
          destY += sliceH
        }

        if (loadTokenRef.current !== token) return false
        setDisplaySrc(canvas.toDataURL('image/jpeg', 0.92))
        return true
      } catch {
        return false
      }
    },
    [src, comicId, scrambleId],
  )

  useEffect(() => {
    if (phase === 'idle' && visible) {
      setPhase('loading')
    }
  }, [phase, visible])

  useEffect(() => {
    if (phase !== 'loading') return
    const token = ++loadTokenRef.current

    const url = imgKey > 0 ? `${src}${src.includes('?') ? '&' : '?'}retry=${imgKey}` : src
    const image = new Image()
    // 仅跨域时需要 CORS 许可才能安全读取画布；同源代理无需该头
    if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
      image.crossOrigin = 'anonymous'
    }
    image.decoding = 'async'

    const cleanup = () => {
      image.onload = null
      image.onerror = null
    }

    image.onload = () => {
      cleanup()
      if (loadTokenRef.current !== token) return
      if (!needDescramble) {
        setDisplaySrc(url)
        setPhase('done')
        return
      }
      if (cutImage(image, token)) {
        setPhase('done')
      } else if (retriesRef.current < 3) {
        retriesRef.current += 1
        setImgKey((k) => k + 1)
      } else {
        setPhase('error')
      }
    }
    image.onerror = () => {
      cleanup()
      if (loadTokenRef.current !== token) return
      if (retriesRef.current < 3) {
        retriesRef.current += 1
        setImgKey((k) => k + 1)
      } else {
        setPhase('error')
      }
    }
    image.src = url
    return cleanup
  }, [phase, visible, imgKey, src, needDescramble, cutImage])

  // 组件卸载或换页时使进行中的任务失效
  useEffect(() => {
    return () => {
      loadTokenRef.current += 1
    }
  }, [])

  const retry = () => {
    retriesRef.current = 0
    setImgKey(0)
    setDisplaySrc('')
    setPhase('idle')
  }

  return (
    <Box ref={holderRef} sx={{ position: 'relative', minHeight: phase === 'done' ? undefined : '40vh' }}>
      {phase === 'done' && displaySrc ? (
        <Box
          component="img"
          src={displaySrc}
          alt=""
          decoding="async"
          sx={{ display: 'block', width: '100%', maxWidth: 900, mx: 'auto', userSelect: 'none', WebkitUserSelect: 'none' }}
        />
      ) : phase === 'error' ? (
        <Box
          onClick={retry}
          sx={{
            py: 8,
            textAlign: 'center',
            color: 'text.secondary',
            cursor: 'pointer',
            '&:hover': { color: 'primary.main' },
          }}
        >
          <BrokenImageIcon sx={{ fontSize: 42, mb: 1 }} />
          <Typography variant="body2">图片加载失败，点击重试</Typography>
        </Box>
      ) : (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <CircularProgress size={28} thickness={4} />
          {needDescramble && (
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              解码中…
            </Typography>
          )}
        </Box>
      )}
    </Box>
  )
}
