/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Animated} from 'react-native';
import App from '../App';
import {readSession, unlockSession} from '../src/auth/secure';

jest.mock('../src/auth/secure', () => ({
  readSession: jest.fn(),
  unlockSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

const readSessionMock = readSession as jest.Mock;
const unlockSessionMock = unlockSession as jest.Mock;

/** Instant-resolve animations so splash updates stay inside act(). */
beforeEach(() => {
  jest.useFakeTimers();
  jest
    .spyOn(Animated, 'timing')
    .mockImplementation(
      (() => ({
        start: (cb?: (result: {finished: boolean}) => void) =>
          cb?.({finished: true}),
        stop: () => {},
      })) as unknown as typeof Animated.timing,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const SESSION = {apiKey: 'moud_k', keyId: 'device/K', subject: 'user-1'};

/**
 * Renders <App/> and settles the boot splash lifecycle deterministically:
 * flush the boot promise chain with microtasks, then advance fake timers
 * past the minimum-duration hold so the exit animation runs inside act().
 */
async function renderAppAndSettleSplash() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    // Flush the async boot chain (readSession -> unlockSession -> loadChats).
    for (let i = 0; i < 25; i++) {
      await Promise.resolve();
    }
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(1000);
  });
  return renderer;
}

test('renders correctly with a stored, unlocked session', async () => {
  readSessionMock.mockResolvedValue(SESSION);
  unlockSessionMock.mockResolvedValue(SESSION);
  await renderAppAndSettleSplash();
});

test('boot failure still lands logged out instead of wedging on splash', async () => {
  readSessionMock.mockRejectedValue(new Error('vault exploded'));
  await renderAppAndSettleSplash();
});
