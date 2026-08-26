/**
 * Boot-graph regression tests.
 *
 * The production bundle evaluates the whole module graph during startup;
 * an eager side effect that throws there closes the app instantly with no
 * trace. These tests exercise exactly that: importing App (and the real
 * index.js entry) must never throw under the standard native mocks.
 */

describe('App boot graph', () => {
  it('evaluates the full App module graph without throwing', () => {
    jest.isolateModules(() => {
      expect(() => require('../App')).not.toThrow();
    });
  });

  it('evaluates the index.js entry point without throwing', () => {
    jest.isolateModules(() => {
      expect(() => require('../index.js')).not.toThrow();
    });
  });

  it('firebase helpers short-circuit instead of crashing when the SDK is absent', async () => {
    const firebase = require('../src/lib/firebase');
    await expect(
      firebase.requestNotificationPermission(),
    ).resolves.toBeDefined();
    await expect(firebase.getFCMToken()).resolves.toBeDefined();
    await expect(firebase.initFCM('k')).resolves.toBeUndefined();
    await expect(firebase.cleanupFCM('k')).resolves.toBeUndefined();
  });
});
