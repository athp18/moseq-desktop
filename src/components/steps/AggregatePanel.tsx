import { useStepRunner } from '../../hooks/useStepRunner'
import { LogViewer } from '../LogViewer'
import { SessionGroupTable } from '../SessionGroupTable'
import { StepPanelProps } from '../../App'
import styles from './StepPanel.module.css'

export function AggregatePanel({ projectPath, config, onComplete }: StepPanelProps) {
  const { running, logs, error, run, cancel } = useStepRunner(onComplete)

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Aggregate</h2>
      <p className={styles.description}>
        Copy extraction results into a single folder and generate the session index.
        Assign group labels to sessions before running the model.
      </p>

      <SessionGroupTable projectPath={projectPath} />

      <div className={styles.actions}>
        {!running ? (
          <button className={styles.runButton} onClick={() => run('aggregate', projectPath, config)}>
            Run Aggregation
          </button>
        ) : (
          <button className={styles.cancelButton} onClick={() => cancel('aggregate')}>
            Cancel
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
      <LogViewer lines={logs} running={running} />
    </div>
  )
}
