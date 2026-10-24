import { useState, useEffect } from 'react'
import { useStepRunner } from '../../hooks/useStepRunner'
import { LogViewer } from '../LogViewer'
import { ROIEditor } from '../ROIEditor'
import { StepPanelProps } from '../../App'
import { getBackendUrl } from '../../hooks/useBackend'
import styles from './StepPanel.module.css'
import extractStyles from './ExtractPanel.module.css'

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

interface GlobalExtractionConfig {
  min_height: number
  max_height: number
  crop_size: number
  fps: number
  skip_extracted: boolean
}

export function ExtractPanel({ projectPath, config, onComplete }: StepPanelProps) {
  const { running, logs, error, run, cancel } = useStepRunner(onComplete)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [roiSession, setRoiSession] = useState<ROISession | null>(null)
  const [sessionConfigs, setSessionConfigs] = useState<Record<string, Record<string, unknown>>>({})
  const [globalCfg, setGlobalCfg] = useState<GlobalExtractionConfig>({
    min_height: Number(config.min_height) || 10,
    max_height: Number(config.max_height) || 100,
    crop_size: Number(config.crop_size) || 80,
    fps: Number(config.fps) || 30,
    skip_extracted: true,
  })

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

  function setGlobal<K extends keyof GlobalExtractionConfig>(key: K, val: GlobalExtractionConfig[K]) {
    setGlobalCfg(prev => ({ ...prev, [key]: val }))
  }

  const numExtracted = sessions.filter(s => s.extracted).length
  const numPending = sessions.filter(s => !s.extracted && s.has_depth).length
  const numMissing = sessions.filter(s => !s.has_depth).length

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Extract</h2>

      {/* Session summary */}
      {sessions.length > 0 && (
        <div className={extractStyles.summary}>
          <span className={extractStyles.summaryTotal}>{sessions.length} sessions</span>
          {numExtracted > 0 && <span className={extractStyles.summaryDone}>{numExtracted} extracted</span>}
          {numPending > 0 && <span className={extractStyles.summaryPending}>{numPending} pending</span>}
          {numMissing > 0 && <span className={extractStyles.summaryMissing}>{numMissing} no depth</span>}
        </div>
      )}

      {/* Session table */}
      {sessions.length > 0 && (
        <div className={extractStyles.sessionTable}>
          <div className={extractStyles.tableHeader}>
            <span>Session</span>
            <span>Status</span>
            <span>ROI</span>
            <span></span>
          </div>
          {sessions.map(s => (
            <div key={s.name} className={extractStyles.tableRow}>
              <span className={extractStyles.sessionName}>{s.name}</span>
              <span>
                {s.extracted
                  ? <span className={extractStyles.done}>Extracted</span>
                  : s.has_depth
                    ? <span className={extractStyles.pending}>Pending</span>
                    : <span className={extractStyles.missing}>No depth file</span>
                }
              </span>
              <span>
                {sessionConfigs[s.name]
                  ? <span className={extractStyles.configured}>Configured</span>
                  : <span className={extractStyles.unconfigured}>Default</span>
                }
              </span>
              <button
                className={extractStyles.roiBtn}
                onClick={() => setRoiSession({ name: s.name, path: s.path })}
                disabled={!s.has_depth}
              >
                {sessionConfigs[s.name] ? 'Edit ROI' : 'Configure ROI'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Global extraction config */}
      <div className={extractStyles.configSection}>
        <span className={extractStyles.configTitle}>Extraction parameters</span>
        <div className={extractStyles.configGrid}>
          <div className={extractStyles.configField}>
            <label className={extractStyles.configLabel}>Min height (mm)</label>
            <input type="number" className={extractStyles.configInput}
              value={globalCfg.min_height}
              onChange={e => setGlobal('min_height', +e.target.value)} />
          </div>
          <div className={extractStyles.configField}>
            <label className={extractStyles.configLabel}>Max height (mm)</label>
            <input type="number" className={extractStyles.configInput}
              value={globalCfg.max_height}
              onChange={e => setGlobal('max_height', +e.target.value)} />
          </div>
          <div className={extractStyles.configField}>
            <label className={extractStyles.configLabel}>Crop size (px)</label>
            <input type="number" className={extractStyles.configInput} step={10}
              value={globalCfg.crop_size}
              onChange={e => setGlobal('crop_size', +e.target.value)} />
          </div>
          <div className={extractStyles.configField}>
            <label className={extractStyles.configLabel}>FPS</label>
            <input type="number" className={extractStyles.configInput}
              value={globalCfg.fps}
              onChange={e => setGlobal('fps', +e.target.value)} />
          </div>
        </div>
        <label className={extractStyles.checkLabel}>
          <input type="checkbox"
            checked={globalCfg.skip_extracted}
            onChange={e => setGlobal('skip_extracted', e.target.checked)} />
          Skip already-extracted sessions
        </label>
      </div>

      <div className={styles.actions}>
        {!running ? (
          <button
            className={styles.runButton}
            onClick={() => run('extract', projectPath, { ...config, ...globalCfg })}
            disabled={numPending === 0 && globalCfg.skip_extracted}
          >
            {numPending === 0 && globalCfg.skip_extracted
              ? 'All sessions extracted'
              : `Run Extraction${numPending > 0 ? ` (${numPending})` : ''}`
            }
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
            setSessionConfigs(prev => ({ ...prev, [roiSession.name]: cfg as any }))
            setRoiSession(null)
          }}
          onClose={() => setRoiSession(null)}
        />
      )}
    </div>
  )
}
