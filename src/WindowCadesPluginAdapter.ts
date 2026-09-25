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
  async listCertificateThumbprints(): Promise<readonly string[]> {
    return this.withStore(async (store) => {
      const certificates = await store.Certificates;
      const count = await certificates.Count;

      const thumbprints: string[] = [];
      for (let i = 1; i <= count; i++) {
        const certificate = await certificates.Item(i);
        thumbprints.push(normalizeThumbprint(await certificate.Thumbprint));
      }

      return thumbprints;
    });
  }

  async getCertificateBase64(thumbprint: string): Promise<string> {
    const { plugin: cadesplugin } = await getCadesplugin();

    return this.withStore(async (store) => {
      const certificate = await findCertificateByThumbprint(store, thumbprint);
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
