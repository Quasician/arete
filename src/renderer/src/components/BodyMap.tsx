// A front and back figure whose muscle groups fill in as your strength goals progress.
import type { BodyRegion } from '@shared/goals'
import { REGION_LABELS } from '@shared/goals'

type Shape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number }
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number }

const mirror = (s: Shape, axis: number): Shape =>
  s.kind === 'ellipse'
    ? { ...s, cx: 2 * axis - s.cx, rotate: s.rotate ? -s.rotate : undefined }
    : s.kind === 'rect'
      ? { ...s, x: 2 * axis - s.x - s.w }
      : s

function pair(s: Shape, axis: number): Shape[] {
  return [s, mirror(s, axis)]
}

// Front figure centred on x = 110, back figure on x = 330.
const F = 110
const B = 330

/** The body itself, drawn behind the muscle groups. */
function silhouette(cx: number): Shape[] {
  return [
    { kind: 'ellipse', cx, cy: 34, rx: 19, ry: 22 },
    { kind: 'rect', x: cx - 9, y: 52, w: 18, h: 16, r: 6 },
    { kind: 'path', d: `M${cx - 42} 76 Q${cx} 64 ${cx + 42} 76 L${cx + 36} 150 Q${cx + 34} 176 ${cx + 30} 186 L${cx - 30} 186 Q${cx - 34} 176 ${cx - 36} 150 Z` },
    ...pair({ kind: 'ellipse', cx: cx - 51, cy: 118, rx: 11, ry: 34, rotate: 8 }, cx),
    ...pair({ kind: 'ellipse', cx: cx - 58, cy: 178, rx: 9, ry: 30, rotate: 6 }, cx),
    ...pair({ kind: 'ellipse', cx: cx - 61, cy: 214, rx: 8, ry: 9 }, cx),
    ...pair({ kind: 'ellipse', cx: cx - 16, cy: 236, rx: 17, ry: 50, rotate: 2 }, cx),
    ...pair({ kind: 'ellipse', cx: cx - 16, cy: 324, rx: 12, ry: 38 }, cx),
    ...pair({ kind: 'ellipse', cx: cx - 18, cy: 368, rx: 13, ry: 6 }, cx)
  ]
}

const FRONT: [BodyRegion, Shape[]][] = [
  ['shoulders', pair({ kind: 'ellipse', cx: F - 44, cy: 86, rx: 13, ry: 12 }, F)],
  [
    'chest',
    [
      { kind: 'path', d: `M${F - 3} 82 L${F - 30} 80 Q${F - 38} 96 ${F - 30} 112 Q${F - 14} 118 ${F - 3} 110 Z` },
      { kind: 'path', d: `M${F + 3} 82 L${F + 30} 80 Q${F + 38} 96 ${F + 30} 112 Q${F + 14} 118 ${F + 3} 110 Z` }
    ]
  ],
  ['biceps', pair({ kind: 'ellipse', cx: F - 52, cy: 116, rx: 8, ry: 18, rotate: 8 }, F)],
  ['forearms', pair({ kind: 'ellipse', cx: F - 58, cy: 176, rx: 7, ry: 22, rotate: 6 }, F)],
  ['core', [{ kind: 'rect', x: F - 15, y: 118, w: 30, h: 52, r: 9 }]],
  ['hips', pair({ kind: 'ellipse', cx: F - 13, cy: 184, rx: 9, ry: 8 }, F)],
  ['quads', pair({ kind: 'ellipse', cx: F - 17, cy: 232, rx: 13, ry: 36, rotate: 2 }, F)],
  ['calves', pair({ kind: 'ellipse', cx: F - 16, cy: 322, rx: 8, ry: 28 }, F)]
]

const BACK: [BodyRegion, Shape[]][] = [
  ['shoulders', pair({ kind: 'ellipse', cx: B - 44, cy: 86, rx: 13, ry: 12 }, B)],
  ['upperBack', [{ kind: 'path', d: `M${B - 34} 80 Q${B} 72 ${B + 34} 80 L${B + 30} 120 Q${B + 18} 142 ${B} 146 Q${B - 18} 142 ${B - 30} 120 Z` }]],
  ['triceps', pair({ kind: 'ellipse', cx: B - 52, cy: 116, rx: 8, ry: 18, rotate: 8 }, B)],
  ['forearms', pair({ kind: 'ellipse', cx: B - 58, cy: 176, rx: 7, ry: 22, rotate: 6 }, B)],
  ['lowerBack', [{ kind: 'rect', x: B - 14, y: 148, w: 28, h: 24, r: 8 }]],
  ['glutes', pair({ kind: 'ellipse', cx: B - 15, cy: 190, rx: 15, ry: 13 }, B)],
  ['hamstrings', pair({ kind: 'ellipse', cx: B - 17, cy: 238, rx: 12, ry: 32, rotate: 2 }, B)],
  ['calves', pair({ kind: 'ellipse', cx: B - 16, cy: 318, rx: 10, ry: 26 }, B)]
]

function draw(s: Shape, key: string, props: React.SVGProps<SVGElement>) {
  if (s.kind === 'ellipse')
    return (
      <ellipse
        key={key}
        cx={s.cx}
        cy={s.cy}
        rx={s.rx}
        ry={s.ry}
        transform={s.rotate ? `rotate(${s.rotate} ${s.cx} ${s.cy})` : undefined}
        {...(props as React.SVGProps<SVGEllipseElement>)}
      />
    )
  if (s.kind === 'rect')
    return <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} {...(props as React.SVGProps<SVGRectElement>)} />
  return <path key={key} d={s.d} {...(props as React.SVGProps<SVGPathElement>)} />
}

export interface RegionState {
  value: number
  reached: boolean
  label: string
}

export function BodyMap({
  regions,
  highlight,
  onHover
}: {
  regions: Map<BodyRegion, RegionState>
  highlight: Set<BodyRegion>
  onHover: (region: BodyRegion | null) => void
}) {
  const fill = (r: BodyRegion) => {
    const s = regions.get(r)
    if (!s) return 'var(--body-idle)'
    const pct = Math.round(18 + 82 * s.value)
    return `color-mix(in srgb, var(--ok) ${pct}%, var(--body-base))`
  }
  const muscles = (list: [BodyRegion, Shape[]][], side: string) =>
    list.map(([r, shapes]) => {
      const s = regions.get(r)
      return (
        <g
          key={`${side}-${r}`}
          className={`muscle${highlight.has(r) ? ' lit' : ''}${s?.reached ? ' reached' : ''}${s ? ' tracked' : ''}`}
          onMouseEnter={() => onHover(r)}
          onMouseLeave={() => onHover(null)}
        >
          <title>{s ? `${REGION_LABELS[r]}: ${Math.round(s.value * 100)}% of the way (${s.label})` : `${REGION_LABELS[r]}: no goal`}</title>
          {shapes.map((sh, i) => draw(sh, String(i), { fill: fill(r) }))}
        </g>
      )
    })
  return (
    <svg className="body-map" viewBox="0 0 440 400" role="img" aria-label="Muscle groups shaded by progress toward your strength goals">
      <defs>
        <filter id="reached-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[F, B].map((cx) => (
        <g key={cx} className="silhouette">
          {silhouette(cx).map((s, i) => draw(s, String(i), {}))}
        </g>
      ))}
      {muscles(FRONT, 'front')}
      {muscles(BACK, 'back')}
      <text x={F} y={394} textAnchor="middle" className="body-caption">
        Front
      </text>
      <text x={B} y={394} textAnchor="middle" className="body-caption">
        Back
      </text>
    </svg>
  )
}
