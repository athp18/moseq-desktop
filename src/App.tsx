import { useState, useEffect } from 'react'
import { useProject } from './hooks/useProject'
import { getBackendUrl } from './hooks/useBackend'
import { deriveSteps } from './types/pipeline'
import { PipelineStepper } from './components/PipelineStepper'
import styles from './App.module.css'

// Step panel components (stubbed — each will be its own file)
import { ExtractPanel } from './components/steps/ExtractPanel'
import { AggregatePanel } from './components/steps/AggregatePanel'
import { PCAPanel } from './components/steps/PCAPanel'
import { ModelPanel } from './components/steps/ModelPanel'
import { AnalyzePanel } from './components/steps/AnalyzePanel'

const STEP_PANELS: Record<string, React.ComponentType<StepPanelProps>> = {
  extract: ExtractPanel,
  aggregate: AggregatePanel,
  pca: PCAPanel,
  model: ModelPanel,
  analyze: AnalyzePanel
}

export interface StepPanelProps {
  projectPath: string
  config: Record<string, unknown>
  onComplete: () => void
}

export default function App() {
  const { projectPath, state, config, loading, error, openProject, refresh } = useProject()
  const [activeStep, setActiveStep] = useState('extract')
  const [runningStep, setRunningStep] = useState<string | null>(null)

  const steps = deriveSteps(state)

  useEffect(() => {
    async function autoLoadMock() {
      try {
        const baseUrl = await getBackendUrl()
        const resp = await fetch(`${baseUrl}/health`)
        const data = await resp.json()
        if (data.mock) openProject('/mock/project')
      } catch {
        // backend not ready
      }
    }
    autoLoadMock()
  }, [])

  async function handleOpenDirectory() {
    const path = await window.moseq.openDirectory()
    if (path) openProject(path)
  }

  const ActivePanel = STEP_PANELS[activeStep]

  if (!projectPath) {
    return (
      <div className={styles.welcome}>
        <h1 className={styles.title}>MoSeq</h1>
        <p className={styles.subtitle}>Motion Sequencing Analysis</p>
        <button className={styles.openButton} onClick={handleOpenDirectory}>
          Open Project Directory
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.headerTitle}>MoSeq</span>
        <span className={styles.headerPath}>{projectPath}</span>
        <button className={styles.changeButton} onClick={handleOpenDirectory}>
          Change
        </button>
      </header>

      <div className={styles.body}>
        <PipelineStepper
          steps={steps}
          activeStep={activeStep}
          onSelectStep={setActiveStep}
          runningStep={runningStep}
        />

        <main className={styles.main}>
          {loading ? (
            <div className={styles.loading}>Loading project…</div>
          ) : (
            <ActivePanel
              projectPath={projectPath}
              config={config}
              onComplete={() => {
                setRunningStep(null)
                refresh()
              }}
            />
          )}
        </main>
      </div>
    </div>
  )
}
