import { useState, useEffect, useCallback } from 'react'
import { getBackendUrl } from '../hooks/useBackend'
import styles from './SessionGroupTable.module.css'

interface SessionRow {
  uuid: string
  session_name: string
  subject_name: string
  group: string
  has_index: boolean
}

interface Props {
  projectPath: string
  onSaved?: () => void
}

export function SessionGroupTable({ projectPath, onSaved }: Props) {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})  // uuid -> group
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [suggestions, setSuggestions] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = await getBackendUrl()
      const [rowsRes, groupsRes] = await Promise.all([
        fetch(`${url}/sessions/list?base_dir=${encodeURIComponent(projectPath)}`),
        fetch(`${url}/sessions/groups/unique?base_dir=${encodeURIComponent(projectPath)}`),
      ])
      if (rowsRes.ok) setRows(await rowsRes.json())
      if (groupsRes.ok) setSuggestions(await groupsRes.json())
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => { load() }, [load])

  function setGroup(uuid: string, value: string) {
    setEdits(prev => ({ ...prev, [uuid]: value }))
    setSaved(false)
  }

  function getGroup(row: SessionRow) {
    return edits[row.uuid] ?? row.group
  }

  // Apply one group label to all sessions at once
  function applyToAll(group: string) {
    const next: Record<string, string> = {}
    rows.forEach(r => { next[r.uuid] = group })
    setEdits(next)
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    try {
      const url = await getBackendUrl()
      const assignments: Record<string, string> = {}
      rows.forEach(r => { assignments[r.uuid] = getGroup(r) })
      await fetch(`${url}/sessions/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_dir: projectPath, assignments })
      })
      setSaved(true)
      setEdits({})
      await load()
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  const hasEdits = Object.keys(edits).length > 0

  if (loading) return <div className={styles.loading}>Loading sessions…</div>
  if (rows.length === 0) return null

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{rows.length} session{rows.length !== 1 ? 's' : ''}</span>

        {/* Quick-apply: type a group and stamp all rows */}
        <QuickApply suggestions={suggestions} onApply={applyToAll} />

        <div className={styles.spacer} />

        {!rows[0].has_index && (
          <span className={styles.badge}>Staged — applied after aggregation</span>
        )}

        <button
          className={styles.saveBtn}
          onClick={save}
          disabled={saving || !hasEdits}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save groups'}
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Session</th>
            <th>Subject</th>
            <th>Group</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.uuid} className={edits[row.uuid] ? styles.edited : ''}>
              <td className={styles.mono}>{row.session_name}</td>
              <td className={styles.mono}>{row.subject_name || '—'}</td>
              <td>
                <input
                  className={styles.groupInput}
                  value={getGroup(row)}
                  onChange={e => setGroup(row.uuid, e.target.value)}
                  list="group-suggestions"
                  placeholder="default"
                  spellCheck={false}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Datalist for autocomplete */}
      <datalist id="group-suggestions">
        {suggestions.map(g => <option key={g} value={g} />)}
      </datalist>
    </div>
  )
}


// ── Quick-apply bar ──────────────────────────────────────────────────────────

function QuickApply({ suggestions, onApply }: { suggestions: string[]; onApply: (g: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <div className={styles.quickApply}>
      <input
        className={styles.quickInput}
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Apply to all…"
        list="group-suggestions"
        spellCheck={false}
      />
      <button
        className={styles.quickBtn}
        disabled={!value.trim()}
        onClick={() => { onApply(value.trim()); setValue('') }}
      >
        Apply all
      </button>
    </div>
  )
}
