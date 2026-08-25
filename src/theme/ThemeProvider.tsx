/**
 * ThemeProvider — runtime theme selection for Sunlight.
 *
 * Persists the selected palette under AsyncStorage '@sunlight_theme' and
 * exposes the LIVE derived color object (same keyset as the legacy
 * src/theme.ts `colors` export) via useThemeColors().
 *
 * Supports four themes:
 * - midnight / graphite / nordic: static palettes
 * - dynamic: Material You colors extracted from the user's wallpaper (Android 12+)
 *
 * Why a hook instead of mutating the legacy `colors` singleton: RN's
 * StyleSheet.create snapshots values once at module evaluation, so mutating a
 * shared object cannot restyle existing sheets. Converted surfaces read the
 * live palette through useThemeColors() and compose styles as
 * `StyleSheet.create([styles.base, {backgroundColor: c.bg}])` arrays; static
 * fallback styling keeps working for anything not yet converted.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {PALETTES, ThemeName} from './themes';

export const THEME_STORAGE_KEY = '@sunlight_theme';

/** Full legacy keyset, resolved live for the active palette. */
export interface ThemeColors {
  bg: string;
  bgElevated: string;
  bgSurface: string;
  bgSurfaceHover: string;
  bgInput: string;
  bgOverlay: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  border: string;
  borderStrong: string;
  borderFocus: string;

  accent: string;
  accentText: string;
  accentHover: string;
  accentMuted: string;

  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;

  userBubble: string;
  assistantBubble: string;
  thinkingBg: string;

  // Legacy aliases
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkDim: string;
  inkMute: string;
  line: string;
  lineStrong: string;
  signal: string;
  warn: string;
}

interface Palette {
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentText: string;
  danger: string;
}

interface Extras {
  borderFocus: string;
  accentHover: string;
}

const SEMANTIC = {
  success: '#30D158',
  successMuted: 'rgba(48,209,88,0.12)',
  warning: '#FFD60A',
  warningMuted: 'rgba(255,214,10,0.12)',
  dangerMuted: 'rgba(255,69,58,0.12)',
};

const EXTRAS: Record<Exclude<ThemeName, 'dynamic'>, Extras> = {
  midnight: {borderFocus: '#FFFFFF', accentHover: '#E0E0E0'},
  graphite: {borderFocus: '#F2F2F5', accentHover: '#D8D8DC'},
  nordic: {borderFocus: '#7DD3FC', accentHover: '#5BBFEF'},
};

function hexToRgba(value: string, alpha: number): string {
  if (value.startsWith('rgba')) return value;
  const hex = value.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Material You palette shape returned by DynamicColorModule.getPalette(). */
interface DynamicPaletteRaw {
  accent1?: Record<string, string>;
  accent2?: Record<string, string>;
  accent3?: Record<string, string>;
  neutral1?: Record<string, string>;
  neutral2?: Record<string, string>;
  neutral3?: Record<string, string>;
}

/**
 * Map a Material You tonal palette (from our native DynamicColorModule) to
 * our internal Palette shape. The mapping follows MD3 dark-scheme conventions:
 * - bg ← neutral1.900 (deepest neutral)
 * - surface ← neutral1.800
 * - elevated ← neutral2.700
 * - accent ← accent1.200 (lightest accent for dark bg)
 * - textPrimary ← neutral1.100 (lightest neutral)
 * - textSecondary ← neutral2.200
 * - textTertiary ← neutral2.400
 */
function mapDynamicPalette(raw: DynamicPaletteRaw): Palette {
  const n1 = raw.neutral1 ?? {};
  const n2 = raw.neutral2 ?? {};
  const a1 = raw.accent1 ?? {};
  return {
    bg: n1['900'] ?? '#000000',
    surface: n1['800'] ?? '#0A0A0A',
    elevated: n2['700'] ?? '#141414',
    border: n2['600'] ?? '#1F1F1F',
    borderStrong: n2['500'] ?? '#2E2E2E',
    textPrimary: n1['100'] ?? '#FFFFFF',
    textSecondary: n2['200'] ?? '#A6A6A6',
    textTertiary: n2['400'] ?? '#666666',
    accent: a1['200'] ?? '#BB86FC',
    accentText: a1['900'] ?? '#000000',
    danger: '#FF453A',
  };
}

/** Derive the full legacy colors keyset from one palette. */
export function deriveColors(
  theme: ThemeName,
  dynamicPalette?: Palette | null,
): ThemeColors {
  const p: Palette =
    theme === 'dynamic' && dynamicPalette
      ? dynamicPalette
      : PALETTES[theme] ?? PALETTES.midnight;
  const extras: Extras =
    theme === 'dynamic'
      ? {borderFocus: p.accent, accentHover: hexToRgba(p.accent, 0.8)}
      : EXTRAS[theme as Exclude<ThemeName, 'dynamic'>] ?? EXTRAS.midnight;
  return {
    bg: p.bg,
    bgElevated: p.elevated,
    bgSurface: p.surface,
    bgSurfaceHover: p.elevated,
    bgInput: p.elevated,
    bgOverlay: 'rgba(0,0,0,0.6)',

    textPrimary: p.textPrimary,
    textSecondary: p.textSecondary,
    textTertiary: p.textTertiary,
    textInverse: p.accentText,

    border: p.border,
    borderStrong: p.borderStrong,
    borderFocus: extras.borderFocus,

    accent: p.accent,
    accentText: p.accentText,
    accentHover: extras.accentHover,
    accentMuted: hexToRgba(p.accent, 0.12),

    ...SEMANTIC,
    danger: p.danger,

    userBubble: 'rgba(255,255,255,0.10)',
    assistantBubble: 'transparent',
    thinkingBg: hexToRgba(p.textPrimary === '#FFFFFF' ? '#FFFFFF' : p.textPrimary, 0.04),

    surface: p.surface,
    surfaceAlt: p.elevated,
    ink: p.textPrimary,
    inkDim: p.textSecondary,
    inkMute: p.textTertiary,
    line: p.border,
    lineStrong: p.borderStrong,
    signal: SEMANTIC.success,
    warn: SEMANTIC.warning,
  };
}

interface ThemeContextValue {
  theme: ThemeName;
  colors: ThemeColors;
  setTheme: (theme: ThemeName) => void;
  /** True while the dynamic palette is being fetched from the native module. */
  dynamicLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'midnight',
  colors: deriveColors('midnight'),
  setTheme: () => {},
  dynamicLoading: false,
});

function isThemeName(value: string | null): value is ThemeName {
  return (
    value === 'midnight' ||
    value === 'graphite' ||
    value === 'nordic' ||
    value === 'dynamic'
  );
}

export function ThemeProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemeName>('midnight');
  const [dynamicPalette, setDynamicPalette] = useState<Palette | null>(null);
  const [dynamicLoading, setDynamicLoading] = useState(false);

  // Restore persisted selection once on mount.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then(stored => {
        if (alive && isThemeName(stored)) {
          setThemeState(stored);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Fetch Material You palette when dynamic theme is selected.
  useEffect(() => {
    if (theme !== 'dynamic') return;
    let alive = true;
    setDynamicLoading(true);
    const mod = (NativeModules as Record<string, unknown>).DynamicColor as
      | {getPalette(): Promise<DynamicPaletteRaw | null>}
      | undefined;
    if (!mod) {
      setDynamicLoading(false);
      return;
    }
    mod
      .getPalette()
      .then(raw => {
        if (alive && raw) {
          setDynamicPalette(mapDynamicPalette(raw));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setDynamicLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      colors: deriveColors(theme, dynamicPalette),
      setTheme,
      dynamicLoading,
    }),
    [theme, dynamicPalette, setTheme, dynamicLoading],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Read the active theme name + live palette. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Convenience: just the live colors object. */
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}
