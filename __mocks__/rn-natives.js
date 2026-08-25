jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly'},
  ACCESS_CONTROL: {BIOMETRY_CURRENT_SET: 'BiometryCurrentSet'},
  setGenericPassword: jest.fn().mockResolvedValue({service: 's', storage: 'k'}),
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));
jest.mock('react-native-biometrics', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    isSensorAvailable: jest.fn().mockResolvedValue({available: 'FaceID'}),
    simplePrompt: jest.fn().mockResolvedValue({success: true}),
  })),
}));
jest.mock('react-native-qrcode-svg', () => 'RnQRCodeSvg');
jest.mock('react-native-vision-camera', () => ({
  __esModule: true,
  useCameraDevice: () => null,
  useCameraPermission: () => ({
    hasPermission: false,
    requestPermission: async () => false,
  }),
  useCodeScanner: (opts) => opts ?? {},
  Camera: 'RNCamera',
}));
jest.mock('react-native-app-auth', () => ({}));
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const passthrough = ({children}: any) => React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    default: {HandlerStateThreshold: {}, Directions: {}},
    GestureHandlerRootView: passthrough,
    TouchableOpacity: passthrough,
    PanGestureHandler: passthrough,
  };
});
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({children}: any) => children ?? null,
  useNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({children}: any) => children ?? null,
    Screen: (_props: any) => null,
  }),
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  default: () => ({
    requestPermission: jest.fn().mockResolvedValue(1),
    getToken: jest.fn().mockResolvedValue('mock-fcm-token'),
    onTokenRefresh: jest.fn(),
    onMessage: jest.fn().mockReturnValue(jest.fn()),
    AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({children}: any) => children ?? null,
    Screen: (_props: any) => null,
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
      setItem: jest.fn((key: string, val: string) => { store[key] = val; return Promise.resolve(); }),
      removeItem: jest.fn((key: string) => { delete store[key]; return Promise.resolve(); }),
      multiGet: jest.fn((keys: string[]) => Promise.resolve(keys.map(k => [k, store[k] ?? null]))),
      multiSet: jest.fn((pairs: [string, string][]) => { pairs.forEach(([k, v]) => { store[k] = v; }); return Promise.resolve(); }),
    },
  };
});

// Reanimated 4 under the RN jest preset: setUpTests() alone is not enough.
// The official `require('react-native-reanimated/mock')` pattern was tried
// first, but its src/mock.ts re-exports from src/index.ts which resolves to
// .native initializers and evaluates the real react-native-worklets native
// module at import time -> "Cannot read properties of undefined (reading
// 'loadUnpackersWithCode')". So we register the same instantly-settling mock
// inline instead: animations resolve synchronously (callbacks fire with
// finished=true) and animated components pass straight through to RN.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const {
    View,
    Text,
    Image,
    ScrollView,
    FlatList,
  } = require('react-native');

  const NOOP = () => {};
  const ID = t => t;

  const withTiming = (toValue, _config, callback) => {
    if (callback) {
      callback(true);
    }
    return toValue;
  };
  const withSpring = withTiming;
  const withDelay = (_delayMs, nextAnimation) => nextAnimation;
  const ease = t => t;

  const passthrough = Component =>
    React.forwardRef((props, ref) =>
      React.createElement(Component, Object.assign({}, props, {ref})),
    );

  const Animated = {
    createAnimatedComponent: passthrough,
    View: passthrough(View),
    Text: passthrough(Text),
    Image: passthrough(Image),
    ScrollView: passthrough(ScrollView),
    FlatList: FlatList,
  };

  return {
    __esModule: true,
    default: Animated,
    Animated,
    useSharedValue: init => ({value: init}),
    useAnimatedStyle: updater => updater(),
    useDerivedValue: processor => ({value: processor()}),
    useAnimatedReaction: NOOP,
    useAnimatedRef: () => ({current: null}),
    useReducedMotion: () => false,
    withTiming,
    withSpring,
    withDelay,
    withSequence: (...animations) => animations[animations.length - 1],
    withRepeat: ID,
    cancelAnimation: NOOP,
    runOnJS: ID,
    runOnUI: ID,
    interpolate: () => 0,
    interpolateColor: () => '',
    Extrapolation: {CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity'},
    Easing: {
      linear: ease,
      ease: ease,
      in: e => e,
      out: e => e,
      inOut: e => e,
    },
  };
});

// @gorhom/bottom-sheet: passthrough provider + inert component stubs.
// No current suite exercises sheet content; these keep imports resolvable.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const passthrough = ({children}) =>
    React.createElement(React.Fragment, null, children);
  const stub = () => null;
  return {
    __esModule: true,
    default: stub,
    BottomSheetModalProvider: passthrough,
    BottomSheetModal: stub,
    BottomSheetView: passthrough,
    BottomSheetFlatList: passthrough,
    BottomSheetScrollView: passthrough,
    BottomSheetTextInput: 'TextInput',
    BottomSheetBackdrop: stub,
  };
});

// react-native-image-picker: queue results per-test via mockResolvedValue.
jest.mock('react-native-image-picker', () => ({
  __esModule: true,
  launchCamera: jest.fn().mockResolvedValue({assets: []}),
  launchImageLibrary: jest.fn().mockResolvedValue({assets: []}),
}));
// In-app VoiceRecorder native module used by src/lib/audio.ts.
// (Replaced the react-native-audio-recorder-player dependency.)
if (!globalThis.__sunlightVoiceRecorderMock) {
  globalThis.__sunlightVoiceRecorderMock = {
    start: jest.fn().mockResolvedValue('/tmp/sunlight-voice/voice-test.m4a'),
    stop: jest
      .fn()
      .mockResolvedValue({uri: 'file:///tmp/sunlight-voice/voice-test.m4a', bytes: 1024}),
    cancel: jest.fn().mockResolvedValue(true),
  };
}

// @dr.pogodin/react-native-fs (named exports): inert surface; tests can
// override per file.
jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/tmp/sunlight-cache',
  DocumentDirectoryPath: '/tmp/sunlight-docs',
  exists: jest.fn().mockResolvedValue(false),
  readFile: jest.fn().mockResolvedValue(''),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readDir: jest.fn().mockResolvedValue([]),
  stopDownload: jest.fn(),
  downloadFile: jest.fn(() => ({
    jobId: 0,
    promise: Promise.resolve({statusCode: 200}),
  })),
}));

// react-native-executorch + bare resource fetcher: pure-JS stubs. The real
// packages touch Nitro Modules / native code at import time. useLLM returns a
// single controllable stub object exposed on globalThis so tests can drive
// isReady/downloadProgress/error and assert generate() calls.
if (!globalThis.__executorchLLMStub) {
  const stub = {
    messageHistory: [],
    response: '',
    token: '',
    isReady: false,
    isGenerating: false,
    downloadProgress: 0,
    error: null,
    generate: jest.fn(() => Promise.resolve('')),
    sendMessage: jest.fn(() => Promise.resolve('')),
    interrupt: jest.fn(),
    configure: jest.fn(),
    deleteMessage: jest.fn(),
  };
  stub.__setState = patch => {
    Object.assign(stub, patch);
  };
  globalThis.__executorchLLMStub = stub;
}
jest.mock('react-native-executorch', () => ({
  __esModule: true,
  initExecutorch: jest.fn(),
  models: {
    llm: {
      lfm2_5_1_2b_instruct: () => ({
        modelName: 'lfm2.5-1.2b-instruct',
        modelSource: 'https://stub/lfm2.5-1.2b-instruct.pte',
        tokenizerSource: 'https://stub/tokenizer.json',
        tokenizerConfigSource: 'https://stub/tokenizer_config.json',
      }),
      llama3_2_1b: opts => ({
        modelName:
          opts && opts.quant ? 'llama-3.2-1b-spinquant' : 'llama-3.2-1b',
        modelSource: 'https://stub/llama3.2-1b.pte',
        tokenizerSource: 'https://stub/tokenizer.json',
        tokenizerConfigSource: 'https://stub/tokenizer_config.json',
      }),
    },
  },
  useLLM: () => globalThis.__executorchLLMStub,
}));
// llama.rn (llama.cpp binding): initLlama resolves to a single controllable
// context stub exposed on globalThis so tests can drive completion()/release()
// and assert calls. The real package touches JSI/native code at import time.
if (!globalThis.__llamaRnStub) {
  const ctxStub = {
    completion: jest.fn(() => Promise.resolve({text: '', content: ''})),
    stopCompletion: jest.fn(() => Promise.resolve()),
    release: jest.fn(() => Promise.resolve()),
    clearCache: jest.fn(() => Promise.resolve()),
  };
  ctxStub.completion.mockImplementation((_params, onToken) => {
    if (onToken) {
      onToken({token: 'stub'});
    }
    return Promise.resolve({text: 'stub', content: 'stub'});
  });
  globalThis.__llamaRnStub = {
    initLlama: jest.fn(() => Promise.resolve(ctxStub)),
    context: ctxStub,
  };
}
jest.mock('llama.rn', () => ({
  __esModule: true,
  initLlama: globalThis.__llamaRnStub.initLlama,
  releaseAllLlama: jest.fn(),
  LlamaContext: class LlamaContextMock {},
}));

// Virtual mock: this package's exports map ships only an `import` condition
// (no `require`), so Jest's CJS resolver cannot resolve the bare specifier.
jest.mock(
  'react-native-executorch-bare-resource-fetcher',
  () => ({
    __esModule: true,
    BareResourceFetcher: {kind: 'stub'},
  }),
  {virtual: true},
);

// Tamagui core ships an ESM-only native entry that jest cannot parse, and
// TamaguiProvider is irrelevant to these tests. Mock precisely what our code
// imports from '@tamagui/core' (see src/theme/tamagui.ts and App.tsx).
jest.mock('@tamagui/core', () => ({
  __esModule: true,
  TamaguiProvider: ({children}) => children ?? null,
  createFont: font => font,
  createTokens: tokens => tokens,
  createTamagui: cfg => cfg,
}));

// PermissionsAndroid mock: any module importing {PermissionsAndroid} from
// 'react-native' under jest gets a working in-memory surface instead of a
// native bridge. The real react-native exports are preserved via property
// descriptors so the module's lazy getters are not force-evaluated, keeping
// every other suite's behavior unchanged.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const mocked = Object.create(
    Object.getPrototypeOf(actual),
    Object.getOwnPropertyDescriptors(actual),
  );
  Object.defineProperty(mocked, 'PermissionsAndroid', {
    configurable: true,
    enumerable: true,
    get() {
      return {
        PERMISSIONS: {
          RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
          READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
          READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
          CAMERA: 'android.permission.CAMERA',
        },
        RESULTS: {
          GRANTED: 'granted',
          DENIED: 'denied',
          NEVER_ASK_AGAIN: 'never_ask_again',
        },
        request: async () => 'granted',
        check: async () => true,
      };
    },
  });
  return mocked;
});

// lucide-react-native: ESM-only icon package. Return a Proxy so any named
// icon import resolves to a renderable stub without enumerating exports.
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const IconStub = ({name}) =>
    React.createElement('LucideIcon', {name: name || 'icon'});
  return new Proxy(
    {__esModule: true, default: IconStub},
    {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        if (prop === '__esModule') {
          return true;
        }
        return IconStub;
      },
    },
  );
});

// react-native-markdown-display: ESM-only dependency. Stub as a passthrough
// Text wrapper so ChatScreen renders without parsing markdown in unit tests.
jest.mock('react-native-markdown-display', () => {
  const React = require('react');
  const {Text} = require('react-native');
  const Markdown = ({children}) =>
    React.createElement(Text, null, children);
  return {__esModule: true, default: Markdown};
});
