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

export type ThemeName =
  | 'midnight'
  | 'graphite'
  | 'nordic'
  | 'dynamic'
  | 'amber'
  | 'forest'
  | 'ocean'
  | 'rose'
  | 'noir'
  | 'custom';

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

export const THEME_NAMES: readonly ThemeName[] = [
  'midnight',
  'graphite',
  'nordic',
  'dynamic',
  'amber',
  'forest',
  'ocean',
  'rose',
  'noir',
  'custom',
];

/** Human-facing labels for the appearance picker. */
export const THEME_LABELS: Record<ThemeName, string> = {
  midnight: 'midnight',
  graphite: 'graphite',
  nordic: 'nordic',
  dynamic: 'Dynamic (wallpaper)',
  amber: 'amber',
  forest: 'forest',
  ocean: 'ocean',
  rose: 'rose',
  noir: 'noir',
  custom: 'Custom colors',
};

/** Mini preview squares per theme (bg / surface / accent) for the picker. */
export const THEME_SWATCHES: Record<ThemeName, [string, string, string]> = {
  midnight: ['#000000', '#141414', '#FFFFFF'],
  graphite: ['#0E0E11', '#1B1B22', '#FFFFFF'],
  nordic: ['#0B1220', '#16233A', '#7DD3FC'],
  dynamic: ['#000000', '#1A1A1A', '#BB86FC'],
  amber: ['#14100B', '#1E1912', '#E8A33D'],
  forest: ['#0C140E', '#132017', '#59C97C'],
  ocean: ['#071014', '#0D1B21', '#3DC2E0'],
  rose: ['#120A0D', '#1C1216', '#E58BA8'],
  noir: ['#050506', '#0C0C0E', '#8F8F98'],
  custom: ['#111111', '#222222', '#AAAAAA'],
};

export const PALETTES: Record<Exclude<ThemeName, 'custom'>, Palette> = {
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
  amber: {
    bg: '#14100B',
    surface: '#1E1912',
    elevated: '#2A2318',
    border: '#3A3122',
    borderStrong: '#4A3F2B',
    textPrimary: '#F5EFE2',
    textSecondary: '#C9BFA8',
    textTertiary: '#A3987F',
    accent: '#E8A33D',
    accentText: '#1A1204',
    danger: '#FF6B5E',
  },
  forest: {
    bg: '#0C140E',
    surface: '#132017',
    elevated: '#1B2E22',
    border: '#24392B',
    borderStrong: '#2E4A38',
    textPrimary: '#E8F2EA',
    textSecondary: '#AFC4B4',
    textTertiary: '#8AA293',
    accent: '#59C97C',
    accentText: '#04140A',
    danger: '#FF6B5E',
  },
  ocean: {
    bg: '#071014',
    surface: '#0D1B21',
    elevated: '#12262F',
    border: '#1A333F',
    borderStrong: '#234351',
    textPrimary: '#DFF1F6',
    textSecondary: '#A6C3CC',
    textTertiary: '#7FA0AB',
    accent: '#3DC2E0',
    accentText: '#041117',
    danger: '#FF6B5E',
  },
  rose: {
    bg: '#120A0D',
    surface: '#1C1216',
    elevated: '#271A20',
    border: '#36262D',
    borderStrong: '#45313B',
    textPrimary: '#F6E8EC',
    textSecondary: '#C9ACB5',
    textTertiary: '#A48992',
    accent: '#E58BA8',
    accentText: '#1C0A11',
    danger: '#FF6B5E',
  },
  noir: {
    bg: '#050506',
    surface: '#0C0C0E',
    elevated: '#141416',
    border: '#1F1F23',
    borderStrong: '#2C2C32',
    textPrimary: '#F2F2F4',
    textSecondary: '#B9B9BF',
    textTertiary: '#8A8A92',
    accent: '#8F8F98',
    accentText: '#050506',
    danger: '#FF5E5E',
  },

};
