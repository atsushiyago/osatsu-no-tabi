import test from 'node:test';
import assert from 'node:assert';
import { correctOcrSerial, extractSerialCandidates } from '../src/utils/ocr.ts';

test('OCR後補正は正しいrawを変更せず、NFKCと大文字化を適用する', () => {
  const result = correctOcrSerial('ａａ１２３４５６ｂ');

  assert.strictEqual(result.normalizedText, 'AA123456B');
  assert.deepStrictEqual(result.validCandidates, [{ serial: 'AA123456B', correctionCount: 0 }]);
  assert.strictEqual(result.selectedCandidate, 'AA123456B');
  assert.strictEqual(result.status, 'raw-valid');
});

test('位置に応じて O/0, B/8, S/5, Z/2, G/6, T/7 を置換する', () => {
  const cases = [
    ['AA123O56B', 'AA123056B'],
    ['0A123456B', 'QA123456B'],
    ['A1234B6C', 'A123486C'],
    ['A1234568', 'A123456B'],
    ['AA1234S6B', 'AA123456B'],
    ['A1234565', 'A123456S'],
    ['A123Z56B', 'A123256B'],
    ['A1234562', 'A123456Z'],
    ['A123G56B', 'A123656B'],
    ['A1234566', 'A123456G'],
    ['A123T56B', 'A123756B'],
    ['A1234567', 'A123456T'],
    ['A123Q56B', 'A123056B'],
    ['A123D56B', 'A123056B'],
    ['A123I56B', 'A123156B'],
    ['A123L56B', 'A123156B'],
  ];

  for (const [raw, expected] of cases) {
    const result = correctOcrSerial(raw);
    assert.ok(result.validCandidates.some((candidate) => candidate.serial === expected), `${raw} -> ${expected}`);
  }
});

test('複数置換でも上限2文字を守り、補正数の少ない候補を優先する', () => {
  const twoCorrections = correctOcrSerial('A12O4568');
  assert.strictEqual(twoCorrections.selectedCandidate, 'A120456B');
  assert.strictEqual(twoCorrections.correctionCount, 2);

  const tooManyCorrections = correctOcrSerial('01SSB82O');
  assert.deepStrictEqual(tooManyCorrections.validCandidates, []);
  assert.strictEqual(tooManyCorrections.status, 'no-valid-candidate');
});

test('I/Oは禁止文字として除外しつつ、誤認識候補の曖昧状態を維持する', () => {
  const result = correctOcrSerial('AA1234560');

  assert.deepStrictEqual(result.validCandidates.map((candidate) => candidate.serial), ['AA123456Q']);
  assert.strictEqual(result.selectedCandidate, null);
  assert.strictEqual(result.ambiguous, true);
  assert.strictEqual(result.ambiguityReason, 'possible-truncated-suffix');
});

test('AF8590708は末尾文字の欠落と置換を区別できないため採用候補にしない', () => {
  const result = correctOcrSerial('AF8590708');

  assert.strictEqual(result.normalizedText, 'AF8590708');
  assert.ok(result.validCandidates.some((candidate) => candidate.serial === 'AF859070B'));
  assert.strictEqual(result.selectedCandidate, null);
  assert.strictEqual(result.correctionCount, null);
  assert.strictEqual(result.ambiguous, true);
  assert.strictEqual(result.ambiguityReason, 'possible-truncated-suffix');
  assert.deepStrictEqual(correctOcrSerial('AF859070').validCandidates, []);
});

test('無関係な文字列から番号を作らず、正常番号も別候補へ変えない', () => {
  assert.deepStrictEqual(correctOcrSerial('HELLO WORLD THIS IS A TEST').validCandidates, []);

  const valid = correctOcrSerial('AA123456B');
  assert.deepStrictEqual(valid.validCandidates, [{ serial: 'AA123456B', correctionCount: 0 }]);
  assert.strictEqual(valid.selectedCandidate, 'AA123456B');
  assert.deepStrictEqual(correctOcrSerial('AA123456O').validCandidates, []);
});

test('標準的な記番号形式の認識 (AA123456A, A123456A, AA123456AA)', () => {
  // 8文字 (1英字 + 6数字 + 1英字)
  const res8 = extractSerialCandidates('A123456A');
  assert.ok(res8.includes('A123456A'), 'A123456A が抽出されること');

  // 9文字 (2英字 + 6数字 + 1英字)
  const res9 = extractSerialCandidates('AA123456A');
  assert.ok(res9.includes('AA123456A'), 'AA123456A が抽出されること');

  // 10文字 (2英字 + 6数字 + 2英字)
  const res10 = extractSerialCandidates('AA123456AA');
  assert.ok(res10.includes('AA123456AA'), 'AA123456AA が抽出されること');
});

test('空白・改行・記号を含むOCR結果からの抽出', () => {
  // 空白・改行区切りの認識
  const resWithNewline = extractSerialCandidates('AA 123456\nB');
  assert.ok(resWithNewline.includes('AA123456B'), '改行・空白が除去されてAA123456Bが抽出されること');

  // ハイフンやスペース混在
  const resWithHyphen = extractSerialCandidates('A-123 456-A');
  assert.ok(resWithHyphen.includes('A123456A'), 'ハイフンやスペースが除去されてA123456Aが抽出されること');

  // 全角英数字
  const resZenkaku = extractSerialCandidates('ＡＡ１２３４５６Ｂ');
  assert.ok(resZenkaku.includes('AA123456B'), '全角英数字が半角化されてAA123456Bが抽出されること');
});

test('前後に不要文字があるOCR結果からの抽出', () => {
  const ocrText = 'NIPPON GINKO 10000 YEN\nAA123456A\nNATIONAL PRINTING BUREAU';
  const res = extractSerialCandidates(ocrText);
  assert.ok(res.includes('AA123456A'), '周囲の不要文字列からAA123456Aが抽出されること');
});

test('位置ベースの誤認識補正 (O/0, I/1, S/5, B/8, Z/2)は日銀形式でcandidate選別する', () => {
  // 先頭の数字 '0' の代替Oは禁止文字なので除外、Qは有効候補として残る
  const res0 = extractSerialCandidates('0A123456B');
  assert.ok(res0.includes('QA123456B'), '先頭0から生成されたQ候補を残すこと');

  // 中央の英字 'S' は数字 '5' に補正されるべき (AA1234S6B -> AA123456B)
  const resS = extractSerialCandidates('AA1234S6B');
  assert.ok(resS.includes('AA123456B'), '中央Sが5に補正されてAA123456Bになること');

  // 中央の英字 'O' は数字 '0' に補正されるべき (AA123O56B -> AA123056B)
  const resO = extractSerialCandidates('AA123O56B');
  assert.ok(resO.includes('AA123056B'), '中央Oが0に補正されてAA123056Bになること');

  // 末尾の数字 '8' は英字 'B' に補正されるべき (AA1234568 -> AA123456B)
  const res8 = extractSerialCandidates('AA1234568');
  assert.ok(res8.includes('AA123456B'), '末尾8がBに補正されてAA123456Bになること');

  // 末尾の数字 '0' からO/Qを試し、禁止文字Oを除外してQを残す
  const resZero = extractSerialCandidates('AA1234560');
  assert.ok(resZero.includes('AA123456Q'), '末尾0から生成されたQ候補を残すこと');
});

test('候補なしのケース', () => {
  const resEmpty = extractSerialCandidates('');
  assert.deepStrictEqual(resEmpty, []);

  const resJapanese = extractSerialCandidates('日本銀行券 一万円 日本銀行');
  assert.deepStrictEqual(resJapanese, []);

  const resRandom = extractSerialCandidates('HELLO WORLD THIS IS A TEST');
  assert.deepStrictEqual(resRandom, []);
});

test('複数候補が存在する場合の抽出と上限', () => {
  const ocrText = 'AA123456A and BB897654C and CC112233D and DD445566E';
  const res = extractSerialCandidates(ocrText, 3);
  assert.strictEqual(res.length, 3, '最大件数が3件に制限されること');
  assert.ok(res.includes('AA123456A'));
  assert.ok(res.includes('BB897654C'));
  assert.ok(res.includes('CC112233D'));
});

test('無理な補正（3文字以上の置換が必要な無関係な文字列）を生成しないこと', () => {
  // 例: '01SSB82O' -> 8文字全て数字/置換対象だが、まともな記番号ではなく置換文字数が多すぎるため候補にしない
  const resExcessive = extractSerialCandidates('01SSB82O');
  assert.strictEqual(resExcessive.length, 0, '過剰な置換が必要な文字列は候補としないこと');

  // 1〜2文字程度の軽微な混同のみ許容 (例: 'AA1234568' -> 8がBで1文字補正)
  const resValid = extractSerialCandidates('AA1234568');
  assert.deepStrictEqual(resValid, ['AA123456B']);
});
