import type { CSSProperties } from 'react'

/**
 * Convert a CSS declaration string into a React style object.
 * Lets us port the design's inline `style="..."` strings near-verbatim,
 * keeping the recreation pixel-perfect. Splits on `;`, then on the first
 * `:` of each declaration (CSS values in this design never contain a bare
 * colon — color-mix/var/gradients keep theirs inside parens).
 */
export function css(decl: string): CSSProperties {
  const out: Record<string, string | number> = {}
  for (const raw of decl.split(';')) {
    const part = raw.trim()
    if (!part) continue
    const i = part.indexOf(':')
    if (i === -1) continue
    const prop = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    if (!prop) continue
    if (prop.startsWith('--')) {
      out[prop] = value // CSS custom property — keep as-is
    } else {
      out[kebabToCamel(prop)] = value
    }
  }
  return out as CSSProperties
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** Merge several css() fragments / style objects. */
export function sx(...parts: (string | CSSProperties | undefined | false)[]): CSSProperties {
  let acc: CSSProperties = {}
  for (const p of parts) {
    if (!p) continue
    acc = { ...acc, ...(typeof p === 'string' ? css(p) : p) }
  }
  return acc
}
