import { normalizeSerialNumber, validateSerialNumber } from './serial.ts';
import type { OcrCorrectionDiagnostic } from './ocr.ts';

export const OCR_EVALUATION_STORAGE_KEY = 'osatsu-no-tabi:debug:ocr-evaluations:v1';

export interface OcrEvaluationRecord {
  id: string;
  createdAt: string;
  expectedSerial: string;
  pass: string;
  rawOcrText: string;
  normalizedOcr: string;
  validCandidates: string[];
  selectedCandidate: string | null;
  correctionCount: number | null;
  ambiguous: boolean;
  rawExactMatch: boolean;
  correctedExactMatch: boolean;
  falseAccept: boolean;
}

export interface OcrEvaluationSummary {
  count: number;
  rawExactCount: number;
  correctedExactCount: number;
  improvedCount: number;
  falseAcceptCount: number;
  ambiguousCount: number;
  noCandidateCount: number;
  rawExactPercent: number;
  correctedExactPercent: number;
}

export function createOcrEvaluationRecord(
  expectedInput: string,
  diagnostic: OcrCorrectionDiagnostic,
  now = new Date(),
  id = globalThis.crypto?.randomUUID?.() ?? `${now.getTime()}-${Math.random().toString(36).slice(2)}`,
): OcrEvaluationRecord | null {
  const expectedSerial = normalizeSerialNumber(expectedInput);
  if (!validateSerialNumber(expectedSerial).isValid) return null;

  const rawExactMatch = normalizeSerialNumber(diagnostic.rawText) === expectedSerial;
  const correctedExactMatch = diagnostic.selectedCandidate === expectedSerial;
  return {
    id,
    createdAt: now.toISOString(),
    expectedSerial,
    pass: diagnostic.pass,
    rawOcrText: diagnostic.rawText,
    normalizedOcr: diagnostic.normalizedText,
    validCandidates: diagnostic.validCandidates.map(({ serial }) => serial),
    selectedCandidate: diagnostic.selectedCandidate,
    correctionCount: diagnostic.correctionCount,
    ambiguous: diagnostic.ambiguous,
    rawExactMatch,
    correctedExactMatch,
    falseAccept: diagnostic.selectedCandidate !== null && !correctedExactMatch,
  };
}

export function summarizeOcrEvaluations(records: OcrEvaluationRecord[]): OcrEvaluationSummary {
  const count = records.length;
  const rawExactCount = records.filter((record) => record.rawExactMatch).length;
  const correctedExactCount = records.filter((record) => record.correctedExactMatch).length;
  return {
    count,
    rawExactCount,
    correctedExactCount,
    improvedCount: records.filter((record) => !record.rawExactMatch && record.correctedExactMatch).length,
    falseAcceptCount: records.filter((record) => record.falseAccept).length,
    ambiguousCount: records.filter((record) => record.ambiguous).length,
    noCandidateCount: records.filter((record) => record.validCandidates.length === 0).length,
    rawExactPercent: count ? (rawExactCount / count) * 100 : 0,
    correctedExactPercent: count ? (correctedExactCount / count) * 100 : 0,
  };
}

const CSV_COLUMNS: (keyof OcrEvaluationRecord)[] = [
  'expectedSerial', 'rawOcrText', 'normalizedOcr', 'validCandidates', 'selectedCandidate',
  'correctionCount', 'ambiguous', 'rawExactMatch', 'correctedExactMatch', 'falseAccept', 'createdAt',
];

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function ocrEvaluationsToCsv(records: OcrEvaluationRecord[]): string {
  return [
    CSV_COLUMNS.join(','),
    ...records.map((record) => CSV_COLUMNS.map((column) => csvCell(record[column])).join(',')),
  ].join('\r\n');
}

export function loadOcrEvaluations(storage?: Pick<Storage, 'getItem'>): OcrEvaluationRecord[] {
  try {
    const target = storage ?? globalThis.localStorage;
    const parsed: unknown = JSON.parse(target.getItem(OCR_EVALUATION_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed as OcrEvaluationRecord[] : [];
  } catch {
    return [];
  }
}

export function saveOcrEvaluations(
  records: OcrEvaluationRecord[],
  storage?: Pick<Storage, 'setItem'>,
): void {
  const target = storage ?? globalThis.localStorage;
  target.setItem(OCR_EVALUATION_STORAGE_KEY, JSON.stringify(records));
}
