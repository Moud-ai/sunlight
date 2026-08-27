/**
 * VmConsoleScreen — the QEMU guest's serial console (root shell inside the VM).
 *
 * The guest console is `-serial stdio` on the QEMU process; VmModule buffers
 * its stdout and accepts stdin writes. This screen polls that buffer and
 * forwards typed lines, so you can drive the Alpine shell (and the agents
 * installed in it) directly.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {clearVmConsole, pollVmConsole, writeVmConsole, isVmRunning} from '../lib/vm';

export default function VmConsoleScreen(): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [vmAlive, setVmAlive] = useState(true);
  const scrollRef = useRef<any>(null);
  const vmAliveRef = useRef(true);

  useEffect(() => {
    isVmRunning()
      .then(running => {
        setVmAlive(running);
        vmAliveRef.current = running;
      })
      .catch(() => {
        setVmAlive(false);
        vmAliveRef.current = false;
      });
  }, []);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const chunk = await pollVmConsole();
        if (chunk) {
          setOutput(prev => (prev + chunk).slice(-200_000));
        }
        if (!vmAliveRef.current) {
          vmAliveRef.current = true;
          setVmAlive(true);
        }
      } catch {
        try {
          const alive = await isVmRunning();
          if (!alive) {
            vmAliveRef.current = false;
            setVmAlive(false);
          }
        } catch {
          vmAliveRef.current = false;
          setVmAlive(false);
        }
      }
    }, 100);
    return () => clearInterval(t);
  }, []);

  const send = useCallback(async (line: string) => {
    if (!line.trim()) {
      return;
    }
    try {
      await writeVmConsole(line + '\n');
    } catch {
      setVmAlive(false);
    }
    setInput('');
  }, []);

  const onClear = useCallback(() => {
    clearVmConsole().catch(() => {});
    setOutput('');
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>vm console</Text>
        <TouchableOpacity onPress={onClear}>
          <Text style={styles.clear}>clear</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.outputWrap}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({animated: true})}>
        <Text style={styles.output}>{output || '— vm console — boot the VM and run `root` / `sunlight`\n'}</Text>
      </ScrollView>
      {!vmAlive ? (
        <View style={styles.deadBanner}>
          <Text style={styles.deadText}>VM stopped — go back and restart</Text>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, !vmAlive && styles.inputDisabled]}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send(input)}
          placeholder={vmAlive ? 'command…' : 'VM stopped'}
          placeholderTextColor={c.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          editable={vmAlive}
        />
        <TouchableOpacity style={[styles.sendBtn, !vmAlive && styles.sendBtnDisabled]} onPress={() => send(input)} activeOpacity={0.7} disabled={!vmAlive}>
          <Text style={styles.sendText}>↵</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bg},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    title: {color: c.textPrimary, fontSize: typography.lg, fontFamily: typography.medium},
    clear: {color: c.accent, fontSize: typography.sm},
    scroll: {flex: 1},
    outputWrap: {paddingHorizontal: spacing.md, paddingBottom: 12},
    output: {
      color: c.textPrimary,
      fontFamily: typography.mono,
      fontSize: 12,
      lineHeight: 16,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      gap: 8,
    },
    input: {
      flex: 1,
      color: c.textPrimary,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: typography.sm,
      fontFamily: typography.mono,
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendText: {color: c.accentText, fontSize: 16},
    inputDisabled: {opacity: 0.5},
    sendBtnDisabled: {opacity: 0.5},
    deadBanner: {
      backgroundColor: '#3a1520',
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#8b2030',
    },
    deadText: {color: '#ff6b7a', fontSize: typography.sm, textAlign: 'center'},
  });
}