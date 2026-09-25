import { describe, expect, it, vi } from 'vitest';
import type { CryptoProAdapter } from '../src/CryptoProAdapter.js';
import { decryptForApproveCert, getCertificateForInit } from '../src/certificateAuthFlow.js';
import type { EncryptedKeyResponse } from '../src/types.js';

function makeAdapter(overrides: Partial<CryptoProAdapter> = {}): CryptoProAdapter {
  return {
    listCertificates: vi.fn().mockResolvedValue([]),
    getCertificateBase64: vi.fn().mockResolvedValue('BASE64-CERT'),
    decryptEncryptedKey: vi.fn().mockResolvedValue('BASE64-DECRYPTED'),
    ...overrides,
  };
}

describe('getCertificateForInit', () => {
  it('returns the certificate as Base64 from the adapter', async () => {
    const adapter = makeAdapter();

    const result = await getCertificateForInit(adapter, 'THUMB-1');

    expect(result).toEqual({ certificateBase64: 'BASE64-CERT' });
    expect(adapter.getCertificateBase64).toHaveBeenCalledWith('THUMB-1');
  });

  it('rejects an empty thumbprint without calling the adapter', async () => {
    const adapter = makeAdapter();

    await expect(getCertificateForInit(adapter, '')).rejects.toThrow(/thumbprint/);
    expect(adapter.getCertificateBase64).not.toHaveBeenCalled();
  });

  it('rejects an empty certificate returned by the adapter', async () => {
    const adapter = makeAdapter({ getCertificateBase64: vi.fn().mockResolvedValue('') });

    await expect(getCertificateForInit(adapter, 'THUMB-1')).rejects.toThrow(/certificateBase64/);
  });
});

describe('decryptForApproveCert', () => {
  const encryptedKey: EncryptedKeyResponse = {
    encryptedKeyBase64: 'BASE64-ENCRYPTED',
    approveCertUrl: 'https://api.kontur.ru/auth/v5.9/approve-cert?thumbprint=THUMB-1',
  };

  it('decrypts via the adapter and builds the approve-cert payload', async () => {
    const adapter = makeAdapter();

    const result = await decryptForApproveCert(adapter, encryptedKey);

    expect(result).toEqual({
      approveCertUrl: encryptedKey.approveCertUrl,
      decryptedBytesBase64: 'BASE64-DECRYPTED',
    });
    expect(adapter.decryptEncryptedKey).toHaveBeenCalledWith('BASE64-ENCRYPTED');
  });

  it('rejects an empty encryptedKeyBase64 without calling the adapter', async () => {
    const adapter = makeAdapter();

    await expect(decryptForApproveCert(adapter, { ...encryptedKey, encryptedKeyBase64: '' })).rejects.toThrow(
      /encryptedKeyBase64/,
    );
    expect(adapter.decryptEncryptedKey).not.toHaveBeenCalled();
  });

  it('rejects an empty approveCertUrl without calling the adapter', async () => {
    const adapter = makeAdapter();

    await expect(decryptForApproveCert(adapter, { ...encryptedKey, approveCertUrl: '' })).rejects.toThrow(
      /approveCertUrl/,
    );
    expect(adapter.decryptEncryptedKey).not.toHaveBeenCalled();
  });

  it('rejects an empty decryption result from the adapter', async () => {
    const adapter = makeAdapter({ decryptEncryptedKey: vi.fn().mockResolvedValue('') });

    await expect(decryptForApproveCert(adapter, encryptedKey)).rejects.toThrow(/decryptedBytesBase64/);
  });
});
