/**
 * Sunlight — premium AI companion app for Moud.
 *
 * App mounts the minimal pre-paint tree (theme providers + a core-RN splash)
 * and then lazily mounts Root — the navigation tree with every heavy native
 * module — only AFTER the first frame is presented. This keeps reanimated/
 * worklets/gorhom/executorch evaluation out of the pre-paint window on ALL
 * devices (their module-level init performs blocking native handshakes that
 * silently deadlock when the main thread is busy during startup).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {TamaguiProvider} from '@tamagui/core';
import {ThemeProvider} from './src/theme/ThemeProvider';
import {
  readSession,
  unlockSession,
  clearSession,
  SunlightSession,
} from './src/auth/secure';
import {typography, spacing} from './src/theme';
import {useThemeColors, type ThemeColors} from './src/theme/ThemeProvider';
import {config} from './src/theme/tamagui';
import {initFCM, cleanupFCM} from './src/lib/firebase';
import {bootMark, readPreviousFailure} from './src/lib/bootLog';
import {APP_VERSION} from './src/lib/version';
import {
  loadChats,
  createChat,
  generateChatId,
  ChatSession,
} from './src/lib/chatStorage';

// Type-only re-export so existing screens keep importing the param list from
// App. Root is loaded lazily; this type import is erased at runtime.
export type {RootStackParamList} from './src/components/Root';

// Loaded only when first rendered (post-first-paint), which defers the
// evaluation of the entire heavy module graph. Metro compiles `import()` to
// require anyway; Promise.resolve defers it to a microtask so the module
// evaluates after the current commit, and it works under jest without the
// --experimental-vm-modules flag.
const LazyRoot = React.lazy(() =>
  Promise.resolve().then(() => require('./src/components/Root')),
);

const SPLASH_MIN_MS = 900;
/** Fixed track width (px) the progress line sweeps across. */
const SPLASH_TRACK_WIDTH = 120;
/** Boot must never hang forever on keychain/biometrics: force-finish after this. */
const BOOT_WATCHDOG_MS = 8000;
/** Unmount the splash even if the exit animation callback is lost. */
const SPLASH_FAILSAFE_MS = SPLASH_MIN_MS + 1500;
/** Content mounts this many ms after first commit — safely post-first-frame. */
const CONTENT_GATE_MS = 50;

/**
 * Boot splash on pure black: wordmark + sweeping hairline, then fade-out.
 * Uses core RN Animated only — importing reanimated here would re-open the
 * pre-paint deadlock window this file is designed to close.
 */
function BootSplash({
  exiting,
  onExited,
}: {
  exiting: boolean;
  onExited: () => void;
}): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [prevFailure, setPrevFailure] = useState<string | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  useEffect(() => {
    let alive = true;
    readPreviousFailure().then(failure => {
      if (alive && failure != null) {
        setPrevFailure(failure);
        bootMark('prev-failure-shown', failure);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 1,
        duration: 750,
        delay: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [opacity, progress]);

  useEffect(() => {
    if (!exiting) {
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 250,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished) {
        onExitedRef.current();
      }
    });
  }, [exiting, opacity]);

  return (
    <View style={styles.splash}>
      <Animated.View style={[styles.splashContent, {opacity}]}>
        <Text style={styles.splashWordmark}>SUNLIGHT</Text>
        <View style={styles.splashTrack}>
          <Animated.View
            style={[
              styles.splashProgress,
              {width: progress.interpolate({inputRange: [0, 1], outputRange: [0, SPLASH_TRACK_WIDTH]})},
            ]}
          />
        </View>
      </Animated.View>
      <View style={styles.splashFooter} pointerEvents="none">
        {prevFailure != null ? (
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.splashDiag}>
            last run failed: {prevFailure}
          </Text>
        ) : null}
        <Text style={styles.splashVersion}>v{APP_VERSION}</Text>
      </View>
    </View>
  );
}

function App(): React.JSX.Element {
  const bootStartRef = useRef<number>(Date.now());
  const [booting, setBooting] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const [splashMounted, setSplashMounted] = useState(true);
  const [contentReady, setContentReady] = useState(false);
  const [session, setSession] = useState<SunlightSession | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [, setChats] = useState<ChatSession[]>([]);
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  useEffect(() => {
    bootMark('app-mounted');
    // Content gate: mount the heavy tree only after the first frame, so no
    // reanimated/worklets/executorch module evaluates pre-paint.
    const t = setTimeout(() => setContentReady(true), CONTENT_GATE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    // Watchdog: a hung keychain/biometric prompt must never block boot
    // forever — force-finish so the app always reaches a usable screen.
    const watchdog = setTimeout(() => {
      if (alive) {
        setBooting(false);
      }
    }, BOOT_WATCHDOG_MS);
    (async () => {
      try {
        const stored = await readSession();
        if (!alive || !stored) {
          return;
        }
        const unlocked = await unlockSession({
          promptMessage: 'Unlock Sunlight',
          cancelButtonText: 'Cancel',
        });
        if (!alive) {
          return;
        }
        setSession(unlocked);
        if (unlocked) {
          const list = await loadChats();
          if (alive) {
            setChats(list);
          }
        }
      } catch {
        if (alive) {
          setSession(null);
        }
      } finally {
        if (alive) {
          bootMark('boot-done');
          setBooting(false);
        }
      }
    })();
    return () => {
      alive = false;
      clearTimeout(watchdog);
    };
  }, []);

  // Hold the splash for a polished minimum duration after boot completes.
  useEffect(() => {
    if (booting) {
      return;
    }
    const elapsed = Date.now() - bootStartRef.current;
    const timer = setTimeout(
      () => setSplashExiting(true),
      Math.max(0, SPLASH_MIN_MS - elapsed),
    );
    return () => clearTimeout(timer);
  }, [booting]);

  // Failsafe: unmount the splash even if the exit animation callback is
  // lost. Deps exclude `splashExiting` so the timer survives INTO the exit.
  useEffect(() => {
    if (!splashMounted) {
      return;
    }
    const timer = setTimeout(() => {
      bootMark('splash-failsafe');
      setSplashMounted(false);
    }, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, [splashMounted]);

  const signOut = useCallback(() => {
    if (session) {
      cleanupFCM(session.apiKey).catch(() => {});
    }
    clearSession();
    setSession(null);
    setSidebarOpen(false);
  }, [session]);

  const handleNewChat = useCallback(() => {
    const id = generateChatId();
    createChat(id, 'new chat').then(chat => {
      setChats(prev => [chat, ...prev]);
      setCurrentChatId(id);
      setSidebarOpen(false);
    });
  }, []);

  const handleSelectChat = useCallback((id: string) => {
    setCurrentChatId(id);
    setSidebarOpen(false);
  }, []);

  const handleApproved = useCallback((s: SunlightSession) => {
    setSession(s);
    initFCM(s.apiKey).catch(() => {});
    loadChats().then(setChats);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <TamaguiProvider config={config} defaultTheme="dark">
          <StatusBar barStyle="light-content" />
          {contentReady ? (
            <React.Suspense fallback={null}>
              <LazyRoot
                session={session}
                sidebarOpen={sidebarOpen}
                currentChatId={currentChatId}
                onSelectChat={handleSelectChat}
                onNewChat={handleNewChat}
                onSignOut={signOut}
                onCloseSidebar={() => setSidebarOpen(false)}
                onToggleSidebar={() => setSidebarOpen(o => !o)}
                onApproved={handleApproved}
              />
            </React.Suspense>
          ) : null}
          {splashMounted ? (
            <BootSplash
              exiting={splashExiting}
              onExited={() => {
                bootMark('splash-exited');
                setSplashMounted(false);
              }}
            />
          ) : null}
        </TamaguiProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bg},
    splash: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.bg,
      elevation: 20,
      zIndex: 20,
    },
    splashContent: {
      alignItems: 'center',
    },
    splashWordmark: {
      color: c.textPrimary,
      fontSize: typography.md,
      fontFamily: typography.medium,
      letterSpacing: 5,
    },
    splashTrack: {
      marginTop: spacing.lg,
      width: 120,
      height: 1,
      backgroundColor: c.border,
      overflow: 'hidden',
    },
    splashProgress: {
      height: 1,
      backgroundColor: c.textPrimary,
    },
    splashVersion: {
      color: c.textTertiary,
      fontSize: 10,
      letterSpacing: 1,
    },
    splashDiag: {
      color: '#B45309',
      fontSize: 10,
      marginBottom: 6,
      marginHorizontal: 24,
      textAlign: 'center',
    },
    splashFooter: {
      alignItems: 'center',
      bottom: 28,
      left: 0,
      position: 'absolute',
      right: 0,
    },
  });
}

export default App;
