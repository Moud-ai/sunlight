/**
 * AppIcon — Sunlight's own launcher icon rendered as an <Image>.
 *
 * Per product decision: no invented SVG marks — the splash and empty states
 * reuse the exact raster asset the Android/iOS launchers show
 * (src/assets/app-icon.png, copied from android mipmap-xxxhdpi/ic_launcher.png).
 */
import React from 'react';
import {Image, StyleSheet} from 'react-native';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
const ICON_SOURCE = require('../assets/app-icon.png');

interface Props {
  /** Square edge length in px. */
  size?: number;
}

export function AppIcon({size = 64}: Props): React.JSX.Element {
  return (
    <Image
      source={ICON_SOURCE}
      style={[styles.icon, {width: size, height: size, borderRadius: size * 0.22}]}
      resizeMode="contain"
    />
  );
}

/** Back-compat alias: previous code imported CloudLogo. */
export const CloudLogo = AppIcon;

const styles = StyleSheet.create({
  icon: {},
});
