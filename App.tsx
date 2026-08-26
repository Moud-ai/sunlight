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
import VmScreen from './src/screens/VmScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import {Sidebar} from './src/components/Sidebar';
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
import {fetchProfileAvatar} from './src/lib/profile';
import {
  loadChats,
  createChat,
  generateChatId,
  ChatSession,
} from './src/lib/chatStorage';


export type RootStackParamList = {
  Login: undefined;
  Main: {session: SunlightSession};
  Profile: {session: SunlightSession};
  Settings: {session: SunlightSession};
  Devices: {session: SunlightSession};
  TwoFactor: {session: SunlightSession};
  ScanDevice: {session: SunlightSession};
  Harnesses: undefined;
  Terminal: undefined;
  Vm: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();


const SPLASH_MIN_MS = 900;
/** Fixed track width (px) the progress line sweeps across. */
const SPLASH_TRACK_WIDTH = 120;
/** Boot must never hang forever on keychain/biometrics: force-finish after this. */
const BOOT_WATCHDOG_MS = 8000;
/** Splash exit failsafe in case the Reanimated completion callback is lost. */
const SPLASH_FAILSAFE_MS = SPLASH_MIN_MS + 1500;

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


function App(): React.JSX.Element {
  const bootStartRef = useRef<number>(Date.now());
  const [booting, setBooting] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const [splashMounted, setSplashMounted] = useState(true);
  const [session, setSession] = useState<SunlightSession | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [, setChats] = useState<ChatSession[]>([]);
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

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

  // Failsafe: if the Reanimated exit callback is ever lost, unmount the
  // splash anyway so the app never stays trapped behind it.
  useEffect(() => {
    if (!splashMounted || splashExiting) {
      return;
    }
    const timer = setTimeout(() => setSplashMounted(false), SPLASH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, [splashMounted, splashExiting]);

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
                      <Stack.Screen name="Vm" options={{animation: 'slide_from_right'}}>
                        {() => <VmScreen />}
                      </Stack.Screen>
                      {/* Raw sandbox shell; reachable from Harnesses config. */}
                      <Stack.Screen name="Terminal" options={{animation: 'slide_from_right'}}>
                        {() => <TerminalScreen />}
                      </Stack.Screen>
                    </>
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
  mainContainer: {
    flex: 1,
    backgroundColor: c.bg,
  },
});
}

export default App;
