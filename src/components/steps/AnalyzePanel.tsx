import { useStepRunner } from '../../hooks/useStepRunner'
import { LogViewer } from '../LogViewer'
import { StepPanelProps } from '../../App'
import styles from './StepPanel.module.css'

export function AnalyzePanel({ projectPath, config, onComplete }: StepPanelProps) {
  const { running, logs, error, run, cancel } = useStepRunner(onComplete)

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Analyze</h2>
      {/* TODO: step-specific config and UI */}
      <div className={styles.actions}>
        {!running ? (
          <button className={styles.runButton} onClick={() => run('analyze', projectPath, config)}>
            Run Analyze
          </button>
        ) : (
          <button className={styles.cancelButton} onClick={() => cancel('analyze')}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <LogViewer lines={logs} running={running} />
    </div>
  )
}
