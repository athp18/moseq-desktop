import { useState, useEffect, useRef, useCallback } from 'react'
import { useStepRunner } from '../../hooks/useStepRunner'
import { LogViewer } from '../LogViewer'
import { getBackendUrl } from '../../hooks/useBackend'
import { StepPanelProps } from '../../App'
import styles from './StepPanel.module.css'
import aStyles from './AnalyzePanel.module.css'

type Tab = 'usage' | 'scalars' | 'transitions'

interface AnalyzeStatus {
  moseq_df: boolean
  stats_df: boolean
  groups: string[]
}

interface UsageData {
  syllables: number[]
  groups: Record<string, number[]>
}

interface ScalarData {
  scalars: string[]
  groups: Record<string, Record<string, { mean: number; sem: number }>>
}

interface TransitionData {
  n_syllables: number
  groups: Record<string, number[][]>
}

const SCALAR_LABELS: Record<string, string> = {
  velocity_2d_mm:  'Velocity 2D (mm/s)',
  velocity_3d_mm:  'Velocity 3D (mm/s)',
  height_ave_mm:   'Height (mm)',
  width_mm:        'Width (mm)',
  length_mm:       'Length (mm)',
  area_mm:         'Area (mm²)',
}

const GROUP_COLORS = ['#60a5fa', '#f59e0b', '#4ade80', '#f87171', '#a78bfa', '#fb923c']

export function AnalyzePanel({ projectPath, config, onComplete }: StepPanelProps) {
  const [status, setStatus] = useState<AnalyzeStatus | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('usage')
  const [computing, setComputing] = useState(false)
  const [nSyllables, setNSyllables] = useState(20)

  const usagePlotRef      = useRef<HTMLDivElement>(null)
  const scalarsPlotRef    = useRef<HTMLDivElement>(null)
  const transitionPlotRef = useRef<HTMLDivElement>(null)

  const [usageData, setUsageData]           = useState<UsageData | null>(null)
  const [scalarData, setScalarData]         = useState<ScalarData | null>(null)
  const [transitionData, setTransitionData] = useState<TransitionData | null>(null)
  const [selectedGroup, setSelectedGroup]   = useState<string>('')
  const [selectedScalar, setSelectedScalar] = useState<string>('velocity_2d_mm')

  const onComputeDone = useCallback(() => {
    setComputing(false)
    loadStatus()
  }, [projectPath])

  const { running, logs, error, run, cancel } = useStepRunner(onComputeDone)

  useEffect(() => { loadStatus() }, [projectPath])

  useEffect(() => {
    if (!status?.stats_df) return
    if (activeTab === 'usage')       loadUsage()
    if (activeTab === 'scalars')     loadScalars()
    if (activeTab === 'transitions') loadTransitions()
  }, [activeTab, status, nSyllables])

  useEffect(() => {
    if (usageData && activeTab === 'usage') renderUsage(usageData)
  }, [usageData, activeTab])

  useEffect(() => {
    if (scalarData && activeTab === 'scalars') renderScalars(scalarData, selectedScalar)
  }, [scalarData, selectedScalar, activeTab])

  useEffect(() => {
    if (transitionData && activeTab === 'transitions') renderTransition(transitionData, selectedGroup)
  }, [transitionData, selectedGroup, activeTab])

  async function loadStatus() {
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/analyze/status?base_dir=${encodeURIComponent(projectPath)}`)
      if (res.ok) {
        const s: AnalyzeStatus = await res.json()
        setStatus(s)
        if (s.groups.length && !selectedGroup) setSelectedGroup(s.groups[0])
      }
    } catch { /* backend not ready */ }
  }

  async function loadUsage() {
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/analyze/syllable_usage?base_dir=${encodeURIComponent(projectPath)}&n_syllables=${nSyllables}`)
      if (res.ok) setUsageData(await res.json())
    } catch { /* ignore */ }
  }

  async function loadScalars() {
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/analyze/scalars?base_dir=${encodeURIComponent(projectPath)}`)
      if (res.ok) setScalarData(await res.json())
    } catch { /* ignore */ }
  }

  async function loadTransitions() {
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/analyze/transitions?base_dir=${encodeURIComponent(projectPath)}&n_syllables=${nSyllables}`)
      if (res.ok) setTransitionData(await res.json())
    } catch { /* ignore */ }
  }

  async function renderUsage(data: UsageData) {
    if (!usagePlotRef.current) return
    const Plotly = (await import('plotly.js-dist-min')).default
    const groups = Object.keys(data.groups)
    const labels = data.syllables.map(String)

    const traces = groups.map((g, gi) => ({
      x: labels,
      y: data.groups[g].map(v => v * 100),
      type: 'bar' as const,
      name: g,
      marker: { color: GROUP_COLORS[gi % GROUP_COLORS.length] },
      hovertemplate: `${g} syl %{x}: %{y:.2f}%<extra></extra>`,
    }))

    Plotly.react(usagePlotRef.current, traces, {
      ..._darkLayout(),
      barmode: 'group',
      xaxis: { title: { text: 'Syllable', font: { color: '#888', size: 11 } }, tickfont: { color: '#888', size: 9 }, gridcolor: '#1a1a1a' },
      yaxis: { title: { text: 'Mean usage (%)', font: { color: '#888', size: 11 } }, tickfont: { color: '#888', size: 9 }, gridcolor: '#1a1a1a' },
      margin: { t: 8, r: 16, b: 50, l: 60 },
    }, { displayModeBar: false, responsive: true })
  }

  async function renderScalars(data: ScalarData, scalar: string) {
    if (!scalarsPlotRef.current) return
    const Plotly = (await import('plotly.js-dist-min')).default
    const groups = Object.keys(data.groups)

    const traces = groups.map((g, gi) => {
      const vals = data.scalars.map(s => data.groups[g][s]?.mean ?? 0)
      const errs = data.scalars.map(s => data.groups[g][s]?.sem ?? 0)
      return {
        x: data.scalars.map(s => SCALAR_LABELS[s] ?? s),
        y: vals,
        error_y: { type: 'data' as const, array: errs, visible: true, color: GROUP_COLORS[gi % GROUP_COLORS.length], thickness: 1.5 },
        type: 'bar' as const,
        name: g,
        marker: { color: GROUP_COLORS[gi % GROUP_COLORS.length] },
        hovertemplate: `${g} %{x}: %{y:.2f} ± %{error_y.array:.2f}<extra></extra>`,
      }
    })

    Plotly.react(scalarsPlotRef.current, traces, {
      ..._darkLayout(),
      barmode: 'group',
      xaxis: { tickfont: { color: '#888', size: 10 }, gridcolor: '#1a1a1a' },
      yaxis: { title: { text: 'Mean ± SEM', font: { color: '#888', size: 11 } }, tickfont: { color: '#888', size: 10 }, gridcolor: '#1a1a1a' },
      margin: { t: 8, r: 16, b: 90, l: 60 },
    }, { displayModeBar: false, responsive: true })
  }

  async function renderTransition(data: TransitionData, group: string) {
    if (!transitionPlotRef.current || !data.groups[group]) return
    const Plotly = (await import('plotly.js-dist-min')).default
    const mat = data.groups[group]
    const n = data.n_syllables
    const labels = Array.from({ length: n }, (_, i) => String(i))

    Plotly.react(transitionPlotRef.current, [{
      z: mat,
      x: labels,
      y: labels,
      type: 'heatmap' as const,
      colorscale: 'Blues',
      reversescale: false,
      showscale: true,
      hovertemplate: '%{y} → %{x}: %{z:.3f}<extra></extra>',
    }], {
      ..._darkLayout(),
      xaxis: { title: { text: 'To syllable', font: { color: '#888', size: 11 } }, tickfont: { color: '#888', size: 9 }, gridcolor: '#1a1a1a' },
      yaxis: { title: { text: 'From syllable', font: { color: '#888', size: 11 } }, tickfont: { color: '#888', size: 9 }, gridcolor: '#1a1a1a', autorange: 'reversed' },
      margin: { t: 8, r: 80, b: 50, l: 60 },
    }, { displayModeBar: false, responsive: true })
  }

  function _darkLayout() {
    return {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#888' },
      legend: { font: { color: '#888', size: 10 }, bgcolor: 'transparent', x: 0.98, xanchor: 'right' as const, y: 0.98 },
      showlegend: true,
    }
  }

  const computed = status?.moseq_df && status?.stats_df

  // ── Compute prompt ───────────────────────────────────────────────────────────
  if (!computed || running) {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Analyze</h2>
        {!running ? (
          <>
            <p className={styles.description}>
              Compute syllable statistics and scalar kinematics from the trained model and index file.
              Results are saved to <code>_analysis/</code> and displayed as interactive charts.
            </p>
            <div className={styles.actions}>
              <button className={styles.runButton}
                onClick={() => { setComputing(true); run('analyze', projectPath, config) }}>
                Compute Analysis
              </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
          </>
        ) : (
          <>
            <div className={styles.actions}>
              <button className={styles.cancelButton} onClick={() => cancel('analyze')}>
                Cancel
              </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <LogViewer lines={logs} running={running} />
          </>
        )}
      </div>
    )
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  return (
    <div className={aStyles.container}>
      <div className={aStyles.topBar}>
        <h2 className={aStyles.heading}>Analyze</h2>
        <div className={aStyles.topBarRight}>
          <span className={aStyles.groupsLabel}>
            {status!.groups.join(' · ')}
          </span>
          <button className={aStyles.recomputeBtn}
            onClick={() => { setStatus(s => s ? { ...s, moseq_df: false, stats_df: false } : null) }}>
            Re-compute
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className={aStyles.tabs}>
        {(['usage', 'scalars', 'transitions'] as Tab[]).map(tab => (
          <button key={tab}
            className={`${aStyles.tab} ${activeTab === tab ? aStyles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}>
            {tab === 'usage' ? 'Syllable Usage' : tab === 'scalars' ? 'Scalars' : 'Transitions'}
          </button>
        ))}
      </div>

      {/* Usage tab */}
      {activeTab === 'usage' && (
        <div className={aStyles.tabContent}>
          <div className={aStyles.tabControls}>
            <label className={aStyles.controlLabel}>Top syllables</label>
            <input type="number" className={aStyles.controlInput} min={5} max={100}
              value={nSyllables}
              onChange={e => setNSyllables(+e.target.value)} />
          </div>
          <div ref={usagePlotRef} className={aStyles.plot} />
        </div>
      )}

      {/* Scalars tab */}
      {activeTab === 'scalars' && (
        <div className={aStyles.tabContent}>
          <div ref={scalarsPlotRef} className={aStyles.plot} />
        </div>
      )}

      {/* Transitions tab */}
      {activeTab === 'transitions' && (
        <div className={aStyles.tabContent}>
          <div className={aStyles.tabControls}>
            <label className={aStyles.controlLabel}>Group</label>
            <select className={aStyles.controlSelect}
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}>
              {status!.groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <label className={aStyles.controlLabel}>Syllables</label>
            <input type="number" className={aStyles.controlInput} min={5} max={100}
              value={nSyllables}
              onChange={e => setNSyllables(+e.target.value)} />
          </div>
          <div ref={transitionPlotRef} className={aStyles.plot} />
        </div>
      )}
    </div>
  )
}
