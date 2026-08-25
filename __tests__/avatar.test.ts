import {initialFor} from '../src/lib/avatar';

describe('initialFor', () => {
  test('returns first alphanumeric char of displayName uppercased', () => {
    expect(initialFor('agua')).toBe('A');
    expect(initialFor('owo')).toBe('O');
    expect(initialFor('Marta')).toBe('M');
  });

  test('skips leading non-alphanumeric characters', () => {
    expect(initialFor('_neo')).toBe('N');
    expect(initialFor(' 42skies')).toBe('4');
  });

  test('falls back to subject when displayName is empty/null', () => {
    expect(initialFor(null, 'dev-7')).toBe('D');
    expect(initialFor('', 'owen')).toBe('O');
  });

  test('falls back to S when nothing usable is provided', () => {
    expect(initialFor()).toBe('S');
    expect(initialFor(null, null)).toBe('S');
    expect(initialFor('', '__')).toBe('S');
  });

  test('handles unicode letters and digits', () => {
    expect(initialFor('álvaro')).toBe('Á');
    expect(initialFor('小王')).toBe('小');
  });
});
