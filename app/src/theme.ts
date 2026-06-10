import type { Mode, Direction } from './types'

type Palette = {
  bg: string; panel: string; surface: string; surface2: string
  text: string; text2: string; text3: string; border: string
  warn: string; accentFg: string
}

const light: Palette = {
  bg: '#EFEBE0', panel: '#E7E2D5', surface: '#FCFBF6', surface2: '#F1EDE2',
  text: '#2A2823', text2: '#6A655A', text3: '#938E80', border: '#DCD6C7',
  warn: '#B0703A', accentFg: '#FBFAF5',
}
const dark: Palette = {
  bg: '#201E1A', panel: '#1A1915', surface: '#27241E', surface2: '#2E2B23',
  text: '#ECE7D9', text2: '#A8A292', text3: '#7A7464', border: '#37332A',
  warn: '#D49A5C', accentFg: '#14130F',
}

/**
 * Apply the theme by writing CSS custom properties onto the root element,
 * mirroring the Design Component's applyTheme(). Direction B ("Console")
 * tightens radii, drops shadows, and swaps the display font to mono.
 */
export function applyTheme(root: HTMLElement, mode: Mode, direction: Direction, accentBase: string) {
  const P = mode === 'dark' ? dark : light
  let surface = P.surface, surface2 = P.surface2, border = P.border
  if (direction === 'B') {
    if (mode === 'light') { surface = '#F6F2E8'; surface2 = '#EFEADD'; border = '#D3CCBB' }
    else { surface = '#232019'; surface2 = '#2A2620'; border = '#343027' }
  }
  const accent = mode === 'dark'
    ? `color-mix(in oklab, white 20%, ${accentBase})`
    : accentBase

  const set = (k: string, v: string) => root.style.setProperty(k, v)
  set('--bg', P.bg); set('--panel', P.panel); set('--surface', surface); set('--surface-2', surface2)
  set('--text', P.text); set('--text-2', P.text2); set('--text-3', P.text3); set('--border', border)
  set('--warn', P.warn); set('--accent', accent); set('--accent-fg', P.accentFg)
  set('--accent-weak', `color-mix(in oklab, ${accent} 16%, ${surface})`)
  set('--radius', direction === 'B' ? '5px' : '12px')
  set('--radius-sm', direction === 'B' ? '4px' : '8px')
  set('--shadow', direction === 'B'
    ? 'none'
    : (mode === 'dark'
      ? '0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.55)'
      : '0 1px 2px rgba(42,40,35,.05),0 8px 24px -12px rgba(42,40,35,.18)'))
  set('--font-display', direction === 'B'
    ? "'JetBrains Mono', ui-monospace, monospace"
    : "'Newsreader', Georgia, serif")
  set('--font-ui', "'Hanken Grotesk', system-ui, sans-serif")
  set('--font-mono', "'JetBrains Mono', ui-monospace, monospace")
  set('--row-pad', '11px')
  root.style.background = P.bg
  root.style.color = P.text
}
