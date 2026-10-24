import { useEffect, useRef, useState } from 'react'
import { getBackendUrl } from '../hooks/useBackend'
import styles from './ScreePlot.module.css'

interface ScreeData {
  explained_variance_ratio: number[]
  cumulative_variance_ratio: number[]
  n_components: number
}

interface Props {
  projectPath: string
  currentNpcs: number
  onNpcsChange: (n: number) => void
}

export function ScreePlot({ projectPath, currentNpcs, onNpcsChange }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<ScreeData | null>(null)
  const [npcs, setNpcs] = useState(currentNpcs)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [projectPath])

  useEffect(() => {
    if (data) renderPlot(data, npcs)
  }, [data, npcs])

  async function load() {
    setError(null)
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/pca/scree?base_dir=${encodeURIComponent(projectPath)}`)
      if (!res.ok) return  // PCA not run yet — component stays hidden
      const d = await res.json()
      setData(d)
      // Default to first component where cumulative >= 90%
      if (currentNpcs === 10) {
        const elbow = d.cumulative_variance_ratio.findIndex((v: number) => v >= 0.9) + 1
        if (elbow > 0) { setNpcs(elbow); onNpcsChange(elbow) }
      }
    } catch {
      // silently ignore — PCA hasn't run
    }
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const url = await getBackendUrl()
      await fetch(`${url}/pca/npcs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_dir: projectPath, npcs })
      })
      onNpcsChange(npcs)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  async function renderPlot(d: ScreeData, selectedNpcs: number) {
    if (!plotRef.current) return
    const Plotly = (await import('plotly.js-dist-min')).default

    const xs = Array.from({ length: d.n_components }, (_, i) => i + 1)

    const barTrace = {
      x: xs,
      y: d.explained_variance_ratio.map(v => v * 100),
      type: 'bar' as const,
      name: 'Per-PC variance (%)',
      marker: {
        color: xs.map(x => x <= selectedNpcs ? '#60a5fa' : '#2a2a2a'),
        line: { width: 0 }
      },
      hovertemplate: 'PC %{x}: %{y:.1f}%<extra></extra>',
    }

    const lineTrace = {
      x: xs,
      y: d.cumulative_variance_ratio.map(v => v * 100),
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Cumulative (%)',
      line: { color: '#f59e0b', width: 2 },
      hovertemplate: 'PC %{x}: %{y:.1f}% cumulative<extra></extra>',
      yaxis: 'y2',
    }

    // Vertical cutoff line at selectedNpcs
    const cutoffLine = {
      x: [selectedNpcs + 0.5, selectedNpcs + 0.5],
      y: [0, 100],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Selected cutoff',
      line: { color: '#f87171', width: 1.5, dash: 'dash' as const },
      yaxis: 'y2',
      hoverinfo: 'skip' as const,
    }

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      margin: { t: 8, r: 60, b: 40, l: 50 },
      xaxis: {
        title: { text: 'Principal component', font: { color: '#888', size: 11 } },
        tickfont: { color: '#888', size: 10 },
        gridcolor: '#1a1a1a',
        zerolinecolor: '#1a1a1a',
      },
      yaxis: {
        title: { text: 'Variance (%)', font: { color: '#60a5fa', size: 11 } },
        tickfont: { color: '#888', size: 10 },
        gridcolor: '#1a1a1a',
        zerolinecolor: '#1a1a1a',
      },
      yaxis2: {
        title: { text: 'Cumulative (%)', font: { color: '#f59e0b', size: 11 } },
        tickfont: { color: '#888', size: 10 },
        overlaying: 'y',
        side: 'right',
        range: [0, 105],
        showgrid: false,
      },
      legend: {
        font: { color: '#888', size: 10 },
        bgcolor: 'transparent',
        x: 0.02, y: 0.98,
      },
      font: { color: '#888' },
      showlegend: true,
    }

    Plotly.react(plotRef.current, [barTrace, lineTrace, cutoffLine], layout, {
      displayModeBar: false,
      responsive: true,
    })

    // Click on a bar to set npcs
    plotRef.current.removeAllListeners?.('plotly_click')
    plotRef.current.on('plotly_click', (event: any) => {
      const pt = event.points?.[0]
      if (pt && pt.x) {
        setNpcs(Number(pt.x))
        setSaved(false)
      }
    })
  }

  if (!data) return null

  const cumAtNpcs = data.cumulative_variance_ratio[npcs - 1] ?? 0

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Scree plot</span>
        <span className={styles.subtitle}>
          Click a bar or adjust the input to select how many PCs to use for modeling
        </span>
      </div>

      <div ref={plotRef} className={styles.plot} />

      <div className={styles.controls}>
        <div className={styles.selection}>
          <label className={styles.label}>PCs to use</label>
          <input
            type="number"
            className={styles.input}
            min={1}
            max={data.n_components}
            value={npcs}
            onChange={e => { setNpcs(+e.target.value); setSaved(false) }}
          />
          <span className={styles.variance}>
            {(cumAtNpcs * 100).toFixed(1)}% cumulative variance
          </span>
        </div>

        <button
          className={styles.saveBtn}
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  )
}
