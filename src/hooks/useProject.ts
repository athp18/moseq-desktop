import { useState, useCallback } from 'react'
import { PipelineState } from '../types/pipeline'
import { getBackendUrl } from './useBackend'

export function useProject() {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [state, setState] = useState<PipelineState | null>(null)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openProject = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/project/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setProjectPath(path)
      setState(data.state)
      setConfig(data.config)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!projectPath) return
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/project/scan?path=${encodeURIComponent(projectPath)}`)
      if (res.ok) setState(await res.json())
    } catch {
      // silently ignore refresh errors
    }
  }, [projectPath])

  return { projectPath, state, config, loading, error, openProject, refresh }
}
