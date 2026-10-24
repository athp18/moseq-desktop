export type StepStatus = 'not_started' | 'incomplete' | 'complete' | 'running' | 'error'

export interface SessionState {
  name: string
  path: string
  has_depth: boolean
  extracted: boolean
  extraction_path: string | null
}

export interface PipelineState {
  base_dir: string
  sessions: SessionState[]
  aggregated: boolean
  pca_trained: boolean
  pca_applied: boolean
  changepoints_computed: boolean
  model_trained: boolean
  model_applied: boolean
  selected_model: string | null
}

export interface PipelineStep {
  id: string
  label: string
  description: string
  status: StepStatus
  requires: string[]
}

export function deriveSteps(state: PipelineState | null): PipelineStep[] {
  const allExtracted =
    state != null &&
    state.sessions.length > 0 &&
    state.sessions.every((s) => s.extracted)

  return [
    {
      id: 'extract',
      label: 'Extract',
      description: 'Process raw depth recordings',
      status: state == null
        ? 'not_started'
        : allExtracted
          ? 'complete'
          : state.sessions.some((s) => s.extracted)
            ? 'incomplete'
            : 'not_started',
      requires: []
    },
    {
      id: 'aggregate',
      label: 'Aggregate',
      description: 'Collect extraction results',
      status: state == null ? 'not_started' : state.aggregated ? 'complete' : 'not_started',
      requires: ['extract']
    },
    {
      id: 'pca',
      label: 'PCA',
      description: 'Train and apply PCA, compute changepoints',
      status: state == null
        ? 'not_started'
        : state.pca_applied && state.changepoints_computed
          ? 'complete'
          : state.pca_trained
            ? 'incomplete'
            : 'not_started',
      requires: ['aggregate']
    },
    {
      id: 'model',
      label: 'Model',
      description: 'Train AR-HMM model',
      status: state == null ? 'not_started' : state.model_trained ? 'complete' : 'not_started',
      requires: ['pca']
    },
    {
      id: 'analyze',
      label: 'Analyze',
      description: 'Crowd movies, syllable stats, group comparisons',
      status: state == null ? 'not_started' : state.model_applied ? 'complete' : 'not_started',
      requires: ['model']
    }
  ]
}
