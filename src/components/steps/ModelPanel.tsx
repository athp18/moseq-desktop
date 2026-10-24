import { useState, useCallback, useEffect, useRef } from 'react'
import { useStepRunner } from '../../hooks/useStepRunner'
import { LogViewer } from '../LogViewer'
import { getBackendUrl } from '../../hooks/useBackend'
import { StepPanelProps } from '../../App'
import styles from './StepPanel.module.css'
import modelStyles from './ModelPanel.module.css'

type Phase = 'scan_config' | 'scanning' | 'scan_results' | 'training' | 'done'

interface ScanConfig {
  min_kappa: number
  max_kappa: number
  n_models: number
  scan_scale: 'log' | 'linear'
  num_iter_scan: number
  num_syllables: number
}

interface ScanResults {
  kappas: number[]
  median_loglikelihoods: (number | null)[]
  mean_durations: (number | null)[]
  best_kappa_idx: number
  best_kappa: number
  changepoint_duration?: number
}

function fmtKappa(k: number): string {
  if (k >= 1e6) return `${(k / 1e6).toPrecision(2)}M`
  if (k >= 1e3) return `${(k / 1e3).toPrecision(2)}K`
  return String(k)
}

export function ModelPanel({ projectPath, config, onComplete }: StepPanelProps) {
  const [phase, setPhase] = useState<Phase>('scan_config')
  const [scanResults, setScanResults] = useState<ScanResults | null>(null)
  const [selectedKappa, setSelectedKappa] = useState<number | null>(null)
  const [numIterFinal, setNumIterFinal] = useState(1000)
  const [scanCfg, setScanCfg] = useState<ScanConfig>({
    min_kappa: 10000,
    max_kappa: 10000000,
    n_models: 15,
    scan_scale: 'log',
    num_iter_scan: 100,
    num_syllables: Number(config.num_syllables) || 100,
  })

  const plotRef = useRef<HTMLDivElement>(null)

  const [scanLoadError, setScanLoadError] = useState<string | null>(null)

  const onScanDone = useCallback(async () => {
    try {
      const url = await getBackendUrl()
      const res = await fetch(`${url}/model/scan/results?base_dir=${encodeURIComponent(projectPath)}`)
      if (!res.ok) throw new Error(await res.text())
      const data: ScanResults = await res.json()
      setScanResults(data)
      setSelectedKappa(data.best_kappa)
      setPhase('scan_results')
    } catch (e) {
      setScanLoadError(`Failed to load scan results: ${e}`)
      setPhase('scanning')
    }
  }, [projectPath])

  const onFinalDone = useCallback(() => {
    setPhase('done')
    onComplete()
  }, [onComplete])

  const scanRunner = useStepRunner(onScanDone)
  const finalRunner = useStepRunner(onFinalDone)

  // Check for existing scan results on mount
  useEffect(() => {
    async function checkExisting() {
      try {
        const url = await getBackendUrl()
        const res = await fetch(`${url}/model/scan/results?base_dir=${encodeURIComponent(projectPath)}`)
        if (res.ok) {
          const data: ScanResults = await res.json()
          setScanResults(data)
          setSelectedKappa(data.best_kappa)
          setPhase('scan_results')
        }
      } catch {
        // no existing results
      }
    }
    checkExisting()
  }, [projectPath])

  // Render kappa chart when scan results available
  useEffect(() => {
    if (scanResults && plotRef.current && phase === 'scan_results') {
      renderKappaChart(scanResults, selectedKappa)
    }
  }, [scanResults, selectedKappa, phase])

  async function renderKappaChart(data: ScanResults, selKappa: number | null) {
    if (!plotRef.current) return
    const Plotly = (await import('plotly.js-dist-min')).default

    const labels = data.kappas.map(fmtKappa)
    const lls = data.median_loglikelihoods.map(v => v ?? NaN)
    const durs = data.mean_durations.map(v => v ?? NaN)

    const barColors = data.kappas.map(k => {
      if (k === selKappa) return '#60a5fa'
      if (k === data.best_kappa) return '#818cf8'
      return '#2d2d2d'
    })

    const barTrace = {
      x: labels,
      y: lls,
      type: 'bar' as const,
      name: 'Median log-likelihood',
      marker: { color: barColors, line: { width: 0 } },
      hovertemplate: 'kappa=%{x}<br>log-lik=%{y:.4f}<extra></extra>',
    }

    const durTrace = {
      x: labels,
      y: durs,
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: 'Mean duration (s)',
      line: { color: '#f59e0b', width: 2 },
      marker: { size: 6 },
      hovertemplate: 'kappa=%{x}<br>dur=%{y:.3f}s<extra></extra>',
      yaxis: 'y2',
    }

    const traces: any[] = [barTrace, durTrace]

    if (data.changepoint_duration != null) {
      traces.push({
        x: [labels[0], labels[labels.length - 1]],
        y: [data.changepoint_duration, data.changepoint_duration],
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Changepoint target',
        line: { color: '#f87171', width: 1.5, dash: 'dash' as const },
        yaxis: 'y2',
        hoverinfo: 'skip' as const,
      })
    }

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      margin: { t: 8, r: 70, b: 50, l: 60 },
      xaxis: {
        title: { text: 'Kappa', font: { color: '#888', size: 11 } },
        tickfont: { color: '#888', size: 10 },
        gridcolor: '#1a1a1a',
      },
      yaxis: {
        title: { text: 'Median log-likelihood', font: { color: '#60a5fa', size: 11 } },
        tickfont: { color: '#888', size: 10 },
        gridcolor: '#1a1a1a',
        zerolinecolor: '#1a1a1a',
      },
      yaxis2: {
        title: { text: 'Mean duration (s)', font: { color: '#f59e0b', size: 11 } },
        tickfont: { color: '#888', size: 10 },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
      },
      legend: { font: { color: '#888', size: 10 }, bgcolor: 'transparent', x: 0.02, y: 0.02 },
      font: { color: '#888' },
    }

    Plotly.react(plotRef.current, traces, layout, { displayModeBar: false, responsive: true })

    plotRef.current.removeAllListeners?.('plotly_click')
    plotRef.current.on('plotly_click', (event: any) => {
      const pt = event.points?.[0]
      if (pt) {
        const idx = typeof pt.pointIndex === 'number' ? pt.pointIndex : pt.x
        const kappa = data.kappas[typeof idx === 'number' ? idx : labels.indexOf(idx)]
        if (kappa != null) setSelectedKappa(kappa)
      }
    })
  }

  function startScan() {
    setPhase('scanning')
    scanRunner.run('model-scan', projectPath, {
      ...scanCfg,
      num_syllables: scanCfg.num_syllables,
    })
  }

  function startFinal() {
    if (selectedKappa == null) return
    setPhase('training')
    finalRunner.run('model-final', projectPath, {
      kappa: selectedKappa,
      num_iter_final: numIterFinal,
      num_syllables: scanCfg.num_syllables,
    })
  }

  // ── Scan config ─────────────────────────────────────────────────────────────
  if (phase === 'scan_config') {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Model — Kappa Scan</h2>
        <p className={modelStyles.description}>
          Train {scanCfg.n_models} AR-HMM models across a range of kappa values for {scanCfg.num_iter_scan} iterations each.
          The best kappa is then used for a full {numIterFinal}-iteration final training.
        </p>

        <div className={modelStyles.form}>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Min kappa</label>
            <input type="number" className={modelStyles.input}
              value={scanCfg.min_kappa}
              onChange={e => setScanCfg(c => ({ ...c, min_kappa: +e.target.value }))} />
          </div>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Max kappa</label>
            <input type="number" className={modelStyles.input}
              value={scanCfg.max_kappa}
              onChange={e => setScanCfg(c => ({ ...c, max_kappa: +e.target.value }))} />
          </div>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Models in scan</label>
            <input type="number" className={modelStyles.input} min={3} max={30}
              value={scanCfg.n_models}
              onChange={e => setScanCfg(c => ({ ...c, n_models: +e.target.value }))} />
          </div>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Scale</label>
            <select className={modelStyles.select}
              value={scanCfg.scan_scale}
              onChange={e => setScanCfg(c => ({ ...c, scan_scale: e.target.value as 'log' | 'linear' }))}>
              <option value="log">Log</option>
              <option value="linear">Linear</option>
            </select>
          </div>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Iterations (scan)</label>
            <input type="number" className={modelStyles.input} min={50} max={500}
              value={scanCfg.num_iter_scan}
              onChange={e => setScanCfg(c => ({ ...c, num_iter_scan: +e.target.value }))} />
          </div>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Max syllables</label>
            <input type="number" className={modelStyles.input} min={10} max={200}
              value={scanCfg.num_syllables}
              onChange={e => setScanCfg(c => ({ ...c, num_syllables: +e.target.value }))} />
          </div>
          <div className={modelStyles.row}>
            <label className={modelStyles.label}>Iterations (final)</label>
            <input type="number" className={modelStyles.input} min={100} max={5000}
              value={numIterFinal}
              onChange={e => setNumIterFinal(+e.target.value)} />
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.runButton} onClick={startScan}>
            Run Kappa Scan
          </button>
        </div>
      </div>
    )
  }

  // ── Scanning ─────────────────────────────────────────────────────────────────
  if (phase === 'scanning') {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Model — Kappa Scan</h2>
        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={() => { scanRunner.cancel('model-scan'); setPhase('scan_config') }}>
            Cancel
          </button>
        </div>
        {(scanRunner.error || scanLoadError) && (
          <p className={styles.error}>{scanRunner.error || scanLoadError}</p>
        )}
        <LogViewer lines={scanRunner.logs} running={scanRunner.running} />
      </div>
    )
  }

  // ── Scan results ─────────────────────────────────────────────────────────────
  if (phase === 'scan_results' && scanResults) {
    const bestLL = scanResults.median_loglikelihoods[scanResults.best_kappa_idx]
    const selIdx = scanResults.kappas.indexOf(selectedKappa ?? -1)
    const selLL = selIdx >= 0 ? scanResults.median_loglikelihoods[selIdx] : null
    const selDur = selIdx >= 0 ? scanResults.mean_durations[selIdx] : null

    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Model — Select Kappa</h2>

        <div className={modelStyles.scanMeta}>
          <span>Auto-selected: <strong>{fmtKappa(scanResults.best_kappa)}</strong></span>
          {scanResults.changepoint_duration != null && (
            <span>Changepoint target: <strong>{scanResults.changepoint_duration.toFixed(2)}s</strong></span>
          )}
          <button className={modelStyles.rescanBtn} onClick={() => setPhase('scan_config')}>
            Re-scan
          </button>
        </div>

        <div ref={plotRef} className={modelStyles.kappaPlot} />

        <div className={modelStyles.selectionRow}>
          <div className={modelStyles.kappaInfo}>
            <span className={modelStyles.kappaLabel}>Selected kappa</span>
            <span className={modelStyles.kappaValue}>{selectedKappa != null ? fmtKappa(selectedKappa) : '—'}</span>
            {selLL != null && <span className={modelStyles.kappaStat}>log-lik {selLL.toFixed(4)}</span>}
            {selDur != null && <span className={modelStyles.kappaStat}>dur {selDur.toFixed(3)}s</span>}
          </div>
          <div className={modelStyles.finalConfig}>
            <label className={modelStyles.label}>Final iterations</label>
            <input type="number" className={modelStyles.input} min={100} max={5000}
              value={numIterFinal}
              onChange={e => setNumIterFinal(+e.target.value)} />
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.runButton} onClick={startFinal} disabled={selectedKappa == null}>
            Train Final Model ({numIterFinal} iters)
          </button>
        </div>
      </div>
    )
  }

  // ── Final training ────────────────────────────────────────────────────────────
  if (phase === 'training') {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Model — Final Training</h2>
        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={() => { finalRunner.cancel('model-final'); setPhase('scan_results') }}>
            Cancel
          </button>
        </div>
        {finalRunner.error && <p className={styles.error}>{finalRunner.error}</p>}
        <LogViewer lines={finalRunner.logs} running={finalRunner.running} />
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Model</h2>
      <div className={modelStyles.doneBox}>
        <span className={modelStyles.doneIcon}>✓</span>
        <p>Final model trained with kappa = {selectedKappa != null ? fmtKappa(selectedKappa) : '—'}</p>
        <button className={modelStyles.rescanBtn} onClick={() => setPhase('scan_config')}>
          Re-train
        </button>
      </div>
    </div>
  )
}
