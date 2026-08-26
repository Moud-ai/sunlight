/**
 * ProfileScreen — full-bleed identity screen, distinct from Settings.
 *
 * Swiss International Style: pure black hero top half with a large centered
 * avatar (image or big letter-mark), prominent display name, small mono
 * subject line; then a hairline-separated action list and an always-visible
 * inverted 'sign out' button. Read-only by design.
 */
import React, {useEffect, useState, useMemo} from 'react';
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {RootStackParamList} from '../../App';
import {typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';;
import {SunlightSession} from '../auth/secure';
import {fetchOwnProfile} from '../lib/profile';
import {fetchUserQuota, QuotaInfo} from '../lib/quota';
import {initialFor} from '../lib/avatar';

const MOUD_WEB_PROFILE_URL = 'https://mound.opceanai.com/dashboard/profile';

interface Props {
  session: SunlightSession;
  onSignOut: () => void;
}

export default function ProfileScreen({session, onSignOut}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  // Profile + quota load once on mount. Both helpers never throw and are
  // cached upstream, so remounts are cheap and failures degrade to fallbacks.
  useEffect(() => {
    let alive = true;
    fetchOwnProfile(session.apiKey, session.subject).then(profile => {
      if (!alive) {
        return;
      }
      setAvatarUrl(profile.avatarUrl ?? null);
      setDisplayName(profile.displayName ?? null);
    });
    fetchUserQuota(session.apiKey, {
      onError: (status, type) =>
        setQuotaError(`quota unavailable (${status} ${type})`),
    }).then(q => {
      if (alive) {
        if (q != null) {
          setQuotaError(null);
        }
        setQuota(q);
      }
    });
    return () => {
      alive = false;
    };
  }, [session.apiKey, session.subject]);

  const name = displayName || session.subject || '';
  const letter = initialFor(displayName, session.subject);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Back affordance — thin chevron, native stack handles the rest */}
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => navigation.goBack()}
        hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
        <Text style={styles.backChevron}>{'‹'}</Text>
      </TouchableOpacity>

      {/* Hero — full-bleed black, centered identity */}
      <View style={styles.hero}>
        {avatarUrl ? (
          <Image source={{uri: avatarUrl}} style={styles.avatarImage} />
        ) : (
          <View style={[styles.avatarImage, styles.avatarFallback]}>
            <Text style={styles.avatarLetter}>{letter}</Text>
          </View>
        )}
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.subject} numberOfLines={1}>
          {session.subject}
        </Text>
      </View>

      {/* Actions — hairline rows, uppercase micro-labels */}
      <View style={styles.actions}>
        <View style={styles.rowDivider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            Linking.openURL(MOUD_WEB_PROFILE_URL).catch(() => {});
          }}>
          <Text style={styles.rowLabel}>EDIT ON MOUD WEB</Text>
          <Text style={styles.rowAction}>{'>'}</Text>
        </TouchableOpacity>
        <View style={styles.rowDivider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>QUOTA</Text>
          <Text style={styles.rowValue}>
            {quotaError
              ? quotaError
              : quota
                ? quota.limit > 0
                  ? `${quota.used}/${quota.limit} · ${quota.remaining} left`
                  : `${quota.used} used`
                : '-'}
          </Text>
        </View>
        <View style={styles.rowDivider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('Settings', {session})}>
          <Text style={styles.rowLabel}>SETTINGS</Text>
          <Text style={styles.rowAction}>{'>'}</Text>
        </TouchableOpacity>
        <View style={styles.rowDivider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('Harnesses')}>
          <Text style={styles.rowLabel}>HARNESS AGENTS</Text>
          <Text style={styles.rowAction}>{'>'}</Text>
        </TouchableOpacity>
        <View style={styles.rowDivider} />
      </View>

      {/* Always-visible sign-out surface — inverted white, destructive label */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
          <Text style={styles.signOutText}>sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: c.bg,
  },
  backBtn: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    zIndex: 10,
  },
  backChevron: {
    color: c.textSecondary,
    fontSize: typography.xxl,
    fontFamily: typography.sans,
    lineHeight: typography.xxxl,
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarFallback: {
    backgroundColor: c.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: c.textPrimary,
    fontSize: typography.xxxl,
    fontFamily: typography.medium,
  },
  name: {
    marginTop: spacing.lg,
    color: c.textPrimary,
    fontSize: typography.xxl,
    fontFamily: typography.semiBold,
    maxWidth: '80%',
  },
  subject: {
    marginTop: spacing.xs,
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
  },
  actions: {
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  rowLabel: {
    color: c.textPrimary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 1.5,
  },
  rowValue: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
  rowAction: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  signOutBtn: {
    backgroundColor: c.accent,
    borderRadius: 4,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  signOutText: {
    color: c.danger,
    fontSize: typography.md,
    fontFamily: typography.medium,
  },
});
}
