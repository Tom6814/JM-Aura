import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api'
import type { SiteMe } from './types'

interface AuthContextValue {
  user: SiteMe | null
  loading: boolean
  refresh: () => Promise<SiteMe | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => null,
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SiteMe | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<SiteMe | null> => {
    try {
      const me = await api.get<SiteMe>('/api/site/me')
      setUser(me)
      return me
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/site/logout')
    } catch {
      /* 忽略登出失败 */
    }
    setUser(null)
  }, [])

  useEffect(() => {
    void refresh()
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [refresh])

  const value = useMemo(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

export function useRequireLogin(): { user: SiteMe | null; loading: boolean } {
  const { user, loading } = useAuth()
  return { user, loading }
}
