/**
 * Two-factor screen — TOTP enrollment and disable against the moud gateway.
 *
 * Disabled: setup -> POST /auth/2fa/setup returns {secret, otpauth_uri}; the
 * otpauth URI is rendered as a QR (white card behind the QR for scanner
 * contrast is intentional), with the base32 secret selectable below for manual
 * entry in Authy / Google Authenticator. Enable posts the 6-digit code.
 *
 * Enabled: status info + disable flow posting the current 6-digit code.
 *
 * Upstream error.type "totp_invalid" maps to an inline 'invalid code'.
 * A 401 signs the user out.
 */
import React, {useCallback, useEffect, useState, useMemo} from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import {request, ApiError, isAuthExpired} from '../api/client';
import {SunlightSession} from '../auth/secure';
import {RootStackParamList} from '../../App';
import {monoFont} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';;

interface Props {
  session: SunlightSession;
  onSignOut: () => void;
}

interface SetupResult {
  secret: string;
  otpauth_uri?: string;
  otpauthUri?: string;
}

export default function TwoFactorScreen({session, onSignOut}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);

  const [code, setCode] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [info, setInfo] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await request<{enabled: boolean}>('/auth/2fa', {
        apiKey: session.apiKey,
      });
      setEnabled(!!res.enabled);
      // Leaving setup mid-flow? A pending secret is discarded visually once
      // enabled flips; keep it otherwise so the QR stays scannable.
      if (res.enabled) {
        setSetup(null);
      }
    } catch (e) {
      if (isAuthExpired(e)) {
        onSignOut();
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'network error');
    } finally {
      setLoading(false);
    }
  }, [session.apiKey, onSignOut]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const beginSetup = useCallback(async () => {
    setSetupBusy(true);
    setCodeError('');
    setInfo('');
    try {
      const res = await request<SetupResult>('/auth/2fa/setup', {
        method: 'POST',
        apiKey: session.apiKey,
      });
      setSetup({secret: res.secret ?? '', otpauth_uri: res.otpauth_uri ?? res.otpauthUri});
    } catch (e) {
      if (isAuthExpired(e)) {
        onSignOut();
        return;
      }
      setCodeError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSetupBusy(false);
    }
  }, [session.apiKey, onSignOut]);

  /** Map upstream error types to inline copy; everything else is generic. */
  const codeErrorMessage = (e: unknown): string => {
    if (e instanceof ApiError && e.type === 'totp_invalid') {
      return 'invalid code';
    }
    if (e instanceof ApiError && e.status === 400) {
      return 'invalid code';
    }
    return (e as any)?.message ?? 'network error';
  };

  const submitCode = useCallback(
    async (action: 'enable' | 'disable') => {
      if (code.length !== 6 || submitBusy) {
        setCodeError('ingresá los 6 dígitos');
        return;
      }
      setSubmitBusy(true);
      setCodeError('');
      try {
        await request(`/auth/2fa/${action}`, {
          method: 'POST',
          body: {code},
          apiKey: session.apiKey,
        });
        setCode('');
        setSetup(null);
        setInfo(action === 'enable' ? 'verificación activada' : 'verificación desactivada');
        await loadStatus();
      } catch (e) {
        if (isAuthExpired(e)) {
          onSignOut();
          return;
        }
        setCodeError(codeErrorMessage(e));
      } finally {
        setSubmitBusy(false);
      }
    },
    [code, submitBusy, session.apiKey, loadStatus, onSignOut],
  );

  const otpauthUri = setup?.otpauth_uri ?? setup?.otpauthUri ?? '';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHit}
          onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{'‹ back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>seguridad</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <ActivityIndicator color={c.success} />
        ) : loadError !== '' ? (
          <>
            <Text style={styles.error}>{loadError}</Text>
            <TouchableOpacity style={styles.button} onPress={loadStatus}>
              <Text style={styles.buttonText}>Reintentar</Text>
            </TouchableOpacity>
          </>
        ) : enabled ? (
          <>
            <View style={styles.statusRow}>
              <Text style={styles.statusDot}>{'●'}</Text>
              <Text style={styles.statusText}>la verificación en dos pasos está activa</Text>
            </View>
            {info !== '' && <Text style={styles.info}>{info}</Text>}
            <TextInput
              style={[styles.codeInput]}
              value={code}
              onChangeText={t => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="123456"
              placeholderTextColor={c.textTertiary}
              keyboardType="number-pad"
              maxLength={6}
            />
            {codeError !== '' && <Text style={styles.error}>{codeError}</Text>}
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, submitBusy && styles.disabled]}
              onPress={() => submitCode('disable')}
              disabled={submitBusy}>
              <Text style={styles.buttonText}>
                {submitBusy ? 'procesando…' : 'Desactivar'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {!setup ? (
              <>
                <Text style={styles.hint}>
                  agregá una segunda capa con una app autenticadora (TOTP).
                </Text>
                {info !== '' && <Text style={styles.info}>{info}</Text>}
                <TouchableOpacity
                  style={[styles.button, setupBusy && styles.disabled]}
                  onPress={beginSetup}
                  disabled={setupBusy}>
                  <Text style={styles.buttonText}>
                    {setupBusy ? 'generando…' : 'Configurar 2FA'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.qrCard}>
                  <QRCode
                    value={otpauthUri || setup.secret}
                    size={190}
                    backgroundColor="#ffffff"
                    color="#0a0a0a"
                  />
                </View>
                <Text style={styles.hint}>
                  escaneá el QR con Authy / Google Authenticator o ingresá el
                  enter manually:
                </Text>
                <Text selectable style={styles.secret}>
                  {setup.secret}
                </Text>
                <TextInput
                  style={styles.codeInput}
                  value={code}
                  onChangeText={t => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="123456"
                  placeholderTextColor={c.textTertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {codeError !== '' && <Text style={styles.error}>{codeError}</Text>}
                <TouchableOpacity
                  style={[styles.button, submitBusy && styles.disabled]}
                  onPress={() => submitCode('enable')}
                  disabled={submitBusy}>
                  <Text style={styles.buttonText}>
                    {submitBusy ? 'verificando…' : 'Activar'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
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
    borderBottomColor: c.line,
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
  body: {padding: 24, gap: 12},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  statusDot: {color: c.signal, fontFamily: monoFont},
  statusText: {color: c.ink, fontSize: 15},
  hint: {color: c.inkDim, fontSize: 13, lineHeight: 19},
  info: {color: c.signal, fontSize: 13},
  qrCard: {
    alignSelf: 'center',
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  secret: {
    alignSelf: 'center',
    color: c.ink,
    fontSize: 15,
    letterSpacing: 1,
    fontFamily: monoFont,
    paddingVertical: 6,
  },
  codeInput: {
    color: c.ink,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 20,
    letterSpacing: 8,
    textAlign: 'center',
    fontFamily: monoFont,
  },
  error: {color: c.danger, fontSize: 13},
  button: {
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.lineStrong,
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
  },
  dangerButton: {borderColor: c.danger},
  buttonText: {color: c.ink, fontWeight: '600', fontSize: 15},
  disabled: {opacity: 0.45},
});
}
