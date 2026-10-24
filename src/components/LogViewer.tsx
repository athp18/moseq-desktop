import { useEffect, useRef } from 'react'
import styles from './LogViewer.module.css'

interface Props {
  lines: string[]
  running: boolean
}

export function LogViewer({ lines, running }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  if (lines.length === 0 && !running) return null

  return (
    <div className={styles.container}>
      <pre className={styles.log}>
        {lines.map((line, i) => (
          <span key={i} className={styles.line}>{line}{'\n'}</span>
        ))}
        {running && <span className={styles.cursor}>▌</span>}
      </pre>
      <div ref={bottomRef} />
    </div>
  )
}
