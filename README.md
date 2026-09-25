# kontur-ofd-js-auth

Browser-side ГОСТ crypto companion for Kontur.OFD certificate-based authentication — orchestrates
the КриптоПро ЭЦП Browser plug-in for the one step of the auth-by-cert handshake
([docs-ofd-api.kontur.ru](https://docs-ofd-api.kontur.ru/)) that has to run in the browser (the
private key never leaves the token/plugin).

**Not a REST client** — `api.kontur.ru` doesn't send CORS headers on any endpoint (verified
empirically), so the browser cannot call Kontur.OFD directly at all. All network calls to
Kontur.OFD happen on your own backend (see
[`kontur-ofd-php-sdk`](https://github.com/dudev/kontur-ofd-php-sdk)'s `AuthClient`, if you're on
PHP) — this library only bridges the two backend calls with the local decryption step. See
`docs/roadmap.md` for the full flow and current scope.

Status: orchestration (`certificateAuthFlow.ts`) and the `window.cadesplugin` binding
(`WindowCadesPluginAdapter`) are implemented, tested against a mocked plugin, and verified
2026-09-25 against a real КриптоПро CSP + ЭЦП Browser plug-in installation (real certificate store,
real GOST certificate, real encrypt/decrypt round-trip) — see `docs/roadmap.md` for what's left.

## Installation

Not published to npm yet (see `docs/roadmap.md`, open question 3) — install directly from GitHub:

```bash
npm install github:dudev/kontur-ofd-js-auth
```

## Usage

```ts
import { WindowCadesPluginAdapter, getCertificateForInit, decryptForApproveCert } from '@dudev/kontur-ofd-js-auth';

const cryptoProAdapter = new WindowCadesPluginAdapter();
// Or provide your own CryptoProAdapter implementation instead — see CryptoProAdapter.ts.

const { certificateBase64 } = await getCertificateForInit(cryptoProAdapter, thumbprint);
const initResponse = await fetch('/api/admin/ofd/auth/certificate-frontend/init', {
  method: 'POST',
  body: JSON.stringify({ certificateBase64 }),
});
const encryptedKey = await initResponse.json();

const approvePayload = await decryptForApproveCert(cryptoProAdapter, encryptedKey);
await fetch('/api/admin/ofd/auth/certificate-frontend/approve', {
  method: 'POST',
  body: JSON.stringify(approvePayload),
});
```

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
