import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationIdentityStage,identityInputSignature,selectionIdentity} from '../src/utils/billIdentitySelection.ts';
const empty=(denomination=1000)=>({denomination,series:null,serialColor:null});
test('initial, partial and invalid inputs never expose choices or a usable identity',()=>{
 for(const raw of ['', 'AA12345B','AA000000BB','AA900001BB','AI123456BB']){
  const r=registrationIdentityStage(empty(),raw,null);assert.equal(r.stage,'input');assert.equal(selectionIdentity(r.selection,raw).isValid,false);
 }
});
test('nine-character old format stays hidden while editing and ten-character F confirms automatically',()=>{
 const old='AA123456B',f='AA123456BB';
 assert.equal(registrationIdentityStage(empty(),old,null,true).stage,'confirm');
 assert.equal(registrationIdentityStage(empty(),f,null,true).stage,'confirm');
 const r=registrationIdentityStage(empty(),f,identityInputSignature(1000,f));
 assert.equal(r.stage,'automatic');assert.equal(r.selection.series,'F');assert.equal(r.selection.serialColor,'black');
});
test('confirmed old serial first needs design, then color without default selection',()=>{
 const raw='AA123456B',confirmed=identityInputSignature(1000,raw);
 assert.equal(registrationIdentityStage(empty(),raw,confirmed).stage,'design');
 const design=registrationIdentityStage({...empty(),series:'E'},raw,confirmed);
 assert.equal(design.stage,'color');assert.equal(design.selection.serialColor,null);
 const ready=registrationIdentityStage({...empty(),series:'E',serialColor:'brown'},raw,confirmed);
 assert.equal(selectionIdentity(ready.selection,raw).isValid,true);
});
test('changed serial, amount or composition cannot reuse an old confirmed identity',()=>{
 const raw='AA123456B',confirmed=identityInputSignature(1000,raw),old={...empty(),series:'E',serialColor:'brown'};
 for(const r of [registrationIdentityStage(old,'AA123457B',confirmed),registrationIdentityStage({...old,denomination:5000},raw,confirmed),registrationIdentityStage(old,raw,confirmed,true),registrationIdentityStage(old,raw,confirmed,false,true)])assert.equal(r.selection.series,null);
});
test('D2000 needs a confirmed valid old serial and offers no extra selection',()=>{
 const raw='AA123456B';assert.equal(registrationIdentityStage(empty(2000),raw,null).stage,'confirm');
 const r=registrationIdentityStage(empty(2000),raw,identityInputSignature(2000,raw));assert.equal(r.stage,'automatic');assert.equal(r.selection.series,'D');assert.equal(r.selection.serialColor,'black');
 assert.equal(registrationIdentityStage(empty(2000),'AA123456BB',identityInputSignature(2000,'AA123456BB')).stage,'input');
});
