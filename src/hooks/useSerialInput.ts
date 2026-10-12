import { useState } from 'react';
import type { Language } from '../i18n';
import {
  createSerialInputState,
  endSerialComposition,
  getSerialInputValidation,
  startSerialComposition,
  updateSerialInput,
} from '../utils/serialInputState';

export function useSerialInput(initialValue = '', language: Language = 'ja') {
  const [state, setState] = useState(() => createSerialInputState(initialValue));

  return {
    value: state.value,
    isComposing: state.isComposing,
    validation: getSerialInputValidation(state, language),
    setValue: (value: string) => setState(createSerialInputState(value)),
    onChange: (rawValue: string) => setState((current) => updateSerialInput(current, rawValue)),
    onCompositionStart: () => setState((current) => startSerialComposition(current)),
    onCompositionEnd: (rawValue: string) => setState(endSerialComposition(rawValue)),
  };
}
