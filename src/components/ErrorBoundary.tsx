/**
 * ErrorBoundary — top-level React render-error shield.
 *
 * Catches any error thrown while rendering the navigation tree and shows a
 * Swiss recovery screen instead of letting RN tear the app down ("freezes
 * then auto-closes" reports). Dependency-free by design: no native modules,
 * no storage, no navigation — this component must survive whatever broke the
 * tree below it.
 *
 * Recovery model: 'reload app' resets the boundary's internal state and
 * remounts the whole subtree under a new key (a full in-place state reset).
 * If the underlying error is deterministic the boundary will catch it again;
 * the copy advises reopening the app in that case.
 *
 * NOTE: ErrorBoundary is a class component, so it cannot use hooks.
 * Instead, render() calls makeStyles() directly to produce theme-reactive
 * styles on every render.
 */
import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {typography, spacing} from '../theme';
import {type ThemeColors} from '../theme/ThemeProvider';
import {PALETTES} from '../theme/themes';
import {deriveColors} from '../theme/ThemeProvider';

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

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    wordmark: {
      color: c.textTertiary,
      fontSize: typography.true,
      fontFamily: typography.medium,
      letterSpacing: 5,
      marginBottom: spacing.xxl,
    },
    title: {
      color: c.textPrimary,
      fontSize: typography.xl,
      fontFamily: typography.semiBold,
      marginBottom: spacing.md,
    },
    message: {
      color: c.textTertiary,
      fontSize: typography.sm,
      fontFamily: typography.mono,
      textAlign: 'center',
      marginBottom: spacing.xl,
    },
    button: {
      backgroundColor: c.accent,
      borderRadius: 4,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      minWidth: 160,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonLabel: {
      color: c.accentText,
      fontSize: typography.sm,
      fontFamily: typography.medium,
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
    hint: {
      color: c.textTertiary,
      fontSize: typography.xs,
      fontFamily: typography.sans,
      marginTop: spacing.lg,
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
    // Keep a console breadcrumb; never rethrow or navigate from here.
    console.warn('[ErrorBoundary] render tree error:', error?.message);
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
    // Class component — cannot use hooks, so read the active theme palette
    // directly and rebuild styles each render.
    const c = deriveColors('midnight');
    const styles = makeStyles(c);
    return (
      <View style={styles.root}>
        <Text style={styles.wordmark}>SUNLIGHT</Text>
        <Text style={styles.title}>something broke</Text>
        <Text style={styles.message} numberOfLines={1}>
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
