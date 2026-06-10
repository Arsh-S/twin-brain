import type { CSSProperties, ReactNode } from 'react'
import { css } from './css'

/** Spinning ring used in jobs / busy states. */
export function Spinner({ size = 11 }: { size?: number }) {
  return (
    <span style={css(
      `width:${size}px;height:${size}px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:tw-spin .7s linear infinite;display:inline-block;flex:0 0 auto`,
    )} />
  )
}

/** Centered loading state for a data region that hasn't fetched yet. */
export function Loading({ label = 'Loading…', pad = 28 }: { label?: string; pad?: number }) {
  return (
    <div style={css(`display:flex;align-items:center;justify-content:center;gap:10px;padding:${pad}px;color:var(--text-3)`)}>
      <Spinner size={14} />
      <span style={css('font-family:var(--font-mono);font-size:12px')}>{label}</span>
    </div>
  )
}

const LINK_STYLE: CSSProperties = css('color:var(--accent);cursor:pointer;border-bottom:1px solid color-mix(in srgb,var(--accent) 35%,transparent);font-weight:500')
const BOLD_STYLE: CSSProperties = css('font-weight:700;color:var(--text)')
const IT_STYLE: CSSProperties = css('font-style:italic;color:var(--text-3)')

/**
 * Render a markdown-ish string: **bold**, [[wikilink]], _italic_.
 * Wikilinks call onLink(name). Mirrors the design's makeToks tokenizer.
 */
export function MarkText({ text, onLink }: { text: string; onLink: (name: string) => void }): ReactNode {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={k++}>{text.slice(last, m.index)}</span>)
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<span key={k++} style={BOLD_STYLE}>{tok.slice(2, -2)}</span>)
    } else if (tok.startsWith('[[')) {
      const name = tok.slice(2, -2)
      out.push(
        <span key={k++} style={LINK_STYLE} onClick={() => onLink(name)} role="link" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onLink(name) }}>{name}</span>,
      )
    } else {
      out.push(<span key={k++} style={IT_STYLE}>{tok.slice(1, -1)}</span>)
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(<span key={k++}>{text.slice(last)}</span>)
  return <>{out}</>
}
