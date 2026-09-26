import { normalizeSerialInput, validateSerialNumber } from './serial.ts';

export interface SerialInputState {
  value: string;
  isComposing: boolean;
}

export function createSerialInputState(value = ''): SerialInputState {
  return { value: normalizeSerialInput(value), isComposing: false };
}

export function startSerialComposition(state: SerialInputState): SerialInputState {
  return { ...state, isComposing: true };
}

export function updateSerialInput(state: SerialInputState, rawValue: string): SerialInputState {
  return {
    value: state.isComposing ? rawValue : normalizeSerialInput(rawValue),
    isComposing: state.isComposing,
  };
}

export function endSerialComposition(rawValue: string): SerialInputState {
  return { value: normalizeSerialInput(rawValue), isComposing: false };
}

export function getSerialInputValidation(state: SerialInputState) {
  if (state.isComposing || !state.value) return null;
  return validateSerialNumber(state.value);
}
