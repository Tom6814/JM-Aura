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
  /** 阅读器内解除 900px 上限，跟随容器宽度设置 */
  fullWidth?: boolean
}

type Phase = 'idle' | 'loading' | 'error' | 'done'

// Safari/WebKit 对单张 canvas 总像素的硬上限约为 16,777,216（4096×4096）。
// 超出时 canvas 会静默失效、toBlob 返回 null、toDataURL 返回 "data:,"。
const SAFARI_MAX_CANVAS_AREA = 16_777_216

export default function DscImage({ src, comicId, scrambleId, index = 0, lazyAfter, fullWidth }: DscImageProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [displaySrc, setDisplaySrc] = useState('')
  const [imgKey, setImgKey] = useState(0)
  const [visible, setVisible] = useState(false)

  const holderRef = useRef<HTMLDivElement | null>(null)
  const loadTokenRef = useRef(0)
  const retriesRef = useRef(0)
  const objectUrlRef = useRef<string | null>(null)

  const needDescramble = !isGif(src) && scrambleId !== '0'

  // 统一替换展示地址：若上一个是 object URL 则先释放，避免内存泄漏与 Safari 配额占用
  const applyDisplaySrc = useCallback((url: string, isObjectUrl: boolean) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (isObjectUrl) objectUrlRef.current = url
    setDisplaySrc(url)
  }, [])

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
    async (image: HTMLImageElement, token: number): Promise<boolean> => {
      try {
        const width = image.naturalWidth
        const height = image.naturalHeight
        if (!width || !height) return false
        const pictureName = src.substring(src.lastIndexOf('/') + 1).split('?')[0]
        const sliceCount = getSegmentationNum(comicId, scrambleId, pictureName)
        if (sliceCount <= 1 || height < sliceCount * 2) {
          // 未乱序或切片过薄：直接展示原代理图（此时原图即正确顺序）
          applyDisplaySrc(src, false)
          return true
        }

        // 等比缩小到 Safari 像素上限以内，避免 canvas 静默失效
        let drawW = width
        let drawH = height
        if (drawW * drawH > SAFARI_MAX_CANVAS_AREA) {
          const scale = Math.sqrt(SAFARI_MAX_CANVAS_AREA / (drawW * drawH))
          drawW = Math.max(1, Math.floor(width * scale))
          drawH = Math.max(1, Math.floor(height * scale))
        }
        const scaleH = drawH / height

        const canvas = document.createElement('canvas')
        canvas.width = drawW
        canvas.height = drawH
        const context = canvas.getContext('2d')
        if (!context) {
          // 极少数环境无法取得 2D 上下文：回退原图，避免空白
          applyDisplaySrc(src, false)
          return true
        }

        // 先按原图坐标构建各块 [startY, endY]，再从最后一块向前依次绘制；
        // 目标坐标按 scaleH/scaleW 同比缩放（未触发上限时 scale=1，与旧版完全一致）
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
          const dstSliceH = sliceH * scaleH
          context.drawImage(image, 0, start, width, sliceH, 0, destY, drawW, dstSliceH)
          destY += dstSliceH
        }

        // 用 toBlob + createObjectURL 取代 toDataURL：
        // 后者为同步 base64，体积膨胀约 33%，易触发 Safari 数据 URL 与内存上限
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.92),
        )
        if (loadTokenRef.current !== token) return false
        if (!blob || blob.size === 0) {
          // canvas 输出无效（仍超过隐性限制等）：回退原图而非展示空白
          applyDisplaySrc(src, false)
          return true
        }
        const objectUrl = URL.createObjectURL(blob)
        applyDisplaySrc(objectUrl, true)
        return true
      } catch {
        return false
      }
    },
    [src, comicId, scrambleId, applyDisplaySrc],
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
        applyDisplaySrc(url, false)
        setPhase('done')
        return
      }
      cutImage(image, token).then((ok) => {
        if (loadTokenRef.current !== token) return
        if (ok) {
          setPhase('done')
        } else if (retriesRef.current < 3) {
          retriesRef.current += 1
          setImgKey((k) => k + 1)
        } else {
          setPhase('error')
        }
      })
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
  }, [phase, visible, imgKey, src, needDescramble, cutImage, applyDisplaySrc])

  // 组件卸载或换页时使进行中的任务失效，并释放可能存在的 object URL
  useEffect(() => {
    return () => {
      loadTokenRef.current += 1
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  const retry = () => {
    retriesRef.current = 0
    setImgKey(0)
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
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
          sx={{ display: 'block', width: '100%', maxWidth: fullWidth ? 'none' : 900, mx: 'auto', userSelect: 'none', WebkitUserSelect: 'none' }}
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
