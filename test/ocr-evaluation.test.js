import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOcrEvaluationRecord,
  loadOcrEvaluations,
  OCR_EVALUATION_STORAGE_KEY,
  ocrEvaluationsToCsv,
  saveOcrEvaluations,
  summarizeOcrEvaluations,
} from '../src/utils/ocrEvaluation.ts';

function diagnostic({ rawText = 'AA123456B', normalizedText = rawText, candidates = [], selected = null, corrections = null, ambiguous = false } = {}) {
  return {
    pass: 'Crop', rawText, normalizedText, generatedCandidateCount: candidates.length,
    validCandidates: candidates.map((serial) => ({ serial, correctionCount: corrections ?? 0 })),
    selectedCandidate: selected, correctionCount: corrections, ambiguous, status: candidates.length ? 'corrected' : 'no-valid-candidate',
  };
}

test('正解記番号がrawと完全一致する記録を作る', () => {
  const record = createOcrEvaluationRecord('ａａ１２３４５６ｂ', diagnostic({ rawText: 'ａａ１２３４５６ｂ', selected: 'AA123456B' }), new Date('2026-01-01T00:00:00.000Z'), 'one');
  assert.equal(record.expectedSerial, 'AA123456B');
  assert.equal(record.rawExactMatch, true);
  assert.equal(record.correctedExactMatch, true);
  assert.equal(record.falseAccept, false);
});

test('raw不一致でも選択候補が正解なら補正後一致・改善として記録する', () => {
  const record = createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'AA1234568', normalizedText: 'AA1234568', candidates: ['AA123456B'], selected: 'AA123456B', corrections: 1 }));
  assert.equal(record.rawExactMatch, false);
  assert.equal(record.correctedExactMatch, true);
  assert.equal(summarizeOcrEvaluations([record]).improvedCount, 1);
});

test('選択候補が正解と異なるとfalseAcceptになる', () => {
  const record = createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'AA123456O', candidates: ['AA123456O'], selected: 'AA123456O', corrections: 1 }));
  assert.equal(record.falseAccept, true);
  assert.equal(record.correctedExactMatch, false);
});

test('ambiguousでselectedCandidateがない記録はfalseAcceptにしない', () => {
  const record = createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'AA1234560', candidates: ['AA123456O', 'AA123456Q'], ambiguous: true }));
  assert.equal(record.selectedCandidate, null);
  assert.equal(record.falseAccept, false);
  assert.equal(record.ambiguous, true);
});

test('valid candidateなしを記録・集計する', () => {
  const record = createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'unreadable', normalizedText: 'UNREADABLE' }));
  assert.deepEqual(record.validCandidates, []);
  assert.equal(summarizeOcrEvaluations([record]).noCandidateCount, 1);
});

test('集計件数とpercentageを計算する', () => {
  const records = [
    createOcrEvaluationRecord('AA123456B', diagnostic({ selected: 'AA123456B' }), new Date(), 'a'),
    createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'AA1234568', candidates: ['AA123456B'], selected: 'AA123456B', corrections: 1 }), new Date(), 'b'),
    createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'AA123456O', candidates: ['AA123456O'], selected: 'AA123456O', corrections: 1 }), new Date(), 'c'),
  ];
  const summary = summarizeOcrEvaluations(records);
  assert.equal(summary.count, 3);
  assert.ok(Math.abs(summary.rawExactPercent - 100 / 3) < 1e-10);
  assert.equal(summary.correctedExactCount, 2);
  assert.ok(Math.abs(summary.correctedExactPercent - 200 / 3) < 1e-10);
  assert.equal(summary.improvedCount, 1);
  assert.equal(summary.falseAcceptCount, 1);
});

test('invalidな正解記番号は記録できない', () => {
  assert.equal(createOcrEvaluationRecord('A', diagnostic()), null);
});

test('専用localStorage keyで保存・再読み込みし、CSVに必要列を含む', () => {
  let stored = null;
  const storage = {
    getItem: (key) => key === OCR_EVALUATION_STORAGE_KEY ? stored : null,
    setItem: (key, value) => { assert.equal(key, OCR_EVALUATION_STORAGE_KEY); stored = value; },
  };
  const record = createOcrEvaluationRecord('AA123456B', diagnostic({ rawText: 'AA1234568', candidates: ['AA123456B'], selected: 'AA123456B', corrections: 1 }));
  saveOcrEvaluations([record], storage);
  assert.deepEqual(loadOcrEvaluations(storage), [record]);
  const csv = ocrEvaluationsToCsv([record]);
  for (const column of ['expectedSerial', 'rawOcrText', 'normalizedOcr', 'validCandidates', 'selectedCandidate', 'correctionCount', 'ambiguous', 'rawExactMatch', 'correctedExactMatch', 'falseAccept', 'createdAt']) {
    assert.ok(csv.split('\r\n')[0].includes(column));
  }
  assert.ok(csv.includes('AA123456B'));
});
