/**
 * Минимальные внутренние типы под `window.cadesplugin`/CAdESCOM — только то, что реально
 * используется в `WindowCadesPluginAdapter.ts`, не полный слепок API плагина. Собрано из
 * официальной документации CryptoPro (`docs.cryptopro.ru/cades/plugin/*`,
 * `docs.cryptopro.ru/cades/reference/cadescom/*`) и `cadesplugin_api.js`/демо-примеров с сайта
 * cryptopro.ru — не из npm-типов (`cadesplugin-types` не публиковался с 2022 и не покрывает
 * `CPEnvelopedData`).
 *
 * Свойства везде — `Promise<T>`, не `T`: сам плагин работает через Native Messaging, каждое чтение
 * свойства COM-объекта асинхронно (`await obj.Prop`, не `obj.Prop`). Запись — через
 * `propset_<Имя>(value)`, отдельного сеттер-синтаксиса нет.
 */

/** `CAdESCOM.Store` (`docs.cryptopro.ru/cades/reference/cadescom/cadescom_class/store`). */
export interface CadesStore {
  Open(location: number, storeName: string, mode: number): Promise<void>;
  Close(): Promise<void>;
  readonly Certificates: Promise<CadesCertificates>;
}

/** Коллекция сертификатов — только `Count`/`Item` реализованы плагином, `Item` с индексацией от 1. */
export interface CadesCertificates {
  readonly Count: Promise<number>;
  Item(index: number): Promise<CadesCertificate>;
}

/** `CAdESCOM.Oid` — идентификатор алгоритма (`docs.cryptopro.ru/cades/reference/cadescom/cadescom_class/oid`). */
export interface CadesOid {
  readonly Value: Promise<string>;
}

/** `CAdESCOM.PublicKey` (`docs.cryptopro.ru/cades/reference/cadescom/cadescom_class/publickey`). */
export interface CadesPublicKey {
  readonly Algorithm: Promise<CadesOid>;
}

/**
 * `CAdESCOM.KeyUsage` (`docs.cryptopro.ru/cades/reference/cadescom/cadescom_class/keyusage`) —
 * декодированное расширение X.509 KeyUsage (OID `2.5.29.15`); разбирать DER-битовую строку вручную
 * не нужно, плагин уже даёт именованные булевы флаги. На практике (проверено на реальном плагине
 * 2026-09-25) `Is*Enabled` резолвятся числом `0`/`1`, не булевым `false`/`true` — для `||`/`if` это
 * не важно (JS приводит `0`/`1` к falsy/truthy сам), но не полагайтесь на `=== true`.
 */
export interface CadesKeyUsage {
  readonly IsPresent: Promise<boolean>;
  readonly IsKeyEnciphermentEnabled: Promise<boolean>;
  readonly IsKeyAgreementEnabled: Promise<boolean>;
}

/**
 * `CAdESCOM.Certificate` (тип библиотеки — `CPCertificate`). `PublicKey`/`KeyUsage` — методы, не
 * свойства (в отличие от `Thumbprint`/`ValidFromDate`/`ValidToDate`) — так задокументировано в
 * `cadescom_class/cpcertificate` и подтверждено официальным демо-кодом (`async_code.js`:
 * `await cert.PublicKey()`, не `await cert.PublicKey`).
 */
export interface CadesCertificate {
  readonly Thumbprint: Promise<string>;
  /** Официальный демо-код оборачивает результат в `new Date(...)` — сам плагин не гарантирует тип. */
  readonly ValidFromDate: Promise<string>;
  readonly ValidToDate: Promise<string>;
  /**
   * Необязательное расширение (OID `2.5.29.16`) — есть не у каждого сертификата. Официальная
   * документация не описывает поведение при его отсутствии; демо-код CryptoPro читает оба свойства
   * в try/catch и получает `null`, если расширения нет — поэтому тип включает `null`.
   */
  readonly PrivateKeyUsagePeriodFrom: Promise<string | null>;
  readonly PrivateKeyUsagePeriodTo: Promise<string | null>;
  Export(encoding: number): Promise<string>;
  PublicKey(): Promise<CadesPublicKey>;
  KeyUsage(): Promise<CadesKeyUsage>;
  /** Проверяет только наличие `CERT_KEY_PROV_INFO_PROP_ID` — не гарантирует, что контейнер ключа реально доступен. */
  HasPrivateKey(): Promise<boolean>;
}

/**
 * `CAdESCOM.CPEnvelopedData` — расшифровка CMS/PKCS#7 EnvelopedData с поддержкой ГОСТ 28147-89.
 * `ContentEncoding` обязательно выставить до чтения `Content` — иначе плагин вернёт UCS2LE-строку
 * вместо Base64 произвольных байт (по умолчанию `CADESCOM_STRING_TO_UCS2LE`, нам нужен
 * `CADESCOM_BASE64_TO_BINARY`, см. `CADESCOM_CONTENT_ENCODING` в `WindowCadesPluginAdapter.ts`).
 */
export interface CadesEnvelopedData {
  propset_ContentEncoding(value: number): Promise<void>;
  /** Ничего не возвращает — искать сертификат/приватный ключ получателя плагин решает сам, по содержимому конверта, не по явно переданному сертификату. */
  Decrypt(envelopedMessageBase64: string): Promise<void>;
  readonly Content: Promise<string>;
}

/**
 * `window.cadesplugin` — сам является нативным `Promise` (резолвится после загрузки плагина, со
 * значением `undefined` — после `await` используется сам объект `cadesplugin`, не результат
 * ожидания), плюс на него навешаны методы/константы.
 */
export interface CadesPlugin extends Promise<void> {
  CreateObjectAsync(progId: 'CAdESCOM.Store'): Promise<CadesStore>;
  CreateObjectAsync(progId: 'CAdESCOM.CPEnvelopedData'): Promise<CadesEnvelopedData>;
  /** Человекочитаемое сообщение об ошибке (`"текст (0xHEX)"`) — на Firefox единственный способ узнать код. */
  getLastError(exception: unknown): string;
  readonly CAPICOM_CURRENT_USER_STORE: number;
  readonly CAPICOM_MY_STORE: string;
  readonly CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: number;
  /** НЕ `CAPICOM_ENCODE_BASE64` — той константы в `cadesplugin_api.js` нет, только `CADESCOM_*`. */
  readonly CADESCOM_ENCODE_BASE64: number;
  readonly CADESCOM_BASE64_TO_BINARY: number;
}

declare global {
  interface Window {
    cadesplugin?: CadesPlugin;
  }
}
