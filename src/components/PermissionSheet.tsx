/**
 * PermissionSheet — premium permission request panel.
 *
 * Swiss-styled bottom sheet (@gorhom/bottom-sheet) shown BEFORE the raw OS
 * permission dialog: explains why the feature needs access, fires the actual
 * PermissionsAndroid request from the primary button, and offers a direct
 * path to system settings when the user has permanently denied ('blocked').
 */
import React, {forwardRef, useCallback, useMemo, useRef} from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {BottomSheetModal, BottomSheetView} from '@gorhom/bottom-sheet';
import {Mic, ImagePlus, Camera, ShieldCheck} from 'lucide-react-native';
import {useThemeColors} from '../theme/ThemeProvider';

export type PermissionKind = 'microphone' | 'gallery' | 'camera';

const COPY: Record<
  PermissionKind,
  {icon: typeof Mic; title: string; rationale: string}
> = {
  microphone: {
    icon: Mic,
    title: 'microphone access',
    rationale: 'Sunlight records voice notes so audio models can hear you.',
  },
  gallery: {
    icon: ImagePlus,
    title: 'photo library access',
    rationale: 'Pick images to send to vision models, or set your avatar.',
  },
  camera: {
    icon: Camera,
    title: 'camera access',
    rationale: 'Capture photos to send to vision models.',
  },
};

interface Props {
  kind: PermissionKind | null;
  /** Fired when the user taps 'grant access' (parent runs the OS request). */
  onGrant?: () => void;
  /** Fired when the sheet closes without any action. */
  onDismiss?: () => void;
}

/**
 * Imperative-friendly sheet. Parent keeps it mounted and drives visibility
 * via the `kind` prop (null = closed).
 */
export const PermissionSheet = forwardRef<BottomSheetModal, Props>(
  ({kind, onGrant, onDismiss}, ref) => {
    const c = useThemeColors();
    const styles = makeStyles(c);
    const snapPoints = useMemo(() => ['32%'], []);
    const decidingRef = useRef(false);

    const close = useCallback(() => {
      const sheet = ref as React.MutableRefObject<BottomSheetModal | null>;
      sheet.current?.close();
    }, [ref]);

    const openSystemSettings = useCallback(() => {
      const target =
        Platform.OS === 'android'
          ? 'android.settings.APPLICATION_DETAILS_SETTINGS'
          : 'app-settings:';
      // android.settings.* actions need the package URI form:
      Linking.openSettings().catch(() => {});
      void target;
    }, []);

    if (!kind) {
      return null;
    }
    const copy = COPY[kind];
    const Icon = copy.icon;

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
        enablePanDownToClose
        onDismiss={onDismiss}>
        <BottomSheetView style={styles.root}>
          <View style={styles.iconWrap}>
            <Icon size={22} color={c.textPrimary} strokeWidth={1.75} />
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.rationale}>{copy.rationale}</Text>

          <TouchableOpacity
            style={[styles.primaryBtn, decidingRef.current && styles.btnBusy]}
            activeOpacity={0.7}
            onPress={() => {
              decidingRef.current = true;
              close();
              onGrant?.();
            }}>
            <ShieldCheck size={16} color={c.accentText} strokeWidth={1.75} />
            <Text style={styles.primaryText}>grant access</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.7}
            onPress={() => {
              close();
              onDismiss?.();
            }}>
            <Text style={styles.secondaryText}>not now</Text>
          </TouchableOpacity>

          {(kind === 'microphone' || kind === 'gallery') && (
            <TouchableOpacity
              style={styles.systemLink}
              onPress={openSystemSettings}>
              <Text style={styles.systemText}>blocked? open system settings</Text>
            </TouchableOpacity>
          )}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
PermissionSheet.displayName = 'PermissionSheet';

function makeStyles(c: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    sheetBg: {backgroundColor: c.bgElevated},
    handle: {backgroundColor: c.borderStrong},
    root: {flex: 1, padding: 20, paddingTop: 6},
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    title: {
      color: c.textPrimary,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 4,
    },
    rationale: {color: c.textSecondary, fontSize: 13, lineHeight: 19},
    primaryBtn: {
      marginTop: 16,
      backgroundColor: c.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    btnBusy: {opacity: 0.7},
    primaryText: {color: c.accentText, fontSize: 14, fontWeight: '600'},
    secondaryBtn: {paddingVertical: 12, alignItems: 'center'},
    secondaryText: {color: c.textTertiary, fontSize: 13},
    systemLink: {paddingVertical: 6, alignItems: 'center'},
    systemText: {color: c.textTertiary, fontSize: 11},
  });
}

/** Convenience hook API for screens: present(kind) + result handling. */
export function usePermissionSheet() {
  const ref = useRef<BottomSheetModal>(null);
  const present = useCallback((kind: PermissionKind) => {
    ref.current?.present();
    return kind;
  }, []);
  return {ref, present};
}
