/**
 * Sunlight — premium AI companion app for Moud.
 *
 * Navigation: sidebar (chat history + settings) + main content.
 * Typography: Geomanist (per-weight native families) + monospace for code/data.
 * Design system: Tamagui (Swiss International Style), dark-only.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  StyleSheet,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {NavigationContainer, useNavigation} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import {TamaguiProvider} from '@tamagui/core';
import {BottomSheetModalProvider} from '@gorhom/bottom-sheet';
import {ThemeProvider} from './src/theme/ThemeProvider';

import LoginScreen from './src/screens/LoginScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import DevicesScreen from './src/screens/DevicesScreen';
import TwoFactorScreen from './src/screens/TwoFactorScreen';
import ScanDeviceScreen from './src/screens/ScanDeviceScreen';
import TerminalScreen from './src/screens/TerminalScreen';
import HarnessesScreen from './src/screens/HarnessesScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import {Sidebar} from './src/components/Sidebar';
import {
  hasSession,
  unlockSession,
  clearSession,
  SunlightSession,
} from './src/auth/secure';
import {typography, spacing} from './src/theme';
import {useThemeColors, type ThemeColors} from './src/theme/ThemeProvider';
import {config} from './src/theme/tamagui';
import {initFCM, cleanupFCM} from './src/lib/firebase';
import {clearQuotaCache} from './src/lib/quota';
import {fetchProfileAvatar} from './src/lib/profile';
import {readPreviousFailure} from './src/lib/bootLog';
import {APP_VERSION} from './src/lib/version';
import {
  loadChats,
  createChat,
  generateChatId,
  ChatSession,
} from './src/lib/chatStorage';


export type RootStackParamList = {
  Login: undefined;
  Lock: undefined;
  Main: {session: SunlightSession};
  Profile: {session: SunlightSession};
  Settings: {session: SunlightSession};
  Devices: {session: SunlightSession};
  TwoFactor: {session: SunlightSession};
  ScanDevice: {session: SunlightSession};
  Harnesses: undefined;
  Terminal: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();


const SPLASH_MIN_MS = 900;
/** Fixed track width (px) the progress line sweeps across. */
const SPLASH_TRACK_WIDTH = 120;

/**
 * Premium boot splash on pure black: centered uppercase wordmark in
 * Geomanist Medium with wide tracking, above a hairline progress line that
 * sweeps 0→100% while booting. Reanimated-driven (fade + line width),
 * behavior identical to the previous RN Animated implementation.
 */
function BootSplash({
  exiting,
  onExited,
}: {
  exiting: boolean;
  onExited: () => void;
}): React.JSX.Element {
  const opacity = useSharedValue(0);
  const progress = useSharedValue(0);
  // Previous-run failure surfaced on device (null when the last run was healthy).
  const [prevFailure, setPrevFailure] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    readPreviousFailure().then(failure => {
      if (alive && failure != null) {
        setPrevFailure(failure);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  // Keep the latest callback reachable from UI-thread completion handlers.
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 300,
      easing: Easing.out(Easing.ease),
    });
    progress.value = withDelay(
      150,
      withTiming(1, {duration: 750, easing: Easing.out(Easing.ease)}),
    );
  }, [opacity, progress]);

  useEffect(() => {
    if (!exiting) {
      return;
    }
    opacity.value = withTiming(
      0,
      {duration: 250, easing: Easing.in(Easing.ease)},
      finished => {
        if (finished) {
          runOnJS(exitedRef.current)();
        }
      },
    );
  }, [exiting, opacity]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  const progressStyle = useAnimatedStyle(() => ({
    width: progress.value * SPLASH_TRACK_WIDTH,
  }));

  return (
    <View style={styles.splash}>
      <Animated.View style={[styles.splashContent, contentStyle]}>
        <Text style={styles.splashWordmark}>SUNLIGHT</Text>
        <View style={styles.splashTrack}>
          <Animated.View style={[styles.splashProgress, progressStyle]} />
        </View>
      </Animated.View>
      {/* On-device diagnostics: build stamp + previous-run failure. */}
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


type MainScreenProps = {
  session: SunlightSession;
  sidebarOpen: boolean;
  currentChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onSignOut: () => void;
  onCloseSidebar: () => void;
  onToggleSidebar: () => void;
};

function MainScreen(props: MainScreenProps): React.JSX.Element {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const {
    session,
    sidebarOpen,
    currentChatId,
    onSelectChat,
    onNewChat,
    onSignOut,
    onCloseSidebar,
    onToggleSidebar,
  } = props;

  // Sidebar identity row: cached avatar lookup (fetchProfileAvatar caches
  // internally, so this stays cheap across remounts).
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchProfileAvatar(session.subject, session.apiKey).then(url => {
      if (alive) {
        setAvatarUrl(url);
      }
    });
    return () => {
      alive = false;
    };
  }, [session.subject, session.apiKey]);

  const openProfile = useCallback(() => {
    navigation.navigate('Profile', {session});
  }, [navigation, session]);

  return (
    <View style={styles.mainContainer}>
      {/* Sidebar (owns its open/close animation + overlay) */}
      <Sidebar
        visible={sidebarOpen}
        currentChatId={currentChatId}
        onSelectChat={onSelectChat}
        onNewChat={onNewChat}
        onSettings={() => {
          onCloseSidebar();
          navigation.navigate('Settings', {session});
        }}
        onRequestProfile={() => {
          onCloseSidebar();
          openProfile();
        }}
        avatarUrl={avatarUrl}
        subject={session.subject}
        onClose={onCloseSidebar}
      />

      {/* Main content */}
      <ChatScreen
        session={session}
        chatId={currentChatId}
        onMenuToggle={onToggleSidebar}
        onSignOut={onSignOut}
        onPressAvatar={() => {
          onCloseSidebar();
          openProfile();
        }}
      />
    </View>
  );
}


function LockScreen({
  unlocking,
  onUnlock,
}: {
  unlocking: boolean;
  onUnlock: () => void;
}): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.lockScreen}>
      <Text style={styles.lockWordmark}>SUNLIGHT</Text>
      <Text style={styles.lockHint}>session locked</Text>
      <TouchableOpacity
        style={styles.lockButton}
        onPress={onUnlock}
        disabled={unlocking}
        testID="unlock-button">
        <Text style={styles.lockButtonText}>
          {unlocking ? 'unlocking…' : 'tap to unlock'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function App(): React.JSX.Element {
  const bootStartRef = useRef<number>(Date.now());
  const [booting, setBooting] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const [splashMounted, setSplashMounted] = useState(true);
  const [session, setSession] = useState<SunlightSession | null>(null);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [, setChats] = useState<ChatSession[]>([]);
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  useEffect(() => {
    (async () => {
      try {
        // Cold start must NEVER trigger the biometric prompt: the item is
        // bound to BIOMETRY_CURRENT_SET, so decrypting it presents the native
        // prompt instantly, racing the Activity lifecycle (NPE /
        // IllegalStateException in ResultHandlerInteractiveBiometric -> the
        // app exits). We only check existence (no decrypt); unlock is explicit.
        setLocked(await hasSession());
      } catch {
        setLocked(false);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const handleUnlock = useCallback(async () => {
    if (unlocking) {
      return;
    }
    setUnlocking(true);
    try {
      const s = await unlockSession({
        promptMessage: 'Unlock Sunlight',
        cancelButtonText: 'Cancel',
      });
      if (s) {
        setSession(s);
        setLocked(false);
        const list = await loadChats();
        setChats(list);
      }
    } catch {
      // Prompt cancelled/failed: stay locked.
    } finally {
      setUnlocking(false);
    }
  }, [unlocking]);

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

  const signOut = useCallback(() => {
    if (session) {
      cleanupFCM(session.apiKey).catch(() => {});
    }
    clearQuotaCache().catch(() => {});
    clearSession();
    setSession(null);
    setLocked(false);
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

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <TamaguiProvider config={config} defaultTheme="dark">
          <NavigationContainer>
            <BottomSheetModalProvider>
              <StatusBar barStyle="light-content" />
              {splashMounted ? (
                <BootSplash
                  exiting={splashExiting}
                  onExited={() => setSplashMounted(false)}
                />
              ) : (
                <Stack.Navigator
                  screenOptions={{
                    headerShown: false,
                    contentStyle: {backgroundColor: c.bg},
                    animation: 'fade',
                  }}>
                  {session ? (
                    <>
                      <Stack.Screen name="Main" options={{animation: 'none'}}>
                        {() => (
                          <MainScreen
                            session={session}
                            sidebarOpen={sidebarOpen}
                            currentChatId={currentChatId}
                            onSelectChat={handleSelectChat}
                            onNewChat={handleNewChat}
                            onSignOut={signOut}
                            onCloseSidebar={() => setSidebarOpen(false)}
                            onToggleSidebar={() => setSidebarOpen(o => !o)}
                          />
                        )}
                      </Stack.Screen>
                      <Stack.Screen name="Profile" options={{animation: 'slide_from_right'}}>
                        {() => <ProfileScreen session={session} onSignOut={signOut} />}
                      </Stack.Screen>
                      <Stack.Screen name="Settings" options={{animation: 'slide_from_right'}}>
                        {() => <SettingsScreen session={session} onSignOut={signOut} onNavigate={() => {}} />}
                      </Stack.Screen>
                      <Stack.Screen name="Devices" options={{animation: 'slide_from_right'}}>
                        {() => <DevicesScreen session={session} onSignOut={signOut} />}
                      </Stack.Screen>
                      <Stack.Screen name="TwoFactor" options={{animation: 'slide_from_right'}}>
                        {() => <TwoFactorScreen session={session} onSignOut={signOut} />}
                      </Stack.Screen>
                      <Stack.Screen name="ScanDevice" options={{animation: 'slide_from_right'}}>
                        {() => <ScanDeviceScreen session={session} onSignOut={signOut} />}
                      </Stack.Screen>
                      <Stack.Screen name="Harnesses" options={{animation: 'slide_from_right'}}>
                        {() => <ErrorBoundary><HarnessesScreen session={session} /></ErrorBoundary>}
                      </Stack.Screen>
                      {/* Raw sandbox shell; reachable from Harnesses config. */}
                      <Stack.Screen name="Terminal" options={{animation: 'slide_from_right'}}>
                        {() => <TerminalScreen />}
                      </Stack.Screen>
                    </>
                  ) : locked ? (
                    <Stack.Screen name="Lock" options={{animation: 'none'}}>
                      {() => (
                        <LockScreen
                          unlocking={unlocking}
                          onUnlock={handleUnlock}
                        />
                      )}
                    </Stack.Screen>
                  ) : (
                    <Stack.Screen name="Login">
                      {() => (
                        <LoginScreen
                          onApproved={(s, _opts?: {persistError?: boolean}) => {
                            setSession(s);
                            initFCM(s.apiKey).catch(() => {});
                            loadChats().then(setChats);
                          }}
                        />
                      )}
                    </Stack.Screen>
                  )}
                </Stack.Navigator>
              )}
              </BottomSheetModalProvider>
            </NavigationContainer>
          </TamaguiProvider>
          </ThemeProvider>
        </GestureHandlerRootView>
  );
}

function makeStyles(c: ThemeColors) { return StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bg},
  lockScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg,
    padding: 24,
  },
  lockWordmark: {
    color: c.textPrimary,
    fontSize: typography.md,
    fontFamily: typography.medium,
    letterSpacing: 5,
  },
  lockHint: {
    color: c.textTertiary,
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 24,
  },
  lockButton: {
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  lockButtonText: {
    color: c.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg,
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
  mainContainer: {
    flex: 1,
    backgroundColor: c.bg,
  },
});
}

export default App;
