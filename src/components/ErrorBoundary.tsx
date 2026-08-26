/**
 * ErrorBoundary — top-level React render-error shield.
 *
 * Catches any error thrown while rendering the navigation tree and shows a
 * recovery screen instead of letting RN tear the app down ("freezes then
 * auto-closes" / "empty screen" reports).
 *
 * DELIBERATELY DEPENDENCY-FREE: no theme, no storage imports at module scope
 * (storage is required lazily inside componentDidCatch), no navigation. This
 * component must survive whatever broke the tree below it — including a
 * broken provider chain — so its palette is hardcoded dark.
 *
 * Recovery model: 'reload app' resets the boundary's internal state and
 * remounts the whole subtree under a new key (a full in-place state reset).
 *
 * NOTE: class component — cannot use hooks; styles rebuilt per render.
 */
import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

/** Hardcoded midnight palette — must not import the theme chain. */
const PALETTE = {
  bg: '#000000',
  textPrimary: '#F5F5F4',
  textTertiary: '#666666',
  accent: '#D97706',
  accentText: '#FFFFFF',
};

/** Max characters of the error message shown on the recovery screen. */
const MAX_MESSAGE_CHARS = 400;

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  /** Increments on reload so the whole subtree remounts with fresh state. */
  resetCount: number;
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_MESSAGE_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…`;
}

function makeStyles() {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: PALETTE.bg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    wordmark: {
      color: PALETTE.textTertiary,
      fontSize: 11,
      letterSpacing: 5,
      marginBottom: 40,
    },
    title: {
      color: PALETTE.textPrimary,
      fontSize: 22,
      fontWeight: '600',
      marginBottom: 12,
    },
    message: {
      color: PALETTE.textTertiary,
      fontFamily: 'monospace',
      fontSize: 12,
      textAlign: 'center',
      marginBottom: 32,
    },
    button: {
      backgroundColor: PALETTE.accent,
      borderRadius: 4,
      paddingHorizontal: 32,
      paddingVertical: 12,
      minWidth: 160,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonLabel: {
      color: PALETTE.accentText,
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
    hint: {
      color: PALETTE.textTertiary,
      fontSize: 11,
      marginTop: 20,
      textAlign: 'center',
    },
  });
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = {error: null, resetCount: 0};

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {error};
  }

  componentDidCatch(error: Error): void {
    const message = error?.message ?? String(error);
    console.warn('[ErrorBoundary] render tree error:', message);
    try {
      // Boot journal breadcrumb (survives restarts, shown next launch).
      require('../lib/bootLog').bootMark('render-error', message);
    } catch {
      // Journal unavailable; ignore.
    }
    // Persist for post-mortem diagnosis. Best-effort only.
    try {
      const AsyncStorage =
        require('@react-native-async-storage/async-storage').default;
      AsyncStorage.setItem(
        '@sunlight_last_error',
        JSON.stringify({
          message,
          stack: typeof error?.stack === 'string' ? error.stack : null,
          isFatal: true,
          at: Date.now(),
          scope: 'render-tree',
        }),
      ).catch(() => {});
    } catch {
      // Storage unavailable; ignore.
    }
  }

  private handleReload = (): void => {
    this.setState(prev => ({
      error: null,
      resetCount: prev.resetCount + 1,
    }));
  };

  render(): React.JSX.Element {
    const {error, resetCount} = this.state;
    if (!error) {
      // Keyed remount guarantees child state is fully reset on reload.
      return <React.Fragment key={resetCount}>{this.props.children}</React.Fragment>;
    }
    const styles = makeStyles();
    return (
      <View style={styles.root}>
        <Text style={styles.wordmark}>SUNLIGHT</Text>
        <Text style={styles.title}>something broke</Text>
        <Text style={styles.message} numberOfLines={6} ellipsizeMode="tail">
          {truncate(error?.message || String(error))}
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.handleReload}>
          <Text style={styles.buttonLabel}>reload app</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          if the problem persists, close and reopen Sunlight
        </Text>
      </View>
    );
  }
}