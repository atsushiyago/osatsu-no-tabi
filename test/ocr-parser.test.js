import test from 'node:test';
import assert from 'node:assert';
import { extractSerialCandidates } from '../src/utils/ocr.ts';

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

test('位置ベースの誤認識補正 (O/0, I/1, S/5, B/8, Z/2)', () => {
  // 先頭の数字 '0' は英字 'O' に補正されるべき (0A123456B -> OA123456B)
  const res0 = extractSerialCandidates('0A123456B');
  assert.ok(res0.includes('OA123456B'), '先頭0がOに補正されてOA123456Bになること');

  // 中央の英字 'S' は数字 '5' に補正されるべき (AA1234S6B -> AA123456B)
  const resS = extractSerialCandidates('AA1234S6B');
  assert.ok(resS.includes('AA123456B'), '中央Sが5に補正されてAA123456Bになること');

  // 中央の英字 'O' は数字 '0' に補正されるべき (AA123O56B -> AA123056B)
  const resO = extractSerialCandidates('AA123O56B');
  assert.ok(resO.includes('AA123056B'), '中央Oが0に補正されてAA123056Bになること');

  // 末尾の数字 '8' は英字 'B' に補正されるべき (AA1234568 -> AA123456B)
  const res8 = extractSerialCandidates('AA1234568');
  assert.ok(res8.includes('AA123456B'), '末尾8がBに補正されてAA123456Bになること');

  // 末尾の数字 '0' は英字 'O' に補正されるべき (AA1234560 -> AA123456O)
  const resZero = extractSerialCandidates('AA1234560');
  assert.ok(resZero.includes('AA123456O'), '末尾0がOに補正されてAA123456Oになること');
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
  const ocrText = 'AA123456A and BB987654C and CC112233D and DD445566E';
  const res = extractSerialCandidates(ocrText, 3);
  assert.strictEqual(res.length, 3, '最大件数が3件に制限されること');
  assert.ok(res.includes('AA123456A'));
  assert.ok(res.includes('BB987654C'));
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
