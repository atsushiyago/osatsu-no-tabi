import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { isIdentityLanAddress } from './src/utils/identityEnvironment.ts'

export default defineConfig(({ command }) => {
  const lan = command === 'serve' ? process.env.VITE_IDENTITY_LAN_HOST : undefined
  if (lan && (!isIdentityLanAddress(lan) || process.env.VITE_USE_FIREBASE_EMULATORS !== 'true' || process.env.VITE_BILL_IDENTITY_V2 !== 'true')) {
    throw new Error('LAN server requires a private IPv4 address and both demo flags')
  }
  return {
    plugins: [react(), ...(lan ? [{
      name: 'identity-lan-development-only',
      // crypto.randomUUID is absent on HTTP LAN origins. Standard CSPRNG UUID v4
      // compatibility only for this DEV server; no identity/business logic change.
      transformIndexHtml() {
        return [{ tag: 'script', injectTo: 'head-prepend' as const, children: `if (!crypto.randomUUID) { Object.defineProperty(crypto, 'randomUUID', { value: () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20); } }); }` }]
      },
    }] : [])],
    ...(lan ? { server: {
      host: lan, port: 5174, strictPort: true,
      proxy: {
        '/google.firestore.v1.Firestore/': { target: 'http://127.0.0.1:18080', changeOrigin: true },
        '/v1/projects/demo-osatsu-public-serial/': { target: 'http://127.0.0.1:18080', changeOrigin: true },
        '/identitytoolkit.googleapis.com/': { target: 'http://127.0.0.1:19099', changeOrigin: true },
        '/securetoken.googleapis.com/': { target: 'http://127.0.0.1:19099', changeOrigin: true },
        '/emulator/v1/projects/demo-osatsu-public-serial/config': { target: 'http://127.0.0.1:19099', changeOrigin: true },
      },
    } } : {}),
  }
})
