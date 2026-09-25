import type { CryptoProAdapter } from './CryptoProAdapter.js';
import type { CadesCertificate, CadesPlugin, CadesStore } from './cadesplugin.types.js';

/**
 * `CryptoProAdapter` поверх `window.cadesplugin` (КриптоПро ЭЦП Browser plug-in). Собрано против
 * официальной документации CryptoPro и демо-примеров (`docs.cryptopro.ru/cades/plugin/*`,
 * `cadesplugin_api.js`, `async_code.js` с cryptopro.ru) и проверено 2026-09-25 на реальном стенде
 * (`manual-test/index.html`) — все три метода отработали на настоящем плагине и хранилище
 * сертификатов, включая `Decrypt()` без явного указания сертификата. См. `docs/roadmap.md`,
 * открытый вопрос 1 — что именно проверено и что осталось непроверенным.
 */
export class WindowCadesPluginAdapter implements CryptoProAdapter {
  /**
   * Возвращает только сертификаты, пригодные для аутентификации по ЭП в Контур.ОФД (ГОСТ-алгоритм,
   * не просрочен, есть закрытый ключ) — непригодные тихо пропускаются, а не попадают в список
   * потребителю на выбор. См. `docs/roadmap.md`, открытый вопрос 2 — живой тест показал, что
   * реальное хранилище пользователя обычно содержит и непригодные сертификаты (RSA, служебные).
   */
  async listCertificateThumbprints(): Promise<readonly string[]> {
    return this.withStore(async (store) => {
      const certificates = await store.Certificates;
      const count = await certificates.Count;

      const thumbprints: string[] = [];
      for (let i = 1; i <= count; i++) {
        const certificate = await certificates.Item(i);
        if ((await unsuitabilityReasons(certificate)).length === 0) {
          thumbprints.push(normalizeThumbprint(await certificate.Thumbprint));
        }
      }

      return thumbprints;
    });
  }

  /**
   * В отличие от `listCertificateThumbprints()`, здесь сертификат передаётся явно потребителем
   * (например, в обход UI выбора) — поэтому на непригодный сертификат бросаем понятную ошибку с
   * перечислением причин, а не молча пропускаем.
   */
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

  /**
   * `thumbprint` не участвует в самом вызове — `CPEnvelopedData.Decrypt()` не принимает сертификат
   * как параметр, ищет подходящий приватный ключ в хранилище сам по содержимому CMS-конверта (см.
   * `CryptoProAdapter::decryptEncryptedKey()`). Метод интерфейса всё равно принимает только
   * `encryptedKeyBase64` — сигнатура уже отражает это, здесь просто отдельно проговорено, почему.
   */
  async decryptEncryptedKey(encryptedKeyBase64: string): Promise<string> {
    const { plugin: cadesplugin } = await getCadesplugin();
    const envelopedData = await cadesplugin.CreateObjectAsync('CAdESCOM.CPEnvelopedData');

    try {
      // Обязательно до чтения Content — иначе плагин отдаст UCS2LE-строку вместо Base64 байт
      // (см. cadesplugin.types.ts).
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

/**
 * `window.cadesplugin` — сам нативный Promise; резолвится после загрузки плагина со значением
 * `undefined`, поэтому после `await` используем сам объект `cadesplugin`, а не то, чем разрешился
 * `await` (см. `cadesplugin.types.ts`). Отклоняется, если плагин не установлен/не загрузился за
 * таймаут (по умолчанию 20с, `window.cadesplugin_load_timeout`).
 */
async function getCadesplugin(): Promise<{ readonly plugin: CadesPlugin }> {
  if (typeof window === 'undefined' || window.cadesplugin === undefined) {
    throw new Error(
      'window.cadesplugin is not available — is the КриптоПро ЭЦП Browser plug-in installed and enabled?',
    );
  }

  const cadesplugin = window.cadesplugin;
  await cadesplugin;

  // Не `return cadesplugin` — сам cadesplugin thenable, async-функция схлопнула бы его до
  // разрешённого значения (undefined) вместо возврата самого объекта. Заворачиваем в обычный
  // объект, который thenable не является.
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

/** Регистр/пробелы вокруг отпечатка не задокументированы явно — сравниваем без оглядки на них, а не на удачу. */
function normalizeThumbprint(thumbprint: string): string {
  return thumbprint.trim().toUpperCase();
}

/** `Export()` не документирует, добавляет ли перевод строк в Base64-вывод — на всякий случай убираем весь whitespace. */
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

/**
 * OID алгоритмов ГОСТ Р 34.10, которые Контур.ОФД поддерживает для ЭП-аутентификации (RFC 4491
 * §2.3.2 для 2001-го, RFC 9215 §4.1 для 2012-го) — точный список, не префиксная проверка
 * "начинается с 1.2.643": под той же веткой (`iso.member-body.ru`) лежит и устаревший ключевой OID
 * ГОСТ Р 34.10-94, который не должен молча проходить проверку как современный алгоритм.
 */
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

/**
 * Сравниваем даты вручную, а не через `Certificate.IsValid()` — тот строит полную цепочку
 * сертификатов и может обращаться в сеть за проверкой отзыва (поведение `CheckFlag` для
 * CryptoPro не задокументировано, у Microsoft CAPICOM по умолчанию — `CAPICOM_CHECK_ONLINE_ALL`),
 * что не годится для быстрой локальной фильтрации списка сертификатов.
 */
async function isWithinValidityPeriod(certificate: CadesCertificate): Promise<boolean> {
  const [validFrom, validTo] = await Promise.all([certificate.ValidFromDate, certificate.ValidToDate]);
  const now = Date.now();

  return new Date(validFrom).getTime() <= now && now <= new Date(validTo).getTime();
}

/** Пустой массив — сертификат пригоден для аутентификации по ЭП в Контур.ОФД. */
async function unsuitabilityReasons(certificate: CadesCertificate): Promise<readonly string[]> {
  const [isGost, isValidPeriod, hasPrivateKey] = await Promise.all([
    isGostCertificate(certificate),
    isWithinValidityPeriod(certificate),
    certificate.HasPrivateKey(),
  ]);

  const reasons: string[] = [];
  if (!isGost) reasons.push('does not use a GOST public-key algorithm supported by Kontur.OFD (ГОСТ Р 34.10-2001/2012)');
  if (!isValidPeriod) reasons.push('is expired or not yet valid');
  if (!hasPrivateKey) reasons.push('has no private key available in the current user\'s store');

  return reasons;
}
