// Estimates a meal's calories and protein from a plain description, using
// Claude. The key is read in the main process only.

const MODEL = 'claude-haiku-5-5'
const PORTION_HINT = {
  small: 'a smaller than usual portion',
  normal: 'a normal portion for an adult man',
  large: 'a larger than usual portion'
} as const

export interface MealEstimate {
  kcal: number
  kcalLow: number
  kcalHigh: number
  proteinG: number
  note: string
}

const SYSTEM = `You estimate the nutrition of meals from short descriptions for a personal food log.
Reply with one JSON object and nothing else:
{"kcal": number, "kcal_low": number, "kcal_high": number, "protein_g": number, "note": string}
- kcal is your best estimate for the whole meal as described; kcal_low and kcal_high bracket it.
- protein_g is grams of protein.
- note is at most 12 words naming the main assumption (portion sizes, cooking fat, a guessed item).
- Assume typical restaurant or cafeteria portions unless the description says otherwise.
- Never refuse; if the description is vague, give a wide range.`

export async function estimateMeal(
  apiKey: string,
  meal: { description: string; portion: keyof typeof PORTION_HINT; slot: string }
): Promise<MealEstimate> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Meal (${meal.slot}, ${PORTION_HINT[meal.portion]}): ${meal.description}`
        }
      ]
    }),
    signal: AbortSignal.timeout(30_000)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Anthropic rejected the API key. Check it in Settings.')
  if (res.status === 429) throw new Error('Anthropic is rate-limiting requests. Try again in a minute.')
  if (!res.ok) throw new Error(`The estimate failed (Anthropic returned ${res.status}).`)
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = body.content?.find((c) => c.type === 'text')?.text ?? ''
  return parseEstimate(text)
}

/** Pull the JSON object out of the reply and sanity-check it. */
export function parseEstimate(text: string): MealEstimate {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("The estimate came back in an unexpected form. Try again.")
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0])
  } catch {
    throw new Error("The estimate came back in an unexpected form. Try again.")
  }
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null)
  const kcal = num(raw.kcal)
  if (kcal == null || kcal < 0 || kcal > 10_000) throw new Error("The estimate didn't include sensible calories. Try again.")
  const low = num(raw.kcal_low) ?? kcal
  const high = num(raw.kcal_high) ?? kcal
  return {
    kcal,
    kcalLow: Math.min(low, kcal),
    kcalHigh: Math.max(high, kcal),
    proteinG: Math.max(0, Math.min(500, num(raw.protein_g) ?? 0)),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 120) : ''
  }
}
