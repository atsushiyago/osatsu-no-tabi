import { normalizeSerialInput, validateSerialNumber } from './serial.ts';

export interface SerialSearchRequest {
  rawInput: string;
  serial: string;
  documentId: string;
  isValid: boolean;
  validationMessage?: string;
}

export type SerialSearchResult<T> =
  | { status: 'invalid'; request: SerialSearchRequest }
  | { status: 'valid'; request: SerialSearchRequest; result: T };

/** Build the exact serial and bill document ID used by the search flow. */
export function prepareSerialSearch(rawInput: string): SerialSearchRequest {
  const serial = normalizeSerialInput(rawInput);
  const validation = validateSerialNumber(serial);
  return {
    rawInput,
    serial,
    documentId: serial,
    isValid: validation.isValid,
    validationMessage: validation.message,
  };
}

/** Run a search only after the shared registration serial validator succeeds. */
export async function runValidatedSerialSearch<T>(
  rawInput: string,
  lookup: (documentId: string) => Promise<T>,
): Promise<SerialSearchResult<T>> {
  const request = prepareSerialSearch(rawInput);
  if (!request.isValid) return { status: 'invalid', request };

  const result = await lookup(request.documentId);
  return { status: 'valid', request, result };
}
