import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { adminSet, client, closeClients, loadRules, plan, commit, resetRate, clearDemoProject } from './helpers/identity-emulator.js';

const budgetProject = 'demo-osatsu-rule-budget';
const denied = (promise) => assert.rejects(promise, (e) => e.code === 'permission-denied');
const reads = (count, group) => Array.from({ length: count }, (_, i) =>
  `get(/databases/$(database)/documents/budgetRefs/${group}-${i}).data.ok == true`,
).join(' && ');

test('Emulator enforces document-access-call limits', async (t) => {
  t.after(closeClients);
  await clearDemoProject(budgetProject);
  const c = await client('v2-budget-probe', true, budgetProject);
  for (let group = 0; group < 5; group += 1) {
    for (let i = 0; i < 12; i += 1) await adminSet(`budgetRefs/${group}-${i}`, { ok: true }, budgetProject);
  }
  await t.test('single operation: 10 distinct get calls pass', async () => {
    await loadRules(`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
      match /probes/{id} { allow create: if request.auth != null && ${reads(10, 0)}; }
    } }`, budgetProject);
    await setDoc(doc(c.db, 'probes', 'ten'), { ok: true });
  });
  await t.test('single operation: 11 distinct get calls are denied', async () => {
    await loadRules(`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
      match /probes/{id} { allow create: if request.auth != null && ${reads(11, 0)}; }
    } }`, budgetProject);
    await denied(setDoc(doc(c.db, 'probes', 'eleven'), { ok: true }));
  });
  const branches = Array.from({ length: 5 }, (_, group) =>
    `(request.resource.data.group == ${group} && ${reads(5, group)})`,
  ).join(' || ');
  await loadRules(`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
    match /probes/{id} { allow create: if request.auth != null && (${branches}); }
  } }`, budgetProject);
  async function commitGroups(count) {
    const batch = writeBatch(c.db);
    for (let group = 0; group < count; group += 1) {
      batch.set(doc(c.db, 'probes', `batch-${count}-${group}`), { group });
    }
    await batch.commit();
  }
  await t.test('atomic batch: 20 distinct calls pass', async () => { await commitGroups(4); });
  await t.test('atomic batch: 25 distinct calls are denied', async () => { await denied(commitGroups(5)); });
  // This project never holds production data; restore the candidate for inspection.
  await loadRules(await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8'), budgetProject);
});

test('measure v2 Rules access budgets using distinct uncached sentinel reads', async (t) => {
  t.after(closeClients);
  const source = await readFile(new URL('../firestore.strict.rules', import.meta.url), 'utf8');
  await clearDemoProject('demo-osatsu-rule-measurement');
  const c = await client('v2-budget-measurement', true, 'demo-osatsu-rule-measurement');
  await adminSet('appConfig/billRegistration', { mode: 'v2', identityVersion: 2 }, c.projectId);
  for (let group = 0; group < 3; group += 1) {
    for (let i = 0; i < 12; i += 1) await adminSet(`budgetRefs/${group}-${i}`, { ok: true }, c.projectId);
  }
  function instrument(rules, fn, count, group = 0) {
    if (!count) return rules;
    const start = rules.indexOf(`function ${fn}(`);
    assert.ok(start >= 0);
    const position = rules.indexOf('return ', start);
    return `${rules.slice(0, position)}return (${reads(count, group)}) && ${rules.slice(position + 7)}`;
  }
  const perOperation = {};
  const functions = {
    index: 'validIndex', reverse: 'validReverse', bill: 'billOperation',
    sighting: 'validSighting', tracked: 'validTrackedCreate', rate: 'validRateOperation',
  };
  for (const [role, fn] of Object.entries(functions)) {
    await t.test(`measure ${role} per-operation limit`, async () => {
      let extra = 0;
      for (; extra <= 11; extra += 1) {
        await loadRules(instrument(source, fn, extra), c.projectId);
        await resetRate(c);
        const operation = await plan(c);
        try { await commit(c, operation); }
        catch (error) {
          assert.equal(error.code, 'permission-denied');
          assert.ok(extra > 0, 'Uninstrumented operation must succeed');
          break;
        }
      }
      assert.ok(extra <= 11, 'Expected the sentinel read to reach the ten-call limit');
      perOperation[role] = 10 - (extra - 1);
    });
  }
  let extra = 0;
  await t.test('measure full atomic registration budget with cache effects', async () => {
    for (; extra <= 28; extra += 1) {
      const indexExtra = Math.ceil(extra / 3);
      const reverseExtra = Math.ceil((extra - indexExtra) / 2);
      const billExtra = extra - indexExtra - reverseExtra;
      assert.ok(perOperation.index + indexExtra <= 10);
      assert.ok(perOperation.reverse + reverseExtra <= 10);
      assert.ok(perOperation.bill + billExtra <= 10);
      const instrumented = instrument(instrument(instrument(source, 'validIndex', indexExtra, 0), 'validReverse', reverseExtra, 1), 'billOperation', billExtra, 2);
      await loadRules(instrumented, c.projectId);
      await resetRate(c);
      const operation = await plan(c);
      try { await commit(c, operation); }
      catch (error) {
        assert.equal(error.code, 'permission-denied');
        assert.ok(extra > 0);
        break;
      }
    }
    assert.ok(extra <= 28, 'Expected the twenty-call limit to be reached');
  });
  await loadRules(source, c.projectId);
  console.log('MEASURED_RULES_ACCESS', JSON.stringify({
    perOperationChargedInBatch: perOperation, uncachedUpperBound: 15,
    atomicChargedCalls: 20 - (extra - 1), extraReadsAllowed: extra - 1,
    method: 'saturation with unique sentinel get calls; separate emulator projects only',
  }));
  assert.ok(Object.values(perOperation).every((value) => value <= 10));
  assert.ok(Object.values(perOperation).reduce((a, b) => a + b, 0) <= 20);
});
