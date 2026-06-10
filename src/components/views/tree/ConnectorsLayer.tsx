import type { LayoutEdge } from '../../../layout'

/**
 * Renders the engine's edges verbatim. There is deliberately ZERO
 * geometry in this file — every coordinate was computed (and
 * invariant-checked) by src/layout/connectors.ts, so a line that
 * doesn't touch its card is impossible here by construction.
 */
export default function ConnectorsLayer({
  edges,
  width,
  height,
}: {
  edges: LayoutEdge[]
  width: number
  height: number
}) {
  return (
    <svg
      className="absolute pointer-events-none"
      style={{ left: 0, top: 0, overflow: 'visible' }}
      width={width}
      height={height}
    >
      {edges.map((e, i) => {
        if (e.kind === 'spouse') {
          return (
            <path
              key={`sp-${e.aId}-${e.bId}`}
              d={e.d}
              stroke="#FF5EAE"
              strokeOpacity="0.85"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
          )
        }
        if (e.kind === 'secondary-parent') {
          return (
            <path
              key={`sec-${e.parentId}-${e.childId}`}
              d={e.d}
              stroke="#8E8E93"
              strokeOpacity="0.75"
              strokeWidth="2"
              strokeDasharray="6 4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        }
        return (
          <path
            key={`fam-${e.parentUnitId}-${i}`}
            d={e.d}
            stroke="#6C47FF"
            strokeOpacity="0.85"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}
