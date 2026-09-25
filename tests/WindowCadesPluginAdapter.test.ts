import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowCadesPluginAdapter } from '../src/WindowCadesPluginAdapter.js';
import type { CertificateSummary } from '../src/CryptoProAdapter.js';
import type { CadesCertificate, CadesCertificates, CadesEnvelopedData, CadesPlugin, CadesStore } from '../src/cadesplugin.types.js';

function firstCertificate(certificates: readonly CertificateSummary[]): CertificateSummary {
  const [certificate] = certificates;
  if (certificate === undefined) {
    throw new Error('Expected at least one certificate in the test double');
  }

  return certificate;
}

const GOST_2012_256_OID = '1.2.643.7.1.1.1.1';
const RSA_OID = '1.2.840.113549.1.1.1';

interface FakeKeyUsageSpec {
  readonly isPresent: boolean;
  readonly keyEncipherment?: boolean;
  readonly keyAgreement?: boolean;
}

interface FakeCertSpec {
  readonly thumbprint: string;
  readonly base64?: string;
  readonly algorithmOid?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly hasPrivateKey?: boolean;
  readonly privateKeyUsageFrom?: string | null;
  readonly privateKeyUsageTo?: string | null;
  readonly keyUsage?: FakeKeyUsageSpec;
  readonly subjectName?: string;
  readonly issuerName?: string;
}

function makeCertificate(spec: FakeCertSpec): CadesCertificate {
  return {
    Thumbprint: Promise.resolve(spec.thumbprint),
    SubjectName: Promise.resolve(spec.subjectName ?? `CN=Test Owner ${spec.thumbprint}`),
    IssuerName: Promise.resolve(spec.issuerName ?? 'CN=Test CA'),
    Export: vi.fn().mockResolvedValue(spec.base64 ?? `EXPORTED-${spec.thumbprint}`),
    ValidFromDate: Promise.resolve(spec.validFrom ?? '2020-01-01T00:00:00.000Z'),
    ValidToDate: Promise.resolve(spec.validTo ?? '2099-01-01T00:00:00.000Z'),
    // По умолчанию расширения нет — подтверждённое поведение "нет ограничения", не хак теста.
    PrivateKeyUsagePeriodFrom: Promise.resolve(spec.privateKeyUsageFrom ?? null),
    PrivateKeyUsagePeriodTo: Promise.resolve(spec.privateKeyUsageTo ?? null),
    HasPrivateKey: vi.fn().mockResolvedValue(spec.hasPrivateKey ?? true),
    PublicKey: vi.fn().mockResolvedValue({
      Algorithm: Promise.resolve({ Value: Promise.resolve(spec.algorithmOid ?? GOST_2012_256_OID) }),
    }),
    KeyUsage: vi.fn().mockResolvedValue({
      IsPresent: Promise.resolve(spec.keyUsage?.isPresent ?? false),
      IsKeyEnciphermentEnabled: Promise.resolve(spec.keyUsage?.keyEncipherment ?? false),
      IsKeyAgreementEnabled: Promise.resolve(spec.keyUsage?.keyAgreement ?? false),
    }),
  };
}

function makeStore(certs: readonly FakeCertSpec[]): CadesStore & { readonly Open: ReturnType<typeof vi.fn>; readonly Close: ReturnType<typeof vi.fn> } {
  // Мемоизируем по индексу — иначе двойной Item(i) вернул бы два разных мока.
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

      await expect(adapter.listCertificates()).rejects.toThrow(/cadesplugin is not available/);
    });
  });

  describe('listCertificates', () => {
    it('opens the current-user My store and returns normalized thumbprints', async () => {
      const store = makeStore([{ thumbprint: 'abc123' }, { thumbprint: 'DEF456' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificates = await adapter.listCertificates();

      expect(certificates.map((c) => c.thumbprint)).toEqual(['ABC123', 'DEF456']);
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

      await expect(adapter.listCertificates()).rejects.toThrow('boom');
      expect(store.Close).toHaveBeenCalledTimes(1);
    });

    it('excludes certificates that are unsuitable for Kontur.OFD certificate-based auth', async () => {
      const store = makeStore([
        { thumbprint: 'GOOD', algorithmOid: GOST_2012_256_OID },
        { thumbprint: 'RSA-CERT', algorithmOid: RSA_OID },
        { thumbprint: 'EXPIRED', validTo: '2020-01-01T00:00:00.000Z' },
        { thumbprint: 'NOT-YET-VALID', validFrom: '2099-01-01T00:00:00.000Z' },
        { thumbprint: 'NO-PRIVATE-KEY', hasPrivateKey: false },
        { thumbprint: 'PRIVATE-KEY-EXPIRED', privateKeyUsageTo: '2020-01-01T00:00:00.000Z' },
        { thumbprint: 'PRIVATE-KEY-NOT-YET-VALID', privateKeyUsageFrom: '2099-01-01T00:00:00.000Z' },
        { thumbprint: 'SIGNATURE-ONLY', keyUsage: { isPresent: true, keyEncipherment: false, keyAgreement: false } },
      ]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificates = await adapter.listCertificates();

      expect(certificates.map((c) => c.thumbprint)).toEqual(['GOOD']);
    });

    it('does not treat an absent PrivateKeyUsagePeriod or KeyUsage extension as a restriction', async () => {
      const store = makeStore([
        { thumbprint: 'NO-EXTENSIONS', privateKeyUsageFrom: null, privateKeyUsageTo: null, keyUsage: { isPresent: false } },
        { thumbprint: 'KEY-AGREEMENT-ONLY', keyUsage: { isPresent: true, keyEncipherment: false, keyAgreement: true } },
      ]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificates = await adapter.listCertificates();

      expect(certificates.map((c) => c.thumbprint)).toEqual(['NO-EXTENSIONS', 'KEY-AGREEMENT-ONLY']);
    });

    it('treats a PrivateKeyUsagePeriod read that throws the same as an absent extension', async () => {
      const store = makeStore([{ thumbprint: 'THROWS-ON-READ' }]);
      const certificate = await (await store.Certificates).Item(1);
      (certificate as { PrivateKeyUsagePeriodFrom: Promise<string | null> }).PrivateKeyUsagePeriodFrom = Promise.reject(
        new Error('В сертификате отсутствует расширение 2.5.29.16'),
      );
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificates = await adapter.listCertificates();

      expect(certificates.map((c) => c.thumbprint)).toEqual(['THROWS-ON-READ']);
    });

    it('parses owner name, organization, issuer, INN and OGRN out of the DN strings', async () => {
      const store = makeStore([
        {
          thumbprint: 'FULL-DN',
          subjectName: 'SN=Русанов, G=Евгений Александрович, CN=Русанов Евгений Александрович, C=RU, ИНН=182811189442, ОГРНИП=326965800118081',
          issuerName: 'CN=Тестовый УЦ, O=ООО Тестовый УЦ, C=RU',
          validTo: '2027-01-01T00:00:00.000Z',
        },
      ]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificate = firstCertificate(await adapter.listCertificates());

      expect(certificate).toEqual({
        thumbprint: 'FULL-DN',
        ownerName: 'Русанов Евгений Александрович',
        organization: null,
        issuerName: 'Тестовый УЦ',
        validTo: new Date('2027-01-01T00:00:00.000Z'),
        inn: '182811189442',
        ogrn: '326965800118081',
      });
    });

    it('reads OGRN from either ОГРН (legal entity) or ОГРНИП (sole proprietor), and organization when present', async () => {
      const store = makeStore([
        { thumbprint: 'LEGAL-ENTITY', subjectName: 'CN=ООО Ромашка, O=ООО Ромашка, ИНН=7701234567, ОГРН=1027700132195' },
      ]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificate = firstCertificate(await adapter.listCertificates());

      expect(certificate.organization).toBe('ООО Ромашка');
      expect(certificate.ogrn).toBe('1027700132195');
    });

    it('leaves organization/INN/OGRN null when the DN does not carry them', async () => {
      const store = makeStore([{ thumbprint: 'BARE-CN', subjectName: 'CN=7927f6e3-17e9-4b1e-8909-25826c74049f' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificate = firstCertificate(await adapter.listCertificates());

      expect(certificate).toMatchObject({ ownerName: '7927f6e3-17e9-4b1e-8909-25826c74049f', organization: null, inn: null, ogrn: null });
    });

    it('does not split a DN value on a backslash-escaped comma', async () => {
      const store = makeStore([{ thumbprint: 'ESCAPED-COMMA', subjectName: 'CN=Иванов Иван, O=Рога\\, копыта и Ко' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificate = firstCertificate(await adapter.listCertificates());

      expect(certificate.organization).toBe('Рога, копыта и Ко');
    });

    it('unwraps a quoted DN value and collapses doubled internal quotes (RFC 2253 quoted-string)', async () => {
      // Реально встретилось на живом сертификате 2026-09-25, не гипотетический случай.
      const store = makeStore([{ thumbprint: 'QUOTED-ISSUER', issuerName: 'CN="ООО ""Сертум-Про"""' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificate = firstCertificate(await adapter.listCertificates());

      expect(certificate.issuerName).toBe('ООО "Сертум-Про"');
    });

    it('does not split a quoted DN value on a comma inside the quotes', async () => {
      const store = makeStore([{ thumbprint: 'QUOTED-COMMA', subjectName: 'CN=Иванов Иван, O="ООО ""Ромашка, Инвест"""' }]);
      stubWindowCadesplugin(makeCadesplugin({ store }));
      const adapter = new WindowCadesPluginAdapter();

      const certificate = firstCertificate(await adapter.listCertificates());

      expect(certificate.organization).toBe('ООО "Ромашка, Инвест"');
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
