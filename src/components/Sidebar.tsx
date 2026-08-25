/**
 * Sidebar — chat history + navigation.
 *
 * Swiss International Style: pure black canvas, sections separated by
 * whitespace (no full-width row borders), uppercase micro-labels with
 * letterspacing, inverted white primary button, no cards/shadows/gradients/
 * emojis.
 *
 * Motion: open/close animated with react-native-reanimated — the panel slides
 * translateX -280 -> 0 (~260ms ease-out) while the overlay fades in; the
 * sidebar stays mounted during the exit animation and unmounts after it
 * completes. Delete uses a two-step inline confirm that auto-resets after
 * 2.5s instead of deleting on long-press directly.
 */
import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';;
import {initialFor} from '../lib/avatar';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
}

interface Props {
  visible: boolean;
  currentChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onSettings: () => void;
  onClose: () => void;
  /** Tap target for the top identity row -> Profile screen. */
  onRequestProfile?: () => void;
  /** Optional profile avatar shown with the subject line at the top. */
  avatarUrl?: string | null;
  /** Optional subject line rendered next to the avatar. */
  subject?: string;
}

const CHATS_KEY = '@sunlight_chats';
const PANEL_WIDTH = 280;
/** How long a row stays in its 'delete?' confirm state before resetting. */
const DELETE_CONFIRM_MS = 2500;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return d.toLocaleDateString();
}

export function Sidebar({
  visible,
  currentChatId,
  onSelectChat,
  onNewChat,
  onSettings,
  onClose,
  onRequestProfile,
  avatarUrl,
  subject,
}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [chats, setChats] = useState<ChatSession[]>([]);
  // Chat id currently showing its inline 'delete?' confirm state.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep mounted while an exit animation is running; unmount after it ends.
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (!visible || mounted) {
      return;
    }
    setMounted(true);
  }, [visible, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    progress.value = withTiming(
      visible ? 1 : 0,
      {duration: 260, easing: Easing.out(Easing.ease)},
      finished => {
        if (finished && !visible) {
          runOnJS(setMounted)(false);
        }
      },
    );
  }, [visible, mounted, progress]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    AsyncStorage.getItem(CHATS_KEY)
      .then(raw => {
        if (raw) setChats(JSON.parse(raw));
      })
      .catch(() => {});
  }, [visible]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) {
        clearTimeout(confirmTimer.current);
      }
    };
  }, []);

  const armDelete = useCallback((id: string) => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
    }
    setPendingDeleteId(id);
    confirmTimer.current = setTimeout(() => setPendingDeleteId(null), DELETE_CONFIRM_MS);
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      if (confirmTimer.current) {
        clearTimeout(confirmTimer.current);
        confirmTimer.current = null;
      }
      setPendingDeleteId(null);
      const next = chats.filter(c => c.id !== id);
      setChats(next);
      await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(next));
    },
    [chats],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{translateX: -PANEL_WIDTH * (1 - progress.value)}],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  if (!mounted) {
    return null;
  }

  const letter = initialFor(null, subject);

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Scrim — fades with the same progress as the panel */}
      <AnimatedTouchable
        style={[styles.overlay, overlayStyle]}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Panel */}
      <Animated.View style={[styles.panel, panelStyle]}>
        {/* Identity block — tap opens the Profile screen */}
        <TouchableOpacity
          style={styles.identity}
          onPress={() => {
            onClose();
            onRequestProfile?.();
          }}>
          <View style={styles.avatarWrap}>
            {avatarUrl ? (
              <Image source={{uri: avatarUrl}} style={styles.avatar} />
            ) : (
              <Text style={styles.avatarLetter}>{letter}</Text>
            )}
          </View>
          <Text style={styles.subject} numberOfLines={1}>
            {subject || ' '}
          </Text>
        </TouchableOpacity>

        {/* New chat — inverted contrast: white fill, black label */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.newChatBtn} onPress={onNewChat}>
            <Text style={styles.newChatText}>+ new chat</Text>
          </TouchableOpacity>
        </View>

        {/* History list */}
        <Text style={styles.sectionLabel}>HISTORY</Text>
        <FlatList
          data={chats}
          keyExtractor={item => item.id}
          renderItem={({item}) => {
            const active = item.id === currentChatId;
            const confirming = item.id === pendingDeleteId;
            return (
              <TouchableOpacity
                style={[styles.chatItem, active && styles.chatItemActive]}
                onPress={() => {
                  if (confirming) {
                    deleteChat(item.id);
                    return;
                  }
                  onSelectChat(item.id);
                  onClose();
                }}
                onLongPress={() => armDelete(item.id)}>
                {active && <View style={styles.activeBar} />}
                {confirming ? (
                  <Text style={styles.deleteConfirm}>delete?</Text>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.chatTitle,
                        active && styles.chatTitleActive,
                      ]}
                      numberOfLines={1}>
                      {item.title || 'untitled'}
                    </Text>
                    <Text style={styles.chatTime}>
                      {formatTime(item.createdAt)}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>no conversations yet</Text>
            </View>
          }
        />

        {/* Footer — settings row with chevron */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.settingsBtn} onPress={onSettings}>
            <Text style={styles.settingsText}>settings</Text>
            <Text style={styles.settingsChevron}>{'>'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export {CHATS_KEY};

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.bgOverlay,
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: c.bg,
    borderRightWidth: 1,
    borderRightColor: c.border,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  avatarWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarLetter: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  subject: {
    flex: 1,
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  header: {
    padding: spacing.lg,
  },
  newChatBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: c.accent,
    borderRadius: 4,
    alignItems: 'center',
  },
  newChatText: {
    color: c.accentText,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  sectionLabel: {
    color: c.textTertiary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingTop: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chatItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    justifyContent: 'center',
  },
  chatItemActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: c.accent,
  },
  chatTitle: {
    color: c.textSecondary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
  },
  chatTitleActive: {
    color: c.textPrimary,
    fontFamily: typography.medium,
  },
  chatTime: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.sans,
    marginTop: spacing.xs,
  },
  deleteConfirm: {
    color: c.danger,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  emptyState: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  settingsText: {
    color: c.textSecondary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
  },
  settingsChevron: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
});
}
