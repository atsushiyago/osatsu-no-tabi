import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveIdentitySelection,selectionIdentity,changeIdentityDesign} from '../src/utils/billIdentitySelection.ts';
test('valid complete F serial infers supported denominations and black without a choice',()=>{
 for(const denomination of [1000,5000,10000]){
  const result=resolveIdentitySelection(changeIdentityDesign(denomination,null),'AA123456BB');
  assert.deepEqual(result,{denomination,series:'F',serialColor:'black'});assert.equal(selectionIdentity(result,'AA123456BB').isValid,true);
 }
});
test('invalid/incomplete/composing serial never infers F; edits remove automatic F',()=>{
 const initial=changeIdentityDesign(1000,null);
 for(const serial of ['', 'AA123456B','AA12345BB','AA000000BB','AA900001BB','AI123456BB','AA123456BB!'])assert.equal(resolveIdentitySelection(initial,serial).series,null);
 assert.equal(resolveIdentitySelection(initial,'AA123456BB',true).series,null);
 assert.equal(resolveIdentitySelection({denomination:1000,series:'F',serialColor:'black'},'AA123456B').series,null);
});
test('older serials preserve explicit D/E selection; F overrides without losing remembered D/E state',()=>{
 const selected={denomination:1000,series:'E',serialColor:'brown'};
 assert.deepEqual(resolveIdentitySelection(selected,'AA123456B'),selected);
 assert.equal(resolveIdentitySelection(selected,'AA123456BB').series,'F');
 assert.deepEqual(resolveIdentitySelection(selected,'AA123456B'),selected);
 assert.equal(resolveIdentitySelection(changeIdentityDesign(1000,null),'AA123456B').series,null);
});
test('D2000 remains automatic but invalid/F serials cannot be registered',()=>{
 const selected=resolveIdentitySelection(changeIdentityDesign(2000,null),'AA123456B');
 assert.equal(selected.series,'D');assert.equal(selectionIdentity(selected,'AA123456B').isValid,true);
 for(const serial of ['', 'AA000000B','AA123456BB'])assert.equal(selectionIdentity(resolveIdentitySelection(selected,serial),serial).isValid,false);
});
test('normalization supports completed full-width/lowercase serials through existing validation',()=>{
 assert.equal(resolveIdentitySelection(changeIdentityDesign(1000,null),'ａａ１２３４５６ｂｂ').series,'F');
});
