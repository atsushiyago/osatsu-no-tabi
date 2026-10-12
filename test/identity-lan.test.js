import test from 'node:test';
import assert from 'node:assert/strict';
import {isIdentityLanAddress,identityEmulatorEndpoint,validIdentityConnection} from '../src/utils/identityEnvironment.ts';
test('LAN dev endpoint accepts only explicit emulator opt-in and RFC1918 IPv4',()=>{
 for(const host of ['192.168.1.13','10.0.1.2','172.16.0.2'])assert.ok(isIdentityLanAddress(host));
 for(const host of ['0.0.0.0','127.0.0.1','8.8.8.8','172.32.1.2','localhost','example.com','192.168.1.999','192.168.01.2',undefined])assert.equal(isIdentityLanAddress(host),false);
 assert.deepEqual(identityEmulatorEndpoint(true,'true','192.168.1.13'),{host:'192.168.1.13',firestorePort:5174,authPort:5174});
 assert.throws(()=>identityEmulatorEndpoint(true,'false','192.168.1.13'));
 assert.throws(()=>identityEmulatorEndpoint(true,'true','8.8.8.8'));
});
test('production ignores LAN override; default loopback transport remains unchanged',()=>{
 assert.deepEqual(identityEmulatorEndpoint(false,'true','192.168.1.13'),{host:'127.0.0.1',firestorePort:18080,authPort:19099});
 assert.deepEqual(identityEmulatorEndpoint(true,'true',undefined),{host:'127.0.0.1',firestorePort:18080,authPort:19099});
});
test('LAN transport requires same demo project and expected Auth host',()=>{
 assert.equal(validIdentityConnection(true,'demo-osatsu-public-serial','demo-osatsu-public-serial','192.168.1.13','192.168.1.13'),true);
 assert.equal(validIdentityConnection(true,'george-69c3a','george-69c3a','192.168.1.13','192.168.1.13'),false);
 assert.equal(validIdentityConnection(true,'demo-osatsu-public-serial','demo-osatsu-public-serial','127.0.0.1','192.168.1.13'),false);
});
