/**
 * ScanDeviceScreen — peer-to-peer device approval.
 *
 * A signed-in device scans the QR shown by a pending device (or types its
 * code manually) and approves it via POST /auth/device/approve-remote with
 * this session's Bearer key. When the approving subject has TOTP enabled the
 * gateway answers totp_required and an inline 6-digit step-up is revealed,
 * mirroring the console /device page behavior.
 *
 * This flow is deliberately SEPARATE from 2FA enrollment: parseLinkPayload
 * rejects otpauth:// and any non-linking payload before approval is attempted.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  type Code,
} from 'react-native-vision-camera';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {request, ApiError, isAuthExpired} from '../api/client';
import {parseLinkPayload} from '../auth/linkCode';
import {formatUserCode} from '../auth/deviceLogin';
import {SunlightSession} from '../auth/secure';
import {RootStackParamList} from '../../App';
import {monoFont} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';;

interface Props {
  session: SunlightSession;
  onSignOut: () => void;
}

type Phase = 'scanning' | 'busy' | 'approved' | 'totp' | 'error';

export default function ScanDeviceScreen({session, onSignOut}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const device = useCameraDevice('back');
  const {hasPermission, requestPermission} = useCameraPermission();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [message, setMessage] = useState('');
  const [pendingCode, setPendingCode] = useState('');
  const [approvedName, setApprovedName] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const handleAuthExpired = useCallback(() => {
    onSignOut();
  }, [onSignOut]);

  /** Approve a pending user code; retries with a TOTP code when required. */
  const approveRemote = useCallback(
    async (code: string, totp?: string) => {
      setPhase('busy');
      setMessage('');
      try {
        const res = await request<{name?: string}>('/auth/device/approve-remote', {
          method: 'POST',
          apiKey: session.apiKey,
          body: {user_code: code, ...(totp ? {totp_code: totp} : {})},
        });
        setApprovedName(res.name ?? `device/${formatUserCode(code)}`);
        setPhase('approved');
        setTimeout(() => navigation.goBack(), 1500);
      } catch (e) {
        if (isAuthExpired(e)) {
          handleAuthExpired();
          return;
        }
        if (e instanceof ApiError && e.type === 'totp_required') {
          setPendingCode(code);
          setTotpCode('');
          setPhase('totp');
          return;
        }
        if (e instanceof ApiError) {
          switch (e.type) {
            case 'totp_invalid':
              setMessage('invalid code');
              setPhase('totp');
              return;
            case 'rate_limited':
              setMessage('too many attempts, wait a minute');
              break;
            case 'not_found':
              setMessage('that code does not match a pending session');
              break;
            case 'expired':
              setMessage('the code expired; ask for a new one on the other device');
              break;
            case 'claimed':
              setMessage('that code was already approved');
              break;
            default:
              setMessage(e.message);
          }
        } else {
          setMessage(e instanceof Error ? e.message : 'network error');
        }
        setPhase('error');
      }
    },
    [session.apiKey, navigation, handleAuthExpired],
  );

  const onScanned = useCallback(
    (raw: string) => {
      // Only scanning phase accepts new payloads; busy/totp/approved ignore.
      if (phase !== 'scanning') {
        return;
      }
      const parsed = parseLinkPayload(raw);
      if (parsed.kind === 'invalid') {
        // Deliberately ignore non-linking payloads (e.g. otpauth:// QRs):
        // linking and 2FA are separate flows by design.
        setMessage('QR no válido para vincular devices');
        return;
      }
      void approveRemote(parsed.code);
    },
    [phase, approveRemote],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: Code[]) => {
      const value = codes[0]?.value;
      if (value) {
        onScanned(value);
      }
    },
  });

  const submitManual = useCallback(() => {
    const parsed = parseLinkPayload(manualCode);
    if (parsed.kind === 'invalid') {
      setMessage('invalid code');
      return;
    }
    void approveRemote(parsed.code);
  }, [manualCode, approveRemote]);

  const submitTotp = useCallback(() => {
    if (!/^\d{6}$/.test(totpCode)) {
      setMessage('invalid code');
      return;
    }
    void approveRemote(pendingCode, totpCode);
  }, [totpCode, pendingCode, approveRemote]);

  const cameraArea = useMemo(() => {
    if (!hasPermission) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.permText}>
            Sunlight needs the camera to scan the other device's code.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => requestPermission()}>
            <Text style={styles.buttonText}>allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => Linking.openSettings()}>
            <Text style={styles.linkText}>open settings</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (!device) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.permText}>no camera available</Text>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={phase === 'scanning'}
          codeScanner={codeScanner}
        />
        {/* Framed reticle: hairline box, no glow — where the QR should sit. */}
        <View pointerEvents="none" style={styles.reticleOuter}>
          <View style={styles.reticle} />
        </View>
      </View>
    );
  }, [hasPermission, device, phase, codeScanner]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backHit} onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{'‹ back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>authorize device</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.hint}>
        scan the QR shown by the device that wants to sign in, or enter its code manually.
      </Text>

      {cameraArea}

      {message !== '' && phase !== 'totp' && (
        <Text style={styles.error}>{message}</Text>
      )}

      {phase === 'busy' && (
        <View style={styles.row}>
          <ActivityIndicator color={c.success} />
          <Text style={styles.waiting}>approving…</Text>
        </View>
      )}

      {phase === 'approved' && (
        <View style={styles.approvedBox}>
          <Text style={styles.approvedTitle}>device approved</Text>
          <Text style={styles.approvedName}>{approvedName}</Text>
        </View>
      )}

      {phase === 'totp' && (
        <View style={styles.totpBox}>
          <Text style={styles.sectionTitle}>two-factor verification</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={totpCode}
            onChangeText={t => setTotpCode(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            placeholderTextColor={c.textTertiary}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            onSubmitEditing={submitTotp}
          />
          {message !== '' && <Text style={styles.error}>{message}</Text>}
          <TouchableOpacity style={styles.button} onPress={submitTotp}>
            <Text style={styles.buttonText}>confirm</Text>
          </TouchableOpacity>
        </View>
      )}

      {(phase === 'scanning' || phase === 'error') && !manualOpen && (
        <TouchableOpacity style={styles.linkButton} onPress={() => setManualOpen(true)}>
          <Text style={styles.linkText}>enter code manually</Text>
        </TouchableOpacity>
      )}

      {(phase === 'scanning' || phase === 'error') && manualOpen && (
        <View style={styles.manualBox}>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="ABCD-1234"
            placeholderTextColor={c.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            onSubmitEditing={submitManual}
          />
          <TouchableOpacity style={styles.button} onPress={submitManual}>
            <Text style={styles.buttonText}>approve code</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const RETICLE = 220;

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
    borderBottomColor: c.line,
    position: 'relative',
  },
  backHit: {
    position: 'absolute',
    left: 16,
    top: Platform.OS === 'ios' ? 54 : 14,
    bottom: 0,
    justifyContent: 'center',
  },
  back: {color: c.inkDim, fontSize: 13},
  headerTitle: {color: c.ink, fontSize: 17, fontWeight: '700'},
  headerSpacer: {width: 60},
  hint: {
    color: c.inkDim,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    backgroundColor: c.surface,
    paddingVertical: 32,
    gap: 14,
  },
  permText: {
    color: c.inkDim,
    textAlign: 'center',
    paddingHorizontal: 20,
    fontSize: 13,
    lineHeight: 19,
  },
  cameraWrap: {
    height: 300,
    marginHorizontal: 24,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.lineStrong,
  },
  reticleOuter: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  reticle: {
    width: RETICLE,
    height: RETICLE,
    borderWidth: 1,
    borderColor: c.inkDim,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, justifyContent: 'center'},
  waiting: {color: c.signal, fontSize: 13},
  error: {color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12},
  approvedBox: {
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    backgroundColor: c.surface,
    gap: 6,
  },
  approvedTitle: {color: c.signal, fontSize: 14},
  approvedName: {color: c.ink, fontFamily: monoFont, fontSize: 15},
  sectionTitle: {color: c.inkMute, fontSize: 13},
  totpBox: {
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    backgroundColor: c.surface,
    gap: 12,
    alignSelf: 'stretch',
  },
  manualBox: {
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    marginTop: 14,
    gap: 10,
  },
  input: {
    color: c.ink,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    alignSelf: 'stretch',
  },
  codeInput: {
    fontFamily: monoFont,
    letterSpacing: 3,
    textAlign: 'center',
  },
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
  linkButton: {marginTop: 16, alignItems: 'center'},
  linkText: {color: c.inkDim, textDecorationLine: 'underline', fontSize: 13},
});
}
