import { useState, useEffect } from 'react'

let _port: number | null = null

export async function getBackendUrl(): Promise<string> {
  if (_port === null) {
    _port = await window.moseq.getBackendPort()
  }
  return `http://localhost:${_port}`
}

export async function getWsUrl(): Promise<string> {
  if (_port === null) {
    _port = await window.moseq.getBackendPort()
  }
  return `ws://localhost:${_port}`
}

export function useBackendUrl() {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    getBackendUrl().then(setUrl)
  }, [])

  return url
}
