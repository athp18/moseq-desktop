import { useState, useCallback, useEffect } from 'react'
import { getBackendUrl } from '../hooks/useBackend'
import styles from './ROIEditor.module.css'

interface ROIConfig {
  bg_roi_depth_range: [number, number]
  bg_roi_index: number
  bg_roi_dilate: number   // iterations — passed as [n, n] to backend
  bg_roi_erode: number
  min_height: number      // mouse height range from floor (mm)
  max_height: number
  crop_size: number
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
  bg_roi_dilate: 3,
  bg_roi_erode: 3,
  min_height: 10,
  max_height: 100,
  crop_size: 80,
  use_plane_bground: false,
}

export function ROIEditor({ sessionName, sessionPath, baseDir, initialConfig, onSave, onClose }: Props) {
  const [config, setConfig] = useState<ROIConfig>({ ...DEFAULTS, ...initialConfig })
  const [frame, setFrame] = useState<string | null>(null)
  const [composite, setComposite] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Auto-load preview when modal opens
  useEffect(() => {
    fetchPreview({ ...DEFAULTS, ...initialConfig })
  }, [])

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
          // Expand single dilation/erosion integers to [n, n] tuples for backend
          config: {
            ...cfg,
            bg_roi_dilate: [cfg.bg_roi_dilate, cfg.bg_roi_dilate],
            bg_roi_erode:  [cfg.bg_roi_erode,  cfg.bg_roi_erode],
          },
        })
      })
      if (!res.ok) {
        const detail = await res.json()
        throw new Error(detail.detail || 'Preview failed')
      }
      const data = await res.json()
      setFrame(data.frame)
      setComposite(data.composite)
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
          config: {
            ...config,
            bg_roi_dilate: [config.bg_roi_dilate, config.bg_roi_dilate],
            bg_roi_erode:  [config.bg_roi_erode,  config.bg_roi_erode],
          },
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
          <span className={styles.title}>Arena ROI — {sessionName}</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </header>

        <div className={styles.body}>
          {/* Dual image preview */}
          <div className={styles.preview}>
            <div className={styles.imagePanel}>
              <span className={styles.imageLabel}>Background</span>
              {frame ? (
                <img src={`data:image/png;base64,${frame}`} className={styles.previewImage} alt="background" />
              ) : (
                <div className={styles.previewPlaceholder}>
                  {loading ? 'Loading…' : 'No image yet'}
                </div>
              )}
            </div>
            <div className={styles.imagePanel}>
              <span className={styles.imageLabel}>Arena mask</span>
              {composite ? (
                <img src={`data:image/png;base64,${composite}`} className={styles.previewImage} alt="ROI overlay" />
              ) : (
                <div className={styles.previewPlaceholder}>
                  {loading ? 'Computing ROI…' : 'Click Preview'}
                </div>
              )}
            </div>
            {loading && <div className={styles.previewOverlay}>Computing…</div>}
          </div>

          {/* Controls */}
          <div className={styles.controls}>
            <div className={styles.controlGroup}>
              <label className={styles.label}>Depth range (mm)</label>
              <div className={styles.rangeRow}>
                <input type="number" className={styles.numberInput}
                  value={config.bg_roi_depth_range[0]}
                  onChange={e => set('bg_roi_depth_range', [+e.target.value, config.bg_roi_depth_range[1]])} />
                <span className={styles.rangeSep}>–</span>
                <input type="number" className={styles.numberInput}
                  value={config.bg_roi_depth_range[1]}
                  onChange={e => set('bg_roi_depth_range', [config.bg_roi_depth_range[0], +e.target.value])} />
              </div>
              <p className={styles.hint}>±50 mm around the bucket floor</p>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>Mouse height (mm)</label>
              <div className={styles.rangeRow}>
                <input type="number" className={styles.numberInput}
                  value={config.min_height}
                  onChange={e => set('min_height', +e.target.value)} />
                <span className={styles.rangeSep}>–</span>
                <input type="number" className={styles.numberInput}
                  value={config.max_height}
                  onChange={e => set('max_height', +e.target.value)} />
              </div>
              <p className={styles.hint}>Clip depth values to this range above floor</p>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>Dilate (iters)</label>
              <input type="number" className={styles.numberInput} min={0} max={20}
                value={config.bg_roi_dilate}
                onChange={e => set('bg_roi_dilate', +e.target.value)} />
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>Erode (iters)</label>
              <input type="number" className={styles.numberInput} min={0} max={20}
                value={config.bg_roi_erode}
                onChange={e => set('bg_roi_erode', +e.target.value)} />
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>Crop size (px)</label>
              <input type="number" className={styles.numberInput} min={40} max={200} step={10}
                value={config.crop_size}
                onChange={e => set('crop_size', +e.target.value)} />
              <p className={styles.hint}>Output frame size for extraction</p>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.label}>ROI index</label>
              <input type="number" className={styles.numberInput} min={0}
                value={config.bg_roi_index}
                onChange={e => set('bg_roi_index', +e.target.value)} />
              <p className={styles.hint}>0 = largest detected region</p>
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.checkLabel}>
                <input type="checkbox"
                  checked={config.use_plane_bground}
                  onChange={e => set('use_plane_bground', e.target.checked)} />
                Plane background fit
              </label>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.previewBtn}
                onClick={() => fetchPreview(config)} disabled={loading}>
                {loading ? 'Computing…' : 'Preview'}
              </button>
              <button className={styles.saveBtn}
                onClick={handleSave} disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
