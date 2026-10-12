// Synthetic demo fixture maintenance only: never accepts a host/project override.
const id=process.argv[2];
if(process.argv.length!==3||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id??''))throw new Error('Pass the UUID from the demo detail URL');
const base='http://127.0.0.1:18080/v1/projects/demo-osatsu-public-serial/databases/(default)/documents/';
const config=await fetch(base+'appConfig/billRegistration',{signal:AbortSignal.timeout(3000)});
if(!config.ok||(await config.json()).fields?.mode?.stringValue!=='v2')throw new Error('Demo Emulator must be running');
const r=await fetch(base+'publicBills/'+id+'?updateMask.fieldPaths=lastSightedAtServer&currentDocument.exists=true',{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:{lastSightedAtServer:{timestampValue:new Date(Date.now()-3600000).toISOString()}}}),signal:AbortSignal.timeout(3000)});
if(!r.ok)throw new Error('Demo fixture maintenance failed');
console.info('Demo fixture timestamp aged. Rediscovery can now be tested without changing the 15-minute registration logic.');
