import { normalizeSerialInput } from './serial.ts';

export interface SerialSearchRequest {
  rawInput: string;
  serial: string;
  documentId: string;
}

/** Build the exact serial and bill document ID used by the search flow. */
export function prepareSerialSearch(rawInput: string): SerialSearchRequest {
  const serial = normalizeSerialInput(rawInput);
  return { rawInput, serial, documentId: serial };
}
