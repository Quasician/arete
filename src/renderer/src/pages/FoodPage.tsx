import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, toLocalDate } from '@shared/logic'
import { MEAL_SLOTS, type Meal, type MealSlot, type Portion } from '@shared/types'
import { api, errorText, keys, useInvalidate } from '../api'
import { longDate } from '../format'

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks'
}

export function FoodPage() {
  const today = toLocalDate(new Date())
  const [date, setDate] = useState(today)
  const list = useQuery({ queryKey: keys.meals(date), queryFn: () => api.listMeals(date) })
  const meals = list.data ?? []
  const counted = meals.filter((m) => m.kcal != null)
  const kcal = counted.reduce((s, m) => s + (m.kcal ?? 0), 0)
  const protein = meals.reduce((s, m) => s + (m.proteinG ?? 0), 0)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{longDate(date)}</h1>
          <p className="subtle">
            {meals.length === 0
              ? 'Nothing logged for this day.'
              : `${kcal.toLocaleString()} kcal · ${protein} g protein` +
                (counted.length < meals.length ? ` · ${meals.length - counted.length} without numbers` : '')}
          </p>
        </div>
        <div className="row">
          <button className="button ghost" onClick={() => setDate(addDays(date, -1))}>
            ← Previous day
          </button>
          <button className="button ghost" onClick={() => setDate(today)} disabled={date === today}>
            Today
          </button>
          <button className="button ghost" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>
            Next day →
          </button>
        </div>
      </header>

      <div className="banner muted">
        Describe what you ate in plain words. In the next version, Arete will estimate calories and protein from the
        description and fill in planned meals from your grocery rotation.
      </div>

      {list.error && <p className="error">{errorText(list.error)}</p>}

      <div className="meal-grid">
        {MEAL_SLOTS.map((slot) => (
          <MealSlotCard key={slot} slot={slot} date={date} meals={meals.filter((m) => m.slot === slot)} />
        ))}
      </div>
    </div>
  )
}

function MealSlotCard({ slot, date, meals }: { slot: MealSlot; date: string; meals: Meal[] }) {
  const invalidate = useInvalidate()
  const [description, setDescription] = useState('')
  const [portion, setPortion] = useState<Portion>('normal')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.addMeal({
        date,
        slot,
        description,
        portion,
        kcal: kcal ? Math.round(Number(kcal)) : null,
        proteinG: protein ? Math.round(Number(protein)) : null
      })
      setDescription('')
      setKcal('')
      setProtein('')
      setPortion('normal')
      invalidate('meals')
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <section className="card">
      <h2>{SLOT_LABEL[slot]}</h2>
      {meals.map((m) => (
        <div key={m.id} className="meal">
          <div>
            <div>{m.description}</div>
            <div className="subtle small">
              {m.portion !== 'normal' && `${m.portion} portion · `}
              {m.kcal != null ? `${m.kcal} kcal` : 'no calories yet'}
              {m.proteinG != null && ` · ${m.proteinG} g protein`}
            </div>
          </div>
          <button
            className="link danger"
            onClick={async () => {
              await api.deleteMeal(m.id)
              invalidate('meals')
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <form className="meal-form" onSubmit={submit}>
        <input
          value={description}
          maxLength={500}
          placeholder="e.g. chicken, rice, roasted vegetables"
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <div className="form-row tight">
          <div className="segmented">
            {(['small', 'normal', 'large'] as Portion[]).map((p) => (
              <button
                type="button"
                key={p}
                className={p === portion ? 'active' : ''}
                onClick={() => setPortion(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            type="number"
            min="0"
            placeholder="kcal"
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            className="narrow"
          />
          <input
            type="number"
            min="0"
            placeholder="protein g"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            className="narrow"
          />
          <button className="button small" type="submit">
            Add
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
      </form>
    </section>
  )
}
