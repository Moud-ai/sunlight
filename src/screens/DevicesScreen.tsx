/**
 * Devices screen — lists linked devices for the signed-in subject and allows
 * unlinking with a two-step confirm. "link another device" restarts the
 * device-code start/poll loop (same payload shape as login) so another phone
 * can be approved while this session stays alive.
 *
 * All calls carry `Authorization: Bearer <session.apiKey>`; a 401 signs the
 * user out.
 */
import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import {request, isAuthExpired} from '../api/client';
import {
  startDeviceLogin,
  pollDeviceLogin,
  buildVerificationDeepLink,
  formatUserCode,
  DeviceStartResult,
} from '../auth/deviceLogin';
import {SunlightSession} from '../auth/secure';
import {RootStackParamList} from '../../App';
import {typography} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';;
import {formatDeviceName} from '../lib/deviceName';

interface DeviceRow {
  key_id: string;
  name: string;
  created_at: string;
  status: string;
}

type LinkPhase = 'idle' | 'waiting' | 'expired' | 'error';

interface Props {
  session: SunlightSession;
  onSignOut: () => void;
}

export default function DevicesScreen({session, onSignOut}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [unlinkError, setUnlinkError] = useState('');

  // "link another device" flow state.
  const [linkPhase, setLinkPhase] = useState<LinkPhase>('idle');
  const [grant, setGrant] = useState<DeviceStartResult | null>(null);
  const [linkError, setLinkError] = useState('');
  const linkAbortRef = useRef<AbortController | null>(null);

  const handleAuthExpired = useCallback(() => {
    onSignOut();
  }, [onSignOut]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError('');
      try {
        const res = await request<{devices: DeviceRow[]}>('/auth/devices', {
          apiKey: session.apiKey,
        });
        setDevices(res.devices ?? []);
      } catch (e) {
        if (isAuthExpired(e)) {
          handleAuthExpired();
          return;
        }
        setError(e instanceof Error ? e.message : 'network error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session.apiKey, handleAuthExpired],
  );

  useEffect(() => {
    load('initial');
    return () => linkAbortRef.current?.abort();
  }, [load]);

  /** Two-step confirm: first tap arms the row, second tap revokes. */
  const unlink = useCallback(
    async (keyId: string) => {
      if (confirmId !== keyId) {
        setConfirmId(keyId);
        setUnlinkError('');
        return;
      }
      setUnlinkBusy(true);
      setUnlinkError('');
      try {
        await request(`/auth/devices/${encodeURIComponent(keyId)}`, {
          method: 'DELETE',
          apiKey: session.apiKey,
        });
        setConfirmId(null);
        await load('refresh');
      } catch (e) {
        if (isAuthExpired(e)) {
          handleAuthExpired();
          return;
        }
        setUnlinkError(e instanceof Error ? e.message : 'could not unlink');
      } finally {
        setUnlinkBusy(false);
      }
    },
    [confirmId, session.apiKey, load, handleAuthExpired],
  );

  const beginLink = useCallback(async () => {
    linkAbortRef.current?.abort();
    const ac = new AbortController();
    linkAbortRef.current = ac;
    setLinkError('');
    try {
      const g = await startDeviceLogin();
      setGrant(g);
      setLinkPhase('waiting');
      const approval = await pollDeviceLogin(
        g.deviceCode,
        g.interval,
        s => {
          if (s === 'expired') {
            setLinkPhase('expired');
          }
        },
        ac.signal,
        g.expiresIn,
      );
      if (approval) {
        // The new key belongs to the other device; just refresh the list.
        setGrant(null);
        setLinkPhase('idle');
        await load('refresh');
      } else if (!ac.signal.aborted) {
        setLinkPhase(p => (p === 'waiting' ? 'expired' : p));
      }
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'network error');
      setLinkPhase('error');
    }
  }, [load]);

  const renderRow = ({item}: {item: DeviceRow}) => {
    const armed = confirmId === item.key_id;
    return (
      <View style={styles.row}>
        <Text style={styles.rowName} numberOfLines={1}>
          {formatDeviceName(item.name)}
        </Text>
        <Text style={styles.rowDate}>
          {item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}
        </Text>
        <View style={styles.rowEnd}>
          <Text
            style={[
              styles.rowStatus,
              item.status === 'revoked' ? styles.statusRevoked : styles.statusActive,
            ]}>
            {item.status === 'revoked' ? 'revoked' : 'active'}
          </Text>
          {item.status !== 'revoked' && (
            <TouchableOpacity
              style={[styles.unlinkButton, armed && styles.unlinkArmed]}
              onPress={() => unlink(item.key_id)}
              disabled={unlinkBusy}>
              <Text style={styles.unlinkText}>
                {armed
                  ? unlinkBusy
                    ? '…'
                    : 'confirm'
                  : 'unlink'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHit}
          onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{'‹ back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>devices</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.success} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={devices}
          keyExtractor={item => item.key_id}
          renderItem={renderRow}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>no hay devices vinculados</Text>
            </View>
          }
          ListHeaderComponent={
            error !== '' ? <Text style={styles.error}>{error}</Text> : undefined
          }
          ListFooterComponent={
            <>
              {unlinkError !== '' && (
                <Text style={styles.error}>{unlinkError}</Text>
              )}

              {linkPhase === 'idle' && (
                <>
                    <TouchableOpacity style={styles.button} onPress={beginLink}>
                    <Text style={styles.buttonText}>link another device</Text>
                    </TouchableOpacity>
                  <Text style={styles.actionHint}>
                    show a code for approval at mound.opceanai.com or
                    con la cámara del teléfono
                  </Text>
                  <TouchableOpacity
                    style={[styles.button, styles.scanButton]}
                    onPress={() => navigation.navigate('ScanDevice', {session})}>
                    <Text style={styles.buttonText}>authorize another device</Text>
                  </TouchableOpacity>
                  <Text style={styles.actionHint}>
                    scan the other device's QR and approve it
                    al instante
                  </Text>
                  <TouchableOpacity
                    style={[styles.button, styles.vmButton]}
                    onPress={() => navigation.navigate('Vm')}>
                    <Text style={styles.buttonText}>virtual machine</Text>
                  </TouchableOpacity>
                  <Text style={styles.actionHint}>
                    QEMU Alpine guest — agents run inside it
                  </Text>
                </>
              )}

              {linkPhase === 'waiting' && grant && (
                <View style={styles.linkCard}>
                  <View style={styles.qrCard}>
                    <QRCode
                      value={buildVerificationDeepLink(
                        grant.verificationUrl,
                        grant.userCode,
                      )}
                      size={170}
                      backgroundColor="#ffffff"
                      color="#0a0a0a"
                    />
                  </View>
                  <Text style={styles.linkCode}>{formatUserCode(grant.userCode)}</Text>
                  <View style={styles.waitingRow}>
                    <ActivityIndicator color={c.success} />
                    <Text style={styles.waiting}>waiting for approval…</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.linkOpen}
                    onPress={() => Linking.openURL(grant.verificationUrl)}>
                    <Text style={styles.linkOpenText}>Abrir {grant.verificationUrl}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {linkPhase === 'expired' && (
                <>
                  <Text style={styles.warn}>The code expired.</Text>
                  <TouchableOpacity style={styles.button} onPress={beginLink}>
                    <Text style={styles.buttonText}>Generate new code</Text>
                  </TouchableOpacity>
                </>
              )}

              {linkPhase === 'error' && (
                <>
                  <Text style={styles.error}>{linkError}</Text>
                  <TouchableOpacity style={styles.button} onPress={beginLink}>
                    <Text style={styles.buttonText}>Reintentar</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={c.success}
            />
          }
        />
      )}
    </View>
  );
}

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
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    position: 'relative',
  },
  backHit: {position: 'absolute', left: 16, top: Platform.OS === 'ios' ? 54 : 14, bottom: 0, justifyContent: 'center'},
  back: {color: c.textSecondary, fontSize: 13},
  headerTitle: {color: c.textPrimary, fontSize: 17, fontWeight: '700'},
  headerSpacer: {width: 60},
  list: {flex: 1, paddingHorizontal: 16},
  center: {alignItems: 'center', justifyContent: 'center', paddingVertical: 32},
  empty: {color: c.textTertiary, fontSize: 14},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    gap: 10,
  },
  rowName: {flex: 1.4, color: c.textPrimary, fontSize: 14},
  rowDate: {flex: 1, color: c.textSecondary, fontSize: 12, fontFamily: typography.mono},
  rowEnd: {flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8},
  rowStatus: {fontSize: 12},
  statusActive: {color: c.success},
  statusRevoked: {color: c.danger},
  unlinkButton: {
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 6,
    backgroundColor: c.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  unlinkArmed: {borderColor: c.danger},
  unlinkText: {color: c.textPrimary, fontSize: 12},
  error: {color: c.danger, fontSize: 13, textAlign: 'center', paddingVertical: 10},
  warn: {color: c.warning, fontSize: 13, textAlign: 'center', paddingVertical: 10},
  button: {
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
  },
  scanButton: {marginTop: 26},
  vmButton: {marginTop: 26},
  actionHint: {
    color: c.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    lineHeight: 17,
  },
  buttonText: {color: c.textPrimary, fontWeight: '600', fontSize: 15},
  linkCard: {
    alignItems: 'center',
    marginTop: 20,
    padding: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.bgSurface,
  },
  qrCard: {padding: 10, borderRadius: 6, backgroundColor: '#ffffff'},
  linkCode: {
    color: c.textPrimary,
    fontSize: 22,
    letterSpacing: 3,
    fontWeight: '700',
    marginTop: 14,
    fontFamily: typography.mono,
  },
  waitingRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12},
  waiting: {color: c.success, fontSize: 13},
  linkOpen: {marginTop: 12},
  linkOpenText: {color: c.textSecondary, textDecorationLine: 'underline', fontSize: 12},
});
}
