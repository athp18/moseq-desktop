import { PipelineStep, StepStatus } from '../types/pipeline'
import styles from './PipelineStepper.module.css'

interface Props {
  steps: PipelineStep[]
  activeStep: string
  onSelectStep: (id: string) => void
  runningStep: string | null
}

const STATUS_ICONS: Record<StepStatus, string> = {
  not_started: '○',
  incomplete: '◑',
  complete: '●',
  running: '◌',
  error: '✕'
}

export function PipelineStepper({ steps, activeStep, onSelectStep, runningStep }: Props) {
  return (
    <nav className={styles.stepper}>
      {steps.map((step, i) => {
        const isLocked = step.requires.some(
          (req) => steps.find((s) => s.id === req)?.status === 'not_started'
        )
        const status = runningStep === step.id ? 'running' : step.status
        return (
          <button
            key={step.id}
            className={[
              styles.step,
              activeStep === step.id ? styles.active : '',
              isLocked ? styles.locked : '',
              styles[status]
            ].join(' ')}
            onClick={() => !isLocked && onSelectStep(step.id)}
            disabled={isLocked}
          >
            <span className={styles.index}>{i + 1}</span>
            <span className={styles.icon}>{STATUS_ICONS[status]}</span>
            <span className={styles.label}>{step.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
