import type { CertificateSummary, CryptoProAdapter } from './CryptoProAdapter.js';
import type { CadesCertificate, CadesPlugin, CadesStore } from './cadesplugin.types.js';

/** `CryptoProAdapter` поверх `window.cadesplugin` (КриптоПро ЭЦП Browser plug-in) — verified against real hardware 2026-09-25, see docs/roadmap.md. */
export class WindowCadesPluginAdapter implements CryptoProAdapter {
  /** Только сертификаты, пригодные для аутентификации по ЭП в Контур.ОФД — непригодные тихо пропускаются. */
  async listCertificates(): Promise<readonly CertificateSummary[]> {
    return this.withStore(async (store) => {
      const certificates = await store.Certificates;
      const count = await certificates.Count;

      const summaries: CertificateSummary[] = [];
      for (let i = 1; i <= count; i++) {
        const certificate = await certificates.Item(i);
        if ((await unsuitabilityReasons(certificate)).length === 0) {
          summaries.push(await describeCertificate(certificate));
        }
      }

      return summaries;
    });
  }

  /** В отличие от `listCertificates()`, сертификат передан явно — на непригодный бросаем ошибку с причинами, а не молча пропускаем. */
  async getCertificateBase64(thumbprint: string): Promise<string> {
    const { plugin: cadesplugin } = await getCadesplugin();

    return this.withStore(async (store) => {
      const certificate = await findCertificateByThumbprint(store, thumbprint);
      const reasons = await unsuitabilityReasons(certificate);
      if (reasons.length > 0) {
        throw new Error(
          `Certificate "${thumbprint}" is not suitable for Kontur.OFD certificate-based auth: ${reasons.join('; ')}`,
        );
      }

      const exported = await certificate.Export(cadesplugin.CADESCOM_ENCODE_BASE64);

      return stripWhitespace(exported);
    });
  }

  /** Сертификат в вызов не передаётся — `Decrypt()` сам находит нужный ключ по содержимому CMS-конверта. */
  async decryptEncryptedKey(encryptedKeyBase64: string): Promise<string> {
    const { plugin: cadesplugin } = await getCadesplugin();
    const envelopedData = await cadesplugin.CreateObjectAsync('CAdESCOM.CPEnvelopedData');

    try {
      // До Decrypt() — иначе Content придёт UCS2LE-строкой, не Base64.
      await envelopedData.propset_ContentEncoding(cadesplugin.CADESCOM_BASE64_TO_BINARY);
      await envelopedData.Decrypt(encryptedKeyBase64);

      return await envelopedData.Content;
    } catch (error) {
      throw new Error(`CAdESCOM.CPEnvelopedData.Decrypt() failed: ${describeError(cadesplugin, error)}`, {
        cause: error,
      });
    }
  }

  private async withStore<T>(callback: (store: CadesStore) => Promise<T>): Promise<T> {
    const { plugin: cadesplugin } = await getCadesplugin();
    const store = await cadesplugin.CreateObjectAsync('CAdESCOM.Store');
    await store.Open(
      cadesplugin.CAPICOM_CURRENT_USER_STORE,
      cadesplugin.CAPICOM_MY_STORE,
      cadesplugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
    );

    try {
      return await callback(store);
    } finally {
      await store.Close();
    }
  }
}

/** `window.cadesplugin` сам является Promise, резолвится в `undefined` — после `await` используем сам объект, не результат ожидания. */
async function getCadesplugin(): Promise<{ readonly plugin: CadesPlugin }> {
  if (typeof window === 'undefined' || window.cadesplugin === undefined) {
    throw new Error(
      'window.cadesplugin is not available — is the КриптоПро ЭЦП Browser plug-in installed and enabled?',
    );
  }

  const cadesplugin = window.cadesplugin;
  await cadesplugin;

  // Не `return cadesplugin` — thenable-chaining схлопнёт его до undefined.
  return { plugin: cadesplugin };
}

async function findCertificateByThumbprint(store: CadesStore, thumbprint: string): Promise<CadesCertificate> {
  const target = normalizeThumbprint(thumbprint);
  const certificates = await store.Certificates;
  const count = await certificates.Count;

  for (let i = 1; i <= count; i++) {
    const certificate = await certificates.Item(i);
    if (normalizeThumbprint(await certificate.Thumbprint) === target) {
      return certificate;
    }
  }

  throw new Error(`Certificate with thumbprint "${thumbprint}" was not found in the current user's store`);
}

function normalizeThumbprint(thumbprint: string): string {
  return thumbprint.trim().toUpperCase();
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

function describeError(cadesplugin: CadesPlugin, error: unknown): string {
  try {
    return cadesplugin.getLastError(error);
  } catch {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Точные OID (не префикс `1.2.643.` — та же ветка содержит устаревший ГОСТ Р 34.10-94). */
const GOST_PUBLIC_KEY_ALGORITHM_OIDS: ReadonlySet<string> = new Set([
  '1.2.643.2.2.19', // GOST R 34.10-2001
  '1.2.643.7.1.1.1.1', // GOST R 34.10-2012, 256 бит
  '1.2.643.7.1.1.1.2', // GOST R 34.10-2012, 512 бит
]);

async function isGostCertificate(certificate: CadesCertificate): Promise<boolean> {
  const publicKey = await certificate.PublicKey();
  const algorithm = await publicKey.Algorithm;
  const oid = await algorithm.Value;

  return GOST_PUBLIC_KEY_ALGORITHM_OIDS.has(oid);
}

/** Вручную, не через `Certificate.IsValid()` — тот строит цепочку и может ходить в сеть за отзывом. */
async function isWithinValidityPeriod(certificate: CadesCertificate): Promise<boolean> {
  const [validFrom, validTo] = await Promise.all([certificate.ValidFromDate, certificate.ValidToDate]);
  const now = Date.now();

  return new Date(validFrom).getTime() <= now && now <= new Date(validTo).getTime();
}

/** Необязательное расширение — отсутствие/ошибка чтения трактуется как «нет ограничения», не как непригодность. */
async function isWithinPrivateKeyUsagePeriod(certificate: CadesCertificate): Promise<boolean> {
  const now = Date.now();
  const [from, to] = await Promise.all([
    readOptionalDate(() => certificate.PrivateKeyUsagePeriodFrom),
    readOptionalDate(() => certificate.PrivateKeyUsagePeriodTo),
  ]);

  if (from !== null && now < from.getTime()) return false;
  if (to !== null && now > to.getTime()) return false;

  return true;
}

async function readOptionalDate(read: () => Promise<string | null>): Promise<Date | null> {
  try {
    const value = await read();
    if (value === null) return null;

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/** Тоже необязательное расширение; при наличии требуем keyEncipherment ИЛИ keyAgreement. */
async function allowsKeyExchange(certificate: CadesCertificate): Promise<boolean> {
  const keyUsage = await certificate.KeyUsage();
  if (!(await keyUsage.IsPresent)) return true;

  const [keyEncipherment, keyAgreement] = await Promise.all([
    keyUsage.IsKeyEnciphermentEnabled,
    keyUsage.IsKeyAgreementEnabled,
  ]);

  return keyEncipherment || keyAgreement;
}

async function describeCertificate(certificate: CadesCertificate): Promise<CertificateSummary> {
  const [thumbprint, subjectName, issuerName, validTo] = await Promise.all([
    certificate.Thumbprint,
    certificate.SubjectName,
    certificate.IssuerName,
    certificate.ValidToDate,
  ]);

  const subject = parseDistinguishedName(subjectName);
  const issuer = parseDistinguishedName(issuerName);

  return {
    thumbprint: normalizeThumbprint(thumbprint),
    ownerName: subject.get('CN') ?? null,
    organization: subject.get('O') ?? null,
    issuerName: issuer.get('CN') ?? null,
    validTo: new Date(validTo),
    inn: subject.get('ИНН') ?? null,
    ogrn: subject.get('ОГРН') ?? subject.get('ОГРНИП') ?? null,
  };
}

/** Разбор DN-строки — так же, как официальный демо-код CryptoPro (CN= из SubjectName/IssuerName, не GetInfo()). */
function parseDistinguishedName(dn: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();

  for (const rawComponent of splitDnComponents(dn)) {
    const component = rawComponent.trim();
    const equalsIndex = component.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = component.slice(0, equalsIndex).trim().toUpperCase();
    const rawValue = component.slice(equalsIndex + 1).trim();
    const value = unquoteDnValue(rawValue).replace(/\\(.)/g, '$1');
    if (value !== '' && !result.has(key)) {
      result.set(key, value);
    }
  }

  return result;
}

/** RFC 2253 quoted-string (`"ООО ""Ромашка"""`) — снимаем внешние кавычки, схлопываем `""` в одну. */
function unquoteDnValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }

  return value;
}

function splitDnComponents(value: string): readonly string[] {
  const parts: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (char === '\\' && i + 1 < value.length) {
      current += char + value.charAt(i + 1);
      i++;
      continue;
    }
    if (char === '"') {
      insideQuotes = !insideQuotes;
      current += char;
      continue;
    }
    if (char === ',' && !insideQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts;
}

/** Пустой массив — сертификат пригоден для аутентификации по ЭП в Контур.ОФД. */
async function unsuitabilityReasons(certificate: CadesCertificate): Promise<readonly string[]> {
  const [isGost, isValidPeriod, hasPrivateKey, isWithinKeyPeriod, canExchangeKey] = await Promise.all([
    isGostCertificate(certificate),
    isWithinValidityPeriod(certificate),
    certificate.HasPrivateKey(),
    isWithinPrivateKeyUsagePeriod(certificate),
    allowsKeyExchange(certificate),
  ]);

  const reasons: string[] = [];
  if (!isGost)
    reasons.push('does not use a GOST public-key algorithm supported by Kontur.OFD (ГОСТ Р 34.10-2001/2012)');
  if (!isValidPeriod) reasons.push('is expired or not yet valid');
  if (!hasPrivateKey) reasons.push("has no private key available in the current user's store");
  if (!isWithinKeyPeriod)
    reasons.push(
      'is outside its PrivateKeyUsagePeriod (private key itself has expired separately from the certificate)',
    );
  if (!canExchangeKey)
    reasons.push('KeyUsage does not permit key encipherment or key agreement (likely a signature-only certificate)');

  return reasons;
}
