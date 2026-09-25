import type { CryptoProAdapter } from './CryptoProAdapter.js';
import type { ApproveCertPayload, EncryptedKeyResponse } from './types.js';

/** Сертификат для шага 1 (`POST .../auth/certificate-frontend/init` → `authenticate-by-cert`). */
export async function getCertificateForInit(
  adapter: CryptoProAdapter,
  thumbprint: string,
): Promise<{ readonly certificateBase64: string }> {
  assertNonEmpty(thumbprint, 'thumbprint');

  const certificateBase64 = await adapter.getCertificateBase64(thumbprint);
  assertNonEmpty(certificateBase64, 'certificateBase64');

  return { certificateBase64 };
}

/** Расшифровывает `EncryptedKeyResponse` локально и собирает тело для шага 2 (`.../approve`) — без отпечатка сертификата, плагин сам находит ключ. */
export async function decryptForApproveCert(
  adapter: CryptoProAdapter,
  encryptedKey: EncryptedKeyResponse,
): Promise<ApproveCertPayload> {
  assertNonEmpty(encryptedKey.encryptedKeyBase64, 'encryptedKey.encryptedKeyBase64');
  assertNonEmpty(encryptedKey.approveCertUrl, 'encryptedKey.approveCertUrl');

  const decryptedBytesBase64 = await adapter.decryptEncryptedKey(encryptedKey.encryptedKeyBase64);
  assertNonEmpty(decryptedBytesBase64, 'decryptedBytesBase64');

  return {
    approveCertUrl: encryptedKey.approveCertUrl,
    decryptedBytesBase64,
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (value === '') {
    throw new Error(`Expected a non-empty string for "${name}"`);
  }
}
