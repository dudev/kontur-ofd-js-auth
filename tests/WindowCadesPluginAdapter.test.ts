import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowCadesPluginAdapter } from '../src/WindowCadesPluginAdapter.js';
import type { CadesCertificate, CadesCertificates, CadesEnvelopedData, CadesPlugin, CadesStore } from '../src/cadesplugin.types.js';

const GOST_2012_256_OID = '1.2.643.7.1.1.1.1';
const RSA_OID = '1.2.840.113549.1.1.1';

interface FakeCertSpec {
  readonly thumbprint: string;
  readonly base64?: string;
  readonly algorithmOid?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly hasPrivateKey?: boolean;
}

function makeCertificate(spec: FakeCertSpec): CadesCertificate {
  return {
    Thumbprint: Promise.resolve(spec.thumbprint),
    Export: vi.fn().mockResolvedValue(spec.base64 ?? `EXPORTED-${spec.thumbprint}`),
    ValidFromDate: Promise.resolve(spec.validFrom ?? '2020-01-01T00:00:00.000Z'),
    ValidToDate: Promise.resolve(spec.validTo ?? '2099-01-01T00:00:00.000Z'),
    HasPrivateKey: vi.fn().mockResolvedValue(spec.hasPrivateKey ?? true),
    PublicKey: vi.fn().mockResolvedValue({
      Algorithm: Promise.resolve({ Value: Promise.resolve(spec.algorithmOid ?? GOST_2012_256_OID) }),
    }),
  };
}

function makeStore(certs: readonly FakeCertSpec[]): CadesStore & { readonly Open: ReturnType<typeof vi.fn>; readonly Close: ReturnType<typeof vi.fn> } {
  // Мемоизируем по индексу — иначе Item(i), вызванный дважды (например, тестом и самим адаптером),
  // возвращал бы два разных объекта с двумя разными vi.fn(), и проверка вызова мока была бы бессмысленной.
  const cache = new Map<number, CadesCertificate>();
  const certificates: CadesCertificates = {
    Count: Promise.resolve(certs.length),
    Item: vi.fn().mockImplementation((index: number) => {
      const spec = certs[index - 1];
      if (spec === undefined) {
        throw new Error(`Test double: no certificate at index ${String(index)}`);
      }

      let certificate = cache.get(index);
      if (certificate === undefined) {
        certificate = makeCertificate(spec);
        cache.set(index, certificate);
      }

      return Promise.resolve(certificate);
    }),
  };

  return {
    Open: vi.fn().mockResolvedValue(undefined),
    Close: vi.fn().mockResolvedValue(undefined),
    Certificates: Promise.resolve(certificates),
  };
}

function makeEnvelopedData(options: { readonly content?: string; readonly decryptError?: unknown } = {}): CadesEnvelopedData {
  return {
    propset_ContentEncoding: vi.fn().mockResolvedValue(undefined),
    Decrypt:
      options.decryptError === undefined
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockRejectedValue(options.decryptError),
    Content: Promise.resolve(options.content ?? 'DECRYPTED-BASE64'),
  };
}

function makeCadesplugin(options: {
  readonly store?: ReturnType<typeof makeStore>;
  readonly envelopedData?: CadesEnvelopedData;
} = {}): CadesPlugin {
  const store = options.store ?? makeStore([]);
  const envelopedData = options.envelopedData ?? makeEnvelopedData();

  const createObjectAsync = vi.fn().mockImplementation((progId: string) => {
    if (progId === 'CAdESCOM.Store') return Promise.resolve(store);
    if (progId === 'CAdESCOM.CPEnvelopedData') return Promise.resolve(envelopedData);
    throw new Error(`Unexpected ProgID in test double: ${progId}`);
  });

  const plugin = Promise.resolve(undefined) as unknown as CadesPlugin & Record<string, unknown>;
  void Object.assign(plugin, {
    CreateObjectAsync: createObjectAsync,
    getLastError: vi.fn().mockImplementation((error: unknown) => `mocked: ${String(error)}`),
    CAPICOM_CURRENT_USER_STORE: 2,
    CAPICOM_MY_STORE: 'My',
    CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: 2,
    CADESCOM_ENCODE_BASE64: 0,
    CADESCOM_BASE64_TO_BINARY: 1,
  });

  return plugin;
}

function stubWindowCadesplugin(plugin: CadesPlugin | undefined): void {
  vi.stubGlobal('window', { cadesplugin: plugin });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WindowCadesPluginAdapter', () => {
  describe('when window.cadesplugin is missing', () => {
    beforeEach(() => {
      stubWindowCadesplugin(undefined);
    });

    it('throws a clear error instead of a raw TypeError', async () => {
      const adapter = new WindowCadesPluginAdapter();

      await expect(adapter.listCertificateThumbprints()).rejects.toThrow(/cadesplugin is not available/);
    });
  });

  describe('listCertificateThumbprints', () => {
    it('opens the current-user My store and returns normalized thumbprints', async () => {
      const store = makeStore([{ thumbprint: 'abc123' }, { thumbprint: 'DEF456' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const thumbprints = await adapter.listCertificateThumbprints();

      expect(thumbprints).toEqual(['ABC123', 'DEF456']);
      expect(store.Open).toHaveBeenCalledWith(2, 'My', 2);
      expect(store.Close).toHaveBeenCalledTimes(1);
    });

    it('closes the store even if enumeration throws', async () => {
      const store = makeStore([]);
      const certificates = await store.Certificates;
      vi.mocked(certificates.Item).mockRejectedValueOnce(new Error('boom'));
      // Force a non-zero count so Item() is actually called.
      (store as { Certificates: Promise<CadesCertificates> }).Certificates = Promise.resolve({
        ...certificates,
        Count: Promise.resolve(1),
      });
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      await expect(adapter.listCertificateThumbprints()).rejects.toThrow('boom');
      expect(store.Close).toHaveBeenCalledTimes(1);
    });

    it('excludes certificates that are unsuitable for Kontur.OFD certificate-based auth', async () => {
      const store = makeStore([
        { thumbprint: 'GOOD', algorithmOid: GOST_2012_256_OID },
        { thumbprint: 'RSA-CERT', algorithmOid: RSA_OID },
        { thumbprint: 'EXPIRED', validTo: '2020-01-01T00:00:00.000Z' },
        { thumbprint: 'NOT-YET-VALID', validFrom: '2099-01-01T00:00:00.000Z' },
        { thumbprint: 'NO-PRIVATE-KEY', hasPrivateKey: false },
      ]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const thumbprints = await adapter.listCertificateThumbprints();

      expect(thumbprints).toEqual(['GOOD']);
    });
  });

  describe('getCertificateBase64', () => {
    it('finds the certificate by thumbprint (case/whitespace-insensitive) and exports it as Base64', async () => {
      const store = makeStore([{ thumbprint: 'ABC123', base64: 'CERT-BASE64 \n' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const result = await adapter.getCertificateBase64(' abc123 ');

      expect(result).toBe('CERT-BASE64');
    });

    it('throws when no certificate matches the thumbprint', async () => {
      const store = makeStore([{ thumbprint: 'OTHER' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      await expect(adapter.getCertificateBase64('MISSING')).rejects.toThrow(/was not found/);
    });

    it('throws a descriptive error naming every reason when the certificate is unsuitable', async () => {
      const store = makeStore([
        { thumbprint: 'BAD', algorithmOid: RSA_OID, validTo: '2020-01-01T00:00:00.000Z', hasPrivateKey: false },
      ]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      await expect(adapter.getCertificateBase64('BAD')).rejects.toThrow(
        /GOST public-key algorithm.*is expired or not yet valid.*no private key/,
      );
    });

    it('does not export an unsuitable certificate', async () => {
      const store = makeStore([{ thumbprint: 'BAD', algorithmOid: RSA_OID }]);
      const certificate = await (await store.Certificates).Item(1);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      await expect(adapter.getCertificateBase64('BAD')).rejects.toThrow();
      expect(certificate.Export).not.toHaveBeenCalled();
    });
  });

  describe('decryptEncryptedKey', () => {
    it('sets Base64 content encoding before decrypting and returns Content', async () => {
      const envelopedData = makeEnvelopedData({ content: 'PLAINTEXT-BASE64' });
      stubWindowCadesplugin(makeCadesplugin({ envelopedData }));
      const adapter = new WindowCadesPluginAdapter();

      const result = await adapter.decryptEncryptedKey('CMS-ENVELOPE-BASE64');

      expect(result).toBe('PLAINTEXT-BASE64');
      expect(envelopedData.propset_ContentEncoding).toHaveBeenCalledWith(1);
      expect(envelopedData.Decrypt).toHaveBeenCalledWith('CMS-ENVELOPE-BASE64');
    });

    it('wraps a decrypt failure with a message from getLastError', async () => {
      const envelopedData = makeEnvelopedData({ decryptError: new Error('no matching cert') });
      stubWindowCadesplugin(makeCadesplugin({ envelopedData }));
      const adapter = new WindowCadesPluginAdapter();

      await expect(adapter.decryptEncryptedKey('CMS-ENVELOPE-BASE64')).rejects.toThrow(
        /CAdESCOM\.CPEnvelopedData\.Decrypt\(\) failed: mocked:/,
      );
    });
  });
});
