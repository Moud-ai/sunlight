/**
 * Sunlight — embedded sandbox terminal screen.
 *
 * Renders the native Termux-based terminal view (`SunlightTerminalView`)
 * running `/system/bin/sh` inside the app sandbox. The session is owned
 * natively (see android/.../terminal/TerminalViewManager.kt) and survives
 * navigation away from this screen.
 *
 * Design: Swiss/Vercel tokens from src/theme — pure black, white text,
 * hairline borders, monospace micro-labels.
 */
import React, {useCallback, useMemo} from 'react';
import {
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  requireNativeComponent,
} from 'react-native';
import type {HostComponent, StyleProp, ViewStyle} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import type {RootStackParamList} from '../../App';
import {typography} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';

/** Native view manager name registered in SunlightPackage. */
const TerminalView = requireNativeComponent<{style?: StyleProp<ViewStyle>}>(
  'SunlightTerminalView',
) as HostComponent<{style?: StyleProp<ViewStyle>}>;

type SunlightTerminalNativeModule = {
  /** Send a command line to the shell (text + newline). */
  write(text: string): void;
  /** Send raw bytes without appending a newline (escape sequences). */
  paste(text: string): void;
};

const SunlightTerminal =
  NativeModules.SunlightTerminal as SunlightTerminalNativeModule;

// Extra-key escape sequences sent verbatim via `paste` (no trailing newline).
const EXTRA_KEYS: ReadonlyArray<{label: string; seq: string}> = [
  {label: 'TAB', seq: '\t'},
  {label: 'ESC', seq: '\u001b'},
  {label: '/', seq: '/'},
  {label: '-', seq: '-'},
  {label: 'HOME', seq: '\u001b[H'},
  {label: 'END', seq: '\u001b[F'},
  {label: '↑', seq: '\u001b[A'},
  {label: '↓', seq: '\u001b[B'},
];

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bg},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 54 : 14,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      position: 'relative',
    },
    backHit: {
      position: 'absolute',
      left: 16,
      top: Platform.OS === 'ios' ? 54 : 14,
      bottom: 0,
      justifyContent: 'center',
    },
    back: {color: c.textSecondary, fontSize: 13},
    headerLabel: {
      color: c.textTertiary,
      fontSize: typography.true,
      fontFamily: typography.mono,
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
    headerSpacer: {width: 60},
    terminalArea: {
      flex: 1,
      backgroundColor: c.bg,
    },
    terminal: {flex: 1},
    extraKeys: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.bg,
    },
    extraKey: {
      flexGrow: 1,
      flexBasis: '20%',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    extraKeyLabel: {
      color: c.textSecondary,
      fontSize: typography.sm,
      fontFamily: typography.mono,
    },
  });
}

function TerminalScreen(): React.JSX.Element {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const sendSeq = useCallback((seq: string) => {
    SunlightTerminal?.paste(seq);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHit}
          onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{'‹ back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerLabel}>sandbox shell</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.terminalArea}>
        <TerminalView style={styles.terminal} />
      </View>

      <View style={styles.extraKeys}>
        {EXTRA_KEYS.map(key => (
          <TouchableOpacity
            key={key.label}
            style={styles.extraKey}
            onPress={() => sendSeq(key.seq)}>
            <Text style={styles.extraKeyLabel}>{key.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default TerminalScreen;
