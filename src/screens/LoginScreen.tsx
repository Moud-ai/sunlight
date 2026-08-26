/**
 * Login screen — device-code flow only.
 *
 * Shows a QR + 8-character code for approval at mound.opceanai.com/device.
 * No email/password or OAuth login methods — those were removed to simplify
 * the flow and avoid confusion with the console's own login.
 *
 * If the server approves but persisting the session to the device vault fails,
 * the login still proceeds (the key lives in memory for this run) and a
 * non-blocking warning is surfaced through onApproved.
 */
import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  startDeviceLogin,
  pollDeviceLogin,
  buildVerificationDeepLink,
  formatUserCode,
  DeviceStartResult,
  DeviceApproval,
  PollStatus,
} from '../auth/deviceLogin';
import {saveSession, getLockMode, SunlightSession} from '../auth/secure';
import {monoFont} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';;

type Phase = 'idle' | 'waiting' | 'approved' | 'expired' | 'error';

export interface ApprovalOptions {
  persistError?: boolean;
}

interface Props {
  onApproved: (session: SunlightSession, opts?: ApprovalOptions) => void;
}

export default function LoginScreen({onApproved}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [grant, setGrant] = useState<DeviceStartResult | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleApproval = useCallback(
    async (approval: DeviceApproval) => {
      const session: SunlightSession = {
        apiKey: approval.apiKey,
        keyId: approval.keyId,
        subject: approval.subject,
      };
      let persisted = true;
      try {
        await saveSession(session, await getLockMode());
      } catch {
        persisted = false;
      }
      setPhase('approved');
      onApproved(session, persisted ? undefined : {persistError: true});
    },
    [onApproved],
  );

  const begin = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError('');
    try {
      const g = await startDeviceLogin();
      setGrant(g);
      setPhase('waiting');
      const approval = await pollDeviceLogin(
        g.deviceCode,
        g.interval,
        (s: PollStatus) => {
          if (s === 'expired') {
            setPhase('expired');
          }
        },
        ac.signal,
        g.expiresIn,
      );
      if (approval) {
        await handleApproval(approval);
      } else if (!ac.signal.aborted) {
        setPhase(p => (p === 'waiting' ? 'expired' : p));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
      setPhase('error');
    }
  }, [handleApproval]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const qrValue = grant
    ? buildVerificationDeepLink(grant.verificationUrl, grant.userCode)
    : '';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Sunlight</Text>
      <Text style={styles.subtitle}>your gateway to moud</Text>

      {phase === 'idle' && (
        <>
          <TouchableOpacity style={styles.button} onPress={begin}>
            <Text style={styles.buttonText}>Sign in with device code</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            show this code at mound.opceanai.com/device or scan the QR with
            your phone camera
          </Text>
        </>
      )}

      {phase === 'waiting' && grant && (
        <View style={styles.card}>
          <View style={styles.qrCard}>
            <QRCode value={qrValue} size={200} backgroundColor="#ffffff" color="#0a0a0a" />
          </View>
          <Text style={styles.code}>{formatUserCode(grant.userCode)}</Text>
          <Text style={styles.hint}>
            scan the QR or enter the code at mound.opceanai.com/device to
            approve this device
          </Text>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => Linking.openURL(grant.verificationUrl)}>
            <Text style={styles.linkText}>Open {grant.verificationUrl}</Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <ActivityIndicator color={c.success} />
            <Text style={styles.waiting}>waiting for approval…</Text>
          </View>
        </View>
      )}

      {phase === 'expired' && (
        <>
          <Text style={styles.warn}>The code expired.</Text>
          <TouchableOpacity style={styles.button} onPress={begin}>
            <Text style={styles.buttonText}>Generate new code</Text>
          </TouchableOpacity>
        </>
      )}

      {phase === 'error' && (
        <>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.button} onPress={begin}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: c.bg,
  },
  title: {color: c.ink, fontSize: 34, fontWeight: '800'},
  subtitle: {color: c.inkDim, marginTop: 6, marginBottom: 28},
  card: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.lineStrong,
    backgroundColor: c.surface,
    width: '100%',
  },
  qrCard: {
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  code: {
    color: c.ink,
    fontSize: 28,
    letterSpacing: 4,
    fontWeight: '700',
    marginTop: 16,
    fontFamily: monoFont,
  },
  hint: {color: c.inkDim, textAlign: 'center', marginTop: 10, fontSize: 13, lineHeight: 19},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14},
  waiting: {color: c.signal, fontSize: 13},
  button: {
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 24,
    paddingVertical: 13,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  buttonText: {color: c.ink, fontWeight: '600', fontSize: 15},
  linkButton: {marginTop: 14},
  linkText: {color: c.inkDim, textDecorationLine: 'underline', fontSize: 13},
  warn: {color: c.warn, marginBottom: 16},
  error: {color: c.danger, marginBottom: 12, textAlign: 'center'},
});
}
