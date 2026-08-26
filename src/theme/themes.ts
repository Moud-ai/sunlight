/**
 * Sunlight palettes — Material Design 3 role objects mapped onto the Swiss
 * International Style token keys.
 *
 * Three dark themes:
 * - 'midnight'  : the original pure-black Swiss canvas (default).
 * - 'graphite'  : cool-gray surfaces on a near-black #0E0E11 base, accent white.
 * - 'nordic'    : deep blue-black #0B1220 with a light-blue #7DD3FC tint used
 *                 for interactive accents; text stays white.
 *
 * Each palette defines only the MD3-ish roles below; every other legacy color
 * key (bgSurface, bgElevated, textInverse, accentMuted, aliases ...) is
 * derived once in src/theme/ThemeProvider.tsx so screens keep using the exact
 * `colors` keyset they already know.
 */

export type ThemeName = 'midnight' | 'graphite' | 'nordic' | 'dynamic';

/** MD3-role core of one palette. */
export interface Palette {
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

export const THEME_NAMES: readonly ThemeName[] = ['midnight', 'graphite', 'nordic', 'dynamic'];

/** Human-facing labels for the appearance picker. */
export const THEME_LABELS: Record<ThemeName, string> = {
  midnight: 'midnight',
  graphite: 'graphite',
  nordic: 'nordic',
      dynamic: 'Dynamic (wallpaper)',
};

/** Mini preview squares per theme (bg / surface / accent) for the picker. */
export const THEME_SWATCHES: Record<ThemeName, [string, string, string]> = {
  midnight: ['#000000', '#141414', '#FFFFFF'],
  graphite: ['#0E0E11', '#1B1B22', '#FFFFFF'],
  nordic: ['#0B1220', '#16233A', '#7DD3FC'],
      dynamic: ['#000000', '#1A1A1A', '#BB86FC'],
};

export const PALETTES: Record<ThemeName, Palette> = {
  midnight: {
    bg: '#000000',
    surface: '#0A0A0A',
    elevated: '#141414',
    border: '#1F1F1F',
    borderStrong: '#2E2E2E',
    textPrimary: '#FFFFFF',
    textSecondary: '#A6A6A6',
    textTertiary: '#8A8A8A',
    accent: '#FFFFFF',
    accentText: '#000000',
    danger: '#FF453A',
  },
  graphite: {
    bg: '#0E0E11',
    surface: '#141419',
    elevated: '#1B1B22',
    border: '#26262E',
    borderStrong: '#35353F',
    textPrimary: '#F2F2F5',
    textSecondary: '#9C9CA6',
    textTertiary: '#7B7B85',
    accent: '#FFFFFF',
    accentText: '#0E0E11',
    danger: '#FF453A',
  },
  nordic: {
    bg: '#0B1220',
    surface: '#101A2C',
    elevated: '#16233A',
    border: '#1E2E48',
    borderStrong: '#2C4062',
    textPrimary: '#FFFFFF',
    textSecondary: '#9FB0C7',
    textTertiary: '#7489A6',
    // Light blue reserved as an interactive tint (borders/chips/buttons);
    // body text stays white via textPrimary.
    accent: '#7DD3FC',
    accentText: '#081120',
    danger: '#FF453A',
  },
  dynamic: {
    bg: '#000000',
    surface: '#0A0A0A',
    elevated: '#141414',
    border: '#1F1F1F',
    borderStrong: '#2E2E2E',
    textPrimary: '#FFFFFF',
    textSecondary: '#A6A6A6',
    textTertiary: '#8A8A8A',
    accent: '#BB86FC',
    accentText: '#000000',
    danger: '#FF453A',
  },

};
