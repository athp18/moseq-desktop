import { useState, useEffect } from 'react'
import { useStepRunner } from '../../hooks/useStepRunner'
import { useProject } from '../../hooks/useProject'
import { LogViewer } from '../LogViewer'
import { ROIEditor } from '../ROIEditor'
import { StepPanelProps } from '../../App'
import { getBackendUrl } from '../../hooks/useBackend'
import styles from './StepPanel.module.css'
import sessionStyles from './ExtractPanel.module.css'

interface SessionMeta {
  name: string
  path: string
  has_depth: boolean
  extracted: boolean
  extraction_path: string | null
  metadata: Record<string, unknown>
}

interface ROISession {
  name: string
  path: string
}

export function ExtractPanel({ projectPath, config, onComplete }: StepPanelProps) {
  const { running, logs, error, run, cancel } = useStepRunner(onComplete)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [roiSession, setRoiSession] = useState<ROISession | null>(null)
  const [sessionConfigs, setSessionConfigs] = useState<Record<string, Record<string, unknown>>>({})

  useEffect(() => {
    loadSessions()
    loadSessionConfigs()
  }, [projectPath])

  async function loadSessions() {
    const url = await getBackendUrl()
    const res = await fetch(`${url}/project/sessions?path=${encodeURIComponent(projectPath)}`)
    if (res.ok) setSessions(await res.json())
  }

  async function loadSessionConfigs() {
    const url = await getBackendUrl()
    const res = await fetch(`${url}/roi/session_config?base_dir=${encodeURIComponent(projectPath)}`)
    if (res.ok) setSessionConfigs(await res.json())
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Extract</h2>
      <p className={styles.description}>
        Process raw depth recordings into extracted frames and scalar kinematics.
        Configure the arena ROI for each session before running.
      </p>

      {/* Session table */}
      {sessions.length > 0 && (
        <div className={sessionStyles.sessionTable}>
          <div className={sessionStyles.tableHeader}>
            <span>Session</span>
            <span>Status</span>
            <span>ROI</span>
            <span></span>
          </div>
          {sessions.map(s => (
            <div key={s.name} className={sessionStyles.tableRow}>
              <span className={sessionStyles.sessionName}>{s.name}</span>
              <span className={sessionStyles.status}>
                {s.extracted
                  ? <span className={sessionStyles.done}>Extracted</span>
                  : s.has_depth
                    ? <span className={sessionStyles.pending}>Pending</span>
                    : <span className={sessionStyles.missing}>No depth file</span>
                }
              </span>
              <span className={sessionStyles.roiStatus}>
                {sessionConfigs[s.name]
                  ? <span className={sessionStyles.configured}>Configured</span>
                  : <span className={sessionStyles.unconfigured}>Default</span>
                }
              </span>
              <button
                className={sessionStyles.roiBtn}
                onClick={() => setRoiSession({ name: s.name, path: s.path })}
                disabled={!s.has_depth}
              >
                Configure ROI
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        {!running ? (
          <button
            className={styles.runButton}
            onClick={() => run('extract', projectPath, config)}
          >
            Run Extraction
          </button>
        ) : (
          <button className={styles.cancelButton} onClick={() => cancel('extract')}>
            Cancel
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
      <LogViewer lines={logs} running={running} />

      {roiSession && (
        <ROIEditor
          sessionName={roiSession.name}
          sessionPath={roiSession.path}
          baseDir={projectPath}
          initialConfig={sessionConfigs[roiSession.name] as any}
          onSave={(cfg) => {
            setSessionConfigs(prev => ({ ...prev, [roiSession.name]: cfg }))
            setRoiSession(null)
          }}
          onClose={() => setRoiSession(null)}
        />
      )}
    </div>
  )
}
