import type { SessionTags } from '../model'

export function TagEditor({
  tags,
  onChange,
  idPrefix,
}: {
  tags: SessionTags
  onChange: (tags: SessionTags) => void
  idPrefix: string
}) {
  function update<K extends keyof SessionTags>(key: K, value: SessionTags[K]) {
    onChange({ ...tags, [key]: value })
  }

  return (
    <div className="tags">
      <Scale
        legend="Sleep quality"
        name={`${idPrefix}-sleep`}
        value={tags.sleep}
        onChange={(value) => update('sleep', value)}
      />
      <Scale
        legend="Soreness"
        name={`${idPrefix}-soreness`}
        value={tags.soreness}
        onChange={(value) => update('soreness', value)}
      />
      <Scale
        legend="Stress"
        name={`${idPrefix}-stress`}
        value={tags.stress}
        onChange={(value) => update('stress', value)}
      />
      <label className="notes">
        <span>Notes</span>
        <textarea
          value={tags.notes}
          maxLength={2000}
          rows={3}
          placeholder="Optional. How the morning felt, illness, travel…"
          onChange={(event) => update('notes', event.target.value)}
        />
      </label>
    </div>
  )
}

function Scale({
  legend,
  name,
  value,
  onChange,
}: {
  legend: string
  name: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <fieldset className="scale-field">
      <legend>{legend}</legend>
      <div className="scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={value === n ? 'on' : ''}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
            <span>{n}</span>
          </label>
        ))}
        <button type="button" className="ghost" onClick={() => onChange(null)} disabled={value == null}>
          Clear
        </button>
      </div>
    </fieldset>
  )
}
