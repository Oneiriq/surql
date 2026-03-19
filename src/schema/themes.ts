/**
 * Theme system for schema visualization.
 *
 * Provides theming for GraphViz, Mermaid, and ASCII visualization formats
 * with multiple preset themes and customization options.
 */

export interface ColorScheme {
  readonly primary: string
  readonly secondary: string
  readonly background: string
  readonly text: string
  readonly accent: string
  readonly success: string
  readonly warning: string
  readonly error: string
  readonly muted: string
}

export interface GraphVizTheme {
  readonly nodeColor: string
  readonly edgeColor: string
  readonly bgColor: string
  readonly fontName: string
  readonly nodeShape: string
  readonly nodeStyle: string
  readonly edgeStyle: string
  readonly useGradients: boolean
  readonly useClusters: boolean
}

export interface MermaidTheme {
  readonly themeName: string
  readonly primaryColor: string
  readonly secondaryColor: string
  readonly useCustomCss: boolean
}

export interface ASCIITheme {
  readonly boxStyle: 'single' | 'double' | 'rounded' | 'heavy'
  readonly useUnicode: boolean
  readonly useColors: boolean
  readonly useIcons: boolean
  readonly colorScheme: string
}

export interface Theme {
  readonly name: string
  readonly description: string
  readonly colorScheme: ColorScheme
  readonly graphviz: GraphVizTheme
  readonly mermaid: MermaidTheme
  readonly ascii: ASCIITheme
}

const MODERN_THEME: Theme = Object.freeze({
  name: 'modern',
  description: 'Clean, professional design with indigo and pink accents',
  colorScheme: Object.freeze({
    primary: '#6366f1',
    secondary: '#ec4899',
    background: '#f8fafc',
    text: '#0f172a',
    accent: '#8b5cf6',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    muted: '#94a3b8',
  }),
  graphviz: Object.freeze({
    nodeColor: '#6366f1',
    edgeColor: '#64748b',
    bgColor: 'transparent',
    fontName: 'Arial',
    nodeShape: 'record',
    nodeStyle: 'filled,rounded',
    edgeStyle: 'solid',
    useGradients: true,
    useClusters: false,
  }),
  mermaid: Object.freeze({
    themeName: 'default',
    primaryColor: '#6366f1',
    secondaryColor: '#ec4899',
    useCustomCss: true,
  }),
  ascii: Object.freeze({
    boxStyle: 'rounded' as const,
    useUnicode: true,
    useColors: true,
    useIcons: true,
    colorScheme: 'default',
  }),
})

const DARK_THEME: Theme = Object.freeze({
  name: 'dark',
  description: 'Dark background theme with violet and fuchsia for dark mode environments',
  colorScheme: Object.freeze({
    primary: '#8b5cf6',
    secondary: '#d946ef',
    background: '#1e1b4b',
    text: '#f1f5f9',
    accent: '#a78bfa',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
    muted: '#64748b',
  }),
  graphviz: Object.freeze({
    nodeColor: '#8b5cf6',
    edgeColor: '#64748b',
    bgColor: '#1e1b4b',
    fontName: 'Arial',
    nodeShape: 'record',
    nodeStyle: 'filled,rounded',
    edgeStyle: 'solid',
    useGradients: true,
    useClusters: false,
  }),
  mermaid: Object.freeze({
    themeName: 'dark',
    primaryColor: '#8b5cf6',
    secondaryColor: '#d946ef',
    useCustomCss: true,
  }),
  ascii: Object.freeze({
    boxStyle: 'rounded' as const,
    useUnicode: true,
    useColors: true,
    useIcons: true,
    colorScheme: 'dark',
  }),
})

const FOREST_THEME: Theme = Object.freeze({
  name: 'forest',
  description: 'Nature-inspired theme with emerald and teal on light green background',
  colorScheme: Object.freeze({
    primary: '#10b981',
    secondary: '#14b8a6',
    background: '#f0fdf4',
    text: '#14532d',
    accent: '#059669',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    muted: '#86efac',
  }),
  graphviz: Object.freeze({
    nodeColor: '#10b981',
    edgeColor: '#059669',
    bgColor: 'transparent',
    fontName: 'Arial',
    nodeShape: 'record',
    nodeStyle: 'filled,rounded',
    edgeStyle: 'solid',
    useGradients: true,
    useClusters: false,
  }),
  mermaid: Object.freeze({
    themeName: 'forest',
    primaryColor: '#10b981',
    secondaryColor: '#14b8a6',
    useCustomCss: true,
  }),
  ascii: Object.freeze({
    boxStyle: 'rounded' as const,
    useUnicode: true,
    useColors: true,
    useIcons: true,
    colorScheme: 'forest',
  }),
})

const MINIMAL_THEME: Theme = Object.freeze({
  name: 'minimal',
  description: 'Minimalist grayscale theme with subtle styling',
  colorScheme: Object.freeze({
    primary: '#6b7280',
    secondary: '#64748b',
    background: '#ffffff',
    text: '#1f2937',
    accent: '#9ca3af',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    muted: '#d1d5db',
  }),
  graphviz: Object.freeze({
    nodeColor: '#6b7280',
    edgeColor: '#9ca3af',
    bgColor: 'transparent',
    fontName: 'Arial',
    nodeShape: 'record',
    nodeStyle: 'filled',
    edgeStyle: 'solid',
    useGradients: false,
    useClusters: false,
  }),
  mermaid: Object.freeze({
    themeName: 'neutral',
    primaryColor: '#6b7280',
    secondaryColor: '#64748b',
    useCustomCss: true,
  }),
  ascii: Object.freeze({
    boxStyle: 'single' as const,
    useUnicode: true,
    useColors: false,
    useIcons: false,
    colorScheme: 'minimal',
  }),
})

const _THEMES: Record<string, Theme> = {
  modern: MODERN_THEME,
  dark: DARK_THEME,
  forest: FOREST_THEME,
  minimal: MINIMAL_THEME,
}

/** Get a preset theme by name */
export function getTheme(name: string): Theme {
  const theme = _THEMES[name]
  if (!theme) {
    const available = Object.keys(_THEMES).sort().join(', ')
    throw new Error(`Unknown theme: '${name}'. Available themes: ${available}`)
  }
  return theme
}

/** List all available preset theme names */
export function listThemes(): string[] {
  return Object.keys(_THEMES).sort()
}

export { DARK_THEME, FOREST_THEME, MINIMAL_THEME, MODERN_THEME }
