/**
 * Sunlight legacy design tokens — now re-pointed onto the Swiss
 * International Style palette defined in ./theme/tamagui (swissTheme).
 *
 * Dark-first, high-contrast, minimal. Anti-slop: no gradients, no glows,
 * no pills, no emoji icons, no oversized icons in colored tiles.
 * Typography: Outfit (per-weight native families), monospace for code/data.
 *
 * Exported names and keys are stable: every screen adopts the deep-black
 * Swiss palette without any edits.
 */
import {StyleSheet} from 'react-native';

import {monoFamily, swissTheme} from './theme/tamagui';


export const colors = {
  bg: swissTheme.bg,
  bgElevated: swissTheme.elevated,
  bgSurface: swissTheme.surface,
  bgSurfaceHover: swissTheme.elevated,
  bgInput: swissTheme.elevated,
  bgOverlay: 'rgba(0,0,0,0.6)',

  textPrimary: swissTheme.textPrimary,
  textSecondary: swissTheme.textSecondary,
  textTertiary: swissTheme.textTertiary,
  textInverse: swissTheme.accentText,

  border: swissTheme.border,
  borderStrong: swissTheme.borderStrong,
  borderFocus: '#444444',

  // Monochrome accent strategy: primary accent IS white; interactive
  // emphasis uses inverted contrast (white fill / black label).
  accent: swissTheme.accent,
  accentText: swissTheme.accentText,
  accentHover: '#E6E6E6',
  accentMuted: 'rgba(255,255,255,0.12)',

  success: '#22c55e',
  successMuted: 'rgba(34,197,94,0.15)',
  warning: '#f59e0b',
  warningMuted: 'rgba(245,158,11,0.15)',
  danger: swissTheme.danger,
  dangerMuted: 'rgba(255,69,58,0.15)',

  // Inverted-contrast chat bubbles.
  userBubble: swissTheme.accent,
  assistantBubble: 'transparent',
  thinkingBg: 'rgba(255,255,255,0.04)',

  // Legacy aliases
  surface: swissTheme.surface,
  surfaceAlt: swissTheme.elevated,
  ink: swissTheme.textPrimary,
  inkDim: swissTheme.textSecondary,
  inkMute: swissTheme.textTertiary,
  line: swissTheme.border,
  lineStrong: swissTheme.borderStrong,
  signal: '#22c55e',
  warn: '#f59e0b',
} as const;

// Grid of multiples of 4.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;


export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 14,
  xl: 16,
  pill: 999,
  full: 999,
} as const;


export const typography = {
  // Font families — Outfit registers one family per weight natively,
  // so "weights" are selected via fontFamily, not fontWeight.
  sans: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semiBold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  mono: monoFamily,

  // Sizes — clean typographic scale.
  true: 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 21,
  xxl: 28,
  xxxl: 36,
} as const;

/** Legacy alias. */
export const monoFont = typography.mono;


export const buttonStyles = StyleSheet.create({
  button: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.accentText,
    fontSize: typography.md,
    fontFamily: typography.medium,
  },
  disabled: {
    opacity: 0.4,
  },
});
