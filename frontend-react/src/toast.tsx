import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'

type Severity = 'success' | 'info' | 'warning' | 'error'

interface ToastContextValue {
  toast: (message: string, severity?: Severity) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

interface ToastItem {
  key: number
  message: string
  severity: Severity
}

let toastSeq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const close = useCallback((key: number) => {
    const t = timers.current.get(key)
    if (t) clearTimeout(t)
    timers.current.delete(key)
    setItems((list) => list.filter((i) => i.key !== key))
  }, [])

  const toast = useCallback(
    (message: string, severity: Severity = 'success') => {
      const key = ++toastSeq
      setItems((list) => [...list.slice(-2), { key, message, severity }])
      timers.current.set(
        key,
        setTimeout(() => close(key), 3200),
      )
    },
    [close],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.map((item) => (
        <Snackbar
          key={item.key}
          open
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          onClose={() => close(item.key)}
          sx={{ zIndex: (t) => t.zIndex.snackbar }}
        >
          <Alert severity={item.severity} variant="filled" onClose={() => close(item.key)} sx={{ borderRadius: 3 }}>
            {item.message}
          </Alert>
        </Snackbar>
      ))}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
