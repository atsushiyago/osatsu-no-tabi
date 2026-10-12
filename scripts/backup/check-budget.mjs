import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {estimateBudget,countSpecs,countQuery} from './read-budget.mjs';
import {outsideRepo} from './firestore-backup.mjs';
import {assertRuntime,validateApproval,obtainShortToken,productionBackup} from './production-backup.mjs';
export async function main(args) {
  if(args[0]==='plan'&&args.length===2) {
    const input=JSON.parse(await readFile(args[1],'utf8'));const result=estimateBudget(input);
    console.info(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=2;return;
  }
  if(args[0]==='queries'&&args.length===1) {
    console.info(JSON.stringify(countSpecs.map(s=>({collection:s.id,scope:s.group?'collection-group':'root',body:countQuery(s)})),null,2));return;
  }
  if(args[0]!=='count'||args.length!==9)throw new Error('EXPLICIT_MODE_REQUIRED');
  assertRuntime();
  const names=['--project','--database','--service-account','--approval-file'];const values={};
  for(let i=1;i<9;i+=2){if(args[i]!==names[(i-1)/2])throw new Error('EXPLICIT_ARGUMENTS_REQUIRED');values[args[i]]=args[i+1];}
  if(values['--service-account']!=='osatsu-backup-reader@george-69c3a.iam.gserviceaccount.com')throw new Error('EXPECTED_READER_REQUIRED');
  const path=await outsideRepo(values['--approval-file']);if((await stat(path)).mode&0o077)throw new Error('PRIVATE_APPROVAL_REQUIRED');
  const input=JSON.parse(await readFile(path,'utf8'));
  const a=validateApproval(input,{project:values['--project'],database:values['--database'],serviceAccount:values['--service-account'],output:input.output});
  if(a.maxReadUnits<26)throw new Error('INVENTORY_BUDGET_INSUFFICIENT');
  const result=await productionBackup(a,{token:await obtainShortToken(a),inventory:true});
  console.info(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('BUDGET_CHECK_FAILED: no backup or full scan performed; do not proceed');process.exitCode=1;});
