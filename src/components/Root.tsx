/**
 * Root — the full navigation tree, loaded LAZILY by App.
 *
 * Why lazy: React Native evaluates every statically-imported module before the
 * first frame paints. That graph includes react-native-reanimated/worklets
 * (whose module-level init performs a blocking runOnUISync handshake between
 * the JS thread and the main thread — a silent deadlock if the main thread is
 * busy during startup), @gorhom/bottom-sheet, ChatScreen/Sidebar and
 * react-native-executorch (~33MB synchronous dlopen via useLocalChat).
 *
 * By isolating ALL of that here and mounting it only after the first frame is
 * presented, nothing native-touching runs pre-paint on ANY device — no brand
 * (HONOR, Xiaomi, Samsung, Pixel, mid-range) hits the startup race.
 */
import React from 'react';
import {StatusBar, View} from 'react-native';
import {NavigationContainer, useNavigation} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {BottomSheetModalProvider} from '@gorhom/bottom-sheet';

import LoginScreen from '../screens/LoginScreen';
import ChatScreen from '../screens/ChatScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import DevicesScreen from '../screens/DevicesScreen';
import TwoFactorScreen from '../screens/TwoFactorScreen';
import ScanDeviceScreen from '../screens/ScanDeviceScreen';
import TerminalScreen from '../screens/TerminalScreen';
import HarnessesScreen from '../screens/HarnessesScreen';
import VmScreen from '../screens/VmScreen';
import ErrorBoundary from './ErrorBoundary';
import {Sidebar} from './Sidebar';
import {fetchProfileAvatar} from '../lib/profile';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {type SunlightSession} from '../auth/secure';

function makeStyles(c: ThemeColors) {
  return {main: {flex: 1, backgroundColor: c.bg}};
}

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

interface RootProps {
  session: SunlightSession | null;
  sidebarOpen: boolean;
  currentChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onSignOut: () => void;
  onCloseSidebar: () => void;
  onToggleSidebar: () => void;
  onApproved: (s: SunlightSession) => void;
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
  const styles = React.useMemo(() => makeStyles(c), [c]);
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

  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
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

  const openProfile = React.useCallback(() => {
    navigation.navigate('Profile', {session});
  }, [navigation, session]);

  return (
    <View style={styles.main}>
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

export default function Root(props: RootProps): React.JSX.Element {
  const c = useThemeColors();
  return (
    <NavigationContainer>
      <BottomSheetModalProvider>
        <StatusBar barStyle="light-content" />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: {backgroundColor: c.bg},
            animation: 'fade',
          }}>
          {props.session ? (
            <>
              <Stack.Screen name="Main" options={{animation: 'none'}}>
                {() => (
                  <MainScreen
                    session={props.session!}
                    sidebarOpen={props.sidebarOpen}
                    currentChatId={props.currentChatId}
                    onSelectChat={props.onSelectChat}
                    onNewChat={props.onNewChat}
                    onSignOut={props.onSignOut}
                    onCloseSidebar={props.onCloseSidebar}
                    onToggleSidebar={props.onToggleSidebar}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="Profile" options={{animation: 'slide_from_right'}}>
                {() => <ProfileScreen session={props.session!} onSignOut={props.onSignOut} />}
              </Stack.Screen>
              <Stack.Screen name="Settings" options={{animation: 'slide_from_right'}}>
                {() => (
                  <SettingsScreen
                    session={props.session!}
                    onSignOut={props.onSignOut}
                    onNavigate={() => {}}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="Devices" options={{animation: 'slide_from_right'}}>
                {() => <DevicesScreen session={props.session!} onSignOut={props.onSignOut} />}
              </Stack.Screen>
              <Stack.Screen name="TwoFactor" options={{animation: 'slide_from_right'}}>
                {() => <TwoFactorScreen session={props.session!} onSignOut={props.onSignOut} />}
              </Stack.Screen>
              <Stack.Screen name="ScanDevice" options={{animation: 'slide_from_right'}}>
                {() => <ScanDeviceScreen session={props.session!} onSignOut={props.onSignOut} />}
              </Stack.Screen>
              <Stack.Screen name="Harnesses" options={{animation: 'slide_from_right'}}>
                {() => (
                  <ErrorBoundary>
                    <HarnessesScreen session={props.session!} />
                  </ErrorBoundary>
                )}
              </Stack.Screen>
              <Stack.Screen name="Vm" options={{animation: 'slide_from_right'}}>
                {() => <VmScreen />}
              </Stack.Screen>
              <Stack.Screen name="Terminal" options={{animation: 'slide_from_right'}}>
                {() => <TerminalScreen />}
              </Stack.Screen>
            </>
          ) : (
            <Stack.Screen name="Login">
              {() => (
                <LoginScreen
                  onApproved={(s: SunlightSession) => props.onApproved(s)}
                />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </BottomSheetModalProvider>
    </NavigationContainer>
  );
}
