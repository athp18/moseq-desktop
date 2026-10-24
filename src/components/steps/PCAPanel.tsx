import { useState } from 'react'
import { useStepRunner } from '../../hooks/useStepRunner'
import { LogViewer } from '../LogViewer'
import { ScreePlot } from '../ScreePlot'
import { StepPanelProps } from '../../App'
import styles from './StepPanel.module.css'

export function PCAPanel({ projectPath, config, onComplete }: StepPanelProps) {
  const { running, logs, error, run, cancel } = useStepRunner(onComplete)
  const [npcs, setNpcs] = useState<number>(config.npcs as number ?? 10)

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>PCA</h2>
      <p className={styles.description}>
        Train PCA on extracted frames, project scores, and compute changepoints.
        After running, inspect the scree plot to select the number of PCs for modeling.
      </p>

      <ScreePlot
        projectPath={projectPath}
        currentNpcs={npcs}
        onNpcsChange={setNpcs}
      />

      <div className={styles.actions}>
        {!running ? (
          <button
            className={styles.runButton}
            onClick={() => run('pca', projectPath, { ...config, npcs })}
          >
            Run PCA
          </button>
        ) : (
          <button className={styles.cancelButton} onClick={() => cancel('pca')}>
            Cancel
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
      <LogViewer lines={logs} running={running} />
    </div>
  )
}
