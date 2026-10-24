import { useState, useCallback } from 'react'
import { getBackendUrl } from '../hooks/useBackend'
import styles from './ROIEditor.module.css'

interface ROIConfig {
  bg_roi_depth_range: [number, number]
  bg_roi_index: number
  bg_roi_dilate: [number, number]
  bg_roi_erode: [number, number]
  use_plane_bground: boolean
}

interface Props {
  sessionName: string
  sessionPath: string
  baseDir: string
  initialConfig?: Partial<ROIConfig>
  onSave: (config: ROIConfig) => void
  onClose: () => void
}

const DEFAULTS: ROIConfig = {
  bg_roi_depth_range: [650, 750],
  bg_roi_index: 0,
  bg_roi_dilate: [15, 15],
  bg_roi_erode: [15, 15],
  use_plane_bground: false,
}

export function ROIEditor({ sessionName, sessionPath, baseDir, initialConfig, onSave, onClose }: Props) {
  const [config, setConfig] = useState<ROIConfig>({ ...DEFAULTS, ...initialConfig })
  const [composite, setComposite] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchPreview = useCallback(async (cfg: ROIConfig) => {
    setLoading(true)
    setError(null)
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/roi/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_path: sessionPath,
          base_dir: baseDir,
          config: cfg,
        })
      })
      if (!res.ok) {
        const detail = await res.json()
        throw new Error(detail.detail || 'Preview failed')
      }
      const data = await res.json()
      setComposite(data.composite)
      // If backend detected a depth range, offer it as a suggestion
      if (data.detected_depth_range && !initialConfig?.bg_roi_depth_range) {
        setConfig(prev => ({ ...prev, bg_roi_depth_range: data.detected_depth_range }))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionPath, baseDir, initialConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      const url = await getBackendUrl()
      await fetch(`${url}/roi/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_dir: baseDir,
          session_name: sessionName,
          config,
        })
      })
      onSave(config)
    } finally {
      setSaving(false)
    }
  }

  function set<K extends keyof ROIConfig>(key: K, val: ROIConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: val }))
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={styles.title}>ROI Configuration — {sessionName}</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </header>

        <div className={styles.body}>
          {/* Image preview */}
          <div className={styles.preview}>
            {composite ? (
              <img
                src={`data:image/png;base64,${composite}`}
                className={styles.previewImage}
                alt="ROI preview"
              />
            ) : (
              <div className={styles.previewPlaceholder}>
                {loading ? 'Computing ROI…' : 'Click "Preview" to detect arena'}
              </div>
            )}
            {loading && <div className={styles.previewOverlay}>Computing…</div>}
          </div>

          {/* Controls */}
          <div className={styles.controls}>
            <div className={styles.controlGroup}>
              <label className={styles.label}>Depth range (mm)</label>
              <div className={styles.rangeRow}>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={config.bg_roi_depth_range[0]}
                  onChange={e => set('bg_roi_depth_range', [+e.target.value, config.bg_roi_depth_range[1]])}
                />
                <span className={styles.rangeSep}>–</span>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={config.bg_roi_depth_range[1]}
                  onChange={e => set('bg_roi_depth_range', [config.bg_roi_depth_range[0], +e.target.value])}
                />
              </div>
              <p className={styles.hint}>Set to ±50 mm around the bucket floor depth</p>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>ROI index</label>
              <input
                type="number"
                className={styles.numberInput}
                min={0}
                value={config.bg_roi_index}
                onChange={e => set('bg_roi_index', +e.target.value)}
              />
              <p className={styles.hint}>Which detected region to use (0 = largest)</p>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>Dilate (px)</label>
              <div className={styles.rangeRow}>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={config.bg_roi_dilate[0]}
                  onChange={e => set('bg_roi_dilate', [+e.target.value, config.bg_roi_dilate[1]])}
                />
                <span className={styles.rangeSep}>×</span>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={config.bg_roi_dilate[1]}
                  onChange={e => set('bg_roi_dilate', [config.bg_roi_dilate[0], +e.target.value])}
                />
              </div>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>Erode (px)</label>
              <div className={styles.rangeRow}>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={config.bg_roi_erode[0]}
                  onChange={e => set('bg_roi_erode', [+e.target.value, config.bg_roi_erode[1]])}
                />
                <span className={styles.rangeSep}>×</span>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={config.bg_roi_erode[1]}
                  onChange={e => set('bg_roi_erode', [config.bg_roi_erode[0], +e.target.value])}
                />
              </div>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={config.use_plane_bground}
                  onChange={e => set('use_plane_bground', e.target.checked)}
                />
                Use plane background fit
              </label>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button
                className={styles.previewBtn}
                onClick={() => fetchPreview(config)}
                disabled={loading}
              >
                {loading ? 'Computing…' : 'Preview'}
              </button>
              <button
                className={styles.saveBtn}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
