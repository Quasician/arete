import { formatDuration, formatPace } from '@shared/logic'
import { KIND_LABELS, type Activity } from '@shared/types'
import { api, useInvalidate } from '../api'
import { formatDistance } from '../format'

const SOURCE_LABEL = { manual: 'Logged',
  habit: 'Habit', hevy: 'Hevy', concept2: 'Concept2' } as const

export function ActivityLine({ activity: a, compact = false }: { activity: Activity; compact?: boolean }) {
  const invalidate = useInvalidate()
  const facts = [
    formatDuration(a.durationSec),
    formatDistance(a.distanceM),
    a.kind === 'row' ? formatPace(a.detail.paceSecPer500) : '',
    a.detail.avgHeartRate ? `${a.detail.avgHeartRate} bpm` : '',
    a.detail.sets ? `${a.detail.sets} sets` : ''
  ].filter(Boolean)

  async function remove() {
    await api.deleteActivity(a.id)
    invalidate('week', 'activities')
  }

  return (
    <div className={compact ? 'activity compact' : 'activity'}>
      <div className="activity-main">
        <span className={`kind kind-${a.kind}`}>{KIND_LABELS[a.kind]}</span>
        {a.title && <span className="activity-title">{a.title}</span>}
      </div>
      {facts.length > 0 && <div className="activity-facts">{facts.join(' · ')}</div>}
      <div className="activity-meta">
        <span>{SOURCE_LABEL[a.source]}</span>
        {a.source === 'manual' && (
          <button className="link danger" onClick={remove} title="Delete this entry">
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
