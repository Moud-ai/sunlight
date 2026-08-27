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
import {clearVmConsole, pollVmConsole, writeVmConsole} from '../lib/vm';

export default function VmConsoleScreen(): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const scrollRef = useRef<any>(null);
  const outputRef = useRef('');
  outputRef.current = output;

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const chunk = await pollVmConsole();
        if (chunk) {
          setOutput(prev => (prev + chunk).slice(-200_000));
        }
      } catch {
        // VM stopped
      }
    }, 120);
    return () => clearInterval(t);
  }, []);

  const send = useCallback(async (line: string) => {
    if (!line.trim()) {
      return;
    }
    try {
      await writeVmConsole(line + '\n');
      setOutput(prev => prev + line + '\n');
    } catch {
      // VM not running
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
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send(input)}
          placeholder="command…"
          placeholderTextColor={c.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => send(input)} activeOpacity={0.7}>
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
  });
}