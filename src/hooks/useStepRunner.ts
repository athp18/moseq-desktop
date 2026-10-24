import { useState, useCallback, useRef } from 'react'
import { getBackendUrl, getWsUrl } from './useBackend'

export function useStepRunner(onComplete?: () => void) {
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const run = useCallback(async (step: string, baseDir: string, config: Record<string, unknown> = {}) => {
    setLogs([])
    setError(null)
    setRunning(true)

    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/pipeline/${step}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_dir: baseDir, config })
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(detail)
      }

      const wsBase = await getWsUrl()
      const ws = new WebSocket(`${wsBase}/pipeline/${step}/logs`)
      wsRef.current = ws

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'log') {
          setLogs((prev) => [...prev, msg.text])
        } else if (msg.type === 'done') {
          setRunning(false)
          if (!msg.success) setError(msg.detail || 'Step failed')
          else onComplete?.()
          ws.close()
        }
      }

      ws.onerror = () => {
        setError('Lost connection to backend')
        setRunning(false)
      }
    } catch (e) {
      setError(String(e))
      setRunning(false)
    }
  }, [onComplete])

  const cancel = useCallback(async (step: string) => {
    const url = await getBackendUrl()
    await fetch(`${url}/pipeline/${step}/cancel`, { method: 'POST' })
    wsRef.current?.close()
    setRunning(false)
  }, [])

  return { running, logs, error, run, cancel }
}
