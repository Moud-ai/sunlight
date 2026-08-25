/**
 * Tamagui design-system configuration — Swiss International Style.
 *
 * Deep black canvas (#000000), pure white text, restrained gray hierarchy,
 * hairline borders, generous whitespace, strong typographic scale.
 * Accent strategy (Vercel-style monochrome): the primary accent IS white;
 * interactive emphasis uses inverted contrast (white fill / black label).
 * Semantic danger stays red for destructive actions.
 *
 * Typography: Outfit. The TTFs are bundled natively per weight
 * (Android: android/app/src/main/assets/fonts, iOS: ios/Sunlight/Fonts +
 * Info.plist UIAppFonts), and each weight registers as its OWN font family:
 * 'Outfit_400Regular', 'Outfit_500Medium', 'Outfit_600SemiBold', 'Outfit_700Bold'.
 * Therefore every weight is exposed here as a separate Tamagui font family.
 *
 * NOTE: do NOT import @tamagui/config at runtime — it pulls web-only deps.
 * Everything is defined inline below, imported from @tamagui/core (the
 * react-native-safe core entry; the 'tamagui' barrel pulls in every
 * component package and an ESM-only native build).
 */
import {Platform} from 'react-native';
import {createFont, createTamagui, createTokens} from '@tamagui/core';


/**
 * Plain-object mirror of the dark token set so legacy StyleSheet screens
 * keep working without Tamagui.
 */
export const swissTheme = {
  bg: '#000000',
  surface: '#0A0A0A',
  elevated: '#141414',
  border: '#1F1F1F',
  borderStrong: '#2E2E2E',
  textPrimary: '#FFFFFF',
  textSecondary: '#A6A6A6',
  textTertiary: '#666666',
  accent: '#FFFFFF',
  accentText: '#000000',
  danger: '#FF453A',
} as const;


/** Clean typographic scale: 11, 12, 13, 15, 17, 21, 28, 36. */
const fontSizes = {
  true: 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 21,
  xxl: 28,
  '3xl': 36,
} as const;

const fontLineHeights = {
  true: 16,
  xs: 16,
  sm: 18,
  md: 20,
  lg: 22,
  xl: 26,
  xxl: 34,
  '3xl': 42,
} as const;

/**
 * Because each Outfit weight registers as its own native font family,
 * every weight token inside a family must resolve back to that family's
 * single physical weight (no synthetic bolding across families).
 */
function createOutfitFamily(family: string, nativeWeight: '400' | '500' | '700') {
  return createFont({
    family,
    size: fontSizes,
    lineHeight: fontLineHeights,
    weight: {
      0: nativeWeight,
      1: nativeWeight,
      2: nativeWeight,
      true: nativeWeight,
    },
    // Token 1 is the wide tracking used by uppercase wordmarks/labels.
    letterSpacing: {
      1: 4,
      2: 0.5,
      3: 0,
      4: -0.2,
    },
  });
}

const outfit = createOutfitFamily('Outfit_400Regular', '400');
const outfitMedium = createOutfitFamily('Outfit_500Medium', '500');
const outfitBold = createOutfitFamily('Outfit_700Bold', '700');

/**
 * Mono stack: Geist Mono is NOT bundled as a native font today (no OTF in
 * android/app/src/main/assets/fonts nor ios/Sunlight/Fonts, no UIAppFonts
 * entry), so we fall back to the platform monospace face.
 */
export const monoFamily = Platform.select({
  ios: 'monospace',
  android: 'monospace',
  default: 'monospace',
})!;

const monoFont = createFont({
  family: monoFamily,
  size: fontSizes,
  lineHeight: fontLineHeights,
  weight: {0: '400', 1: '400', 2: '400', true: '400'},
  letterSpacing: {1: 0, 2: 0, 3: 0, 4: 0},
});


const tokens = createTokens({
  color: swissTheme,
  /** Spacing grid: multiples of 4. */
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 20,
    xl: 32,
    xxl: 48,
  },
  radius: {
    none: 0,
    sm: 4,
    md: 8,
    lg: 14,
    pill: 999,
  },
  size: fontSizes,
});


const themes = {
  dark: {
    bg: swissTheme.bg,
    background: swissTheme.bg,
    surface: swissTheme.surface,
    elevated: swissTheme.elevated,
    border: swissTheme.border,
    borderColor: swissTheme.border,
    borderStrong: swissTheme.borderStrong,
    color: swissTheme.textPrimary,
    textPrimary: swissTheme.textPrimary,
    textSecondary: swissTheme.textSecondary,
    textTertiary: swissTheme.textTertiary,
    accent: swissTheme.accent,
    accentText: swissTheme.accentText,
    danger: swissTheme.danger,
  },
};


export const config = createTamagui({
  fonts: {
    outfit,
    
    outfitMedium,
    outfitBold,
    monoFont,
  },
  tokens,
  themes,
  settings: {
    allowedStyleValues: 'somewhat-strict',
    defaultFont: 'geomanist',
  },
});

export type AppConfig = typeof config;
