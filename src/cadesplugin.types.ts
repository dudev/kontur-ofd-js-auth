/** Минимальные типы под `window.cadesplugin`/CAdESCOM — только то, что использует `WindowCadesPluginAdapter.ts`. Все свойства — `Promise<T>` (Native Messaging), запись — через `propset_<Имя>(value)`. */

/** `CAdESCOM.Store`. */
export interface CadesStore {
  Open(location: number, storeName: string, mode: number): Promise<void>;
  Close(): Promise<void>;
  readonly Certificates: Promise<CadesCertificates>;
}

/** Коллекция сертификатов — `Item` с индексацией от 1. */
export interface CadesCertificates {
  readonly Count: Promise<number>;
  Item(index: number): Promise<CadesCertificate>;
}

/** `CAdESCOM.Oid`. */
export interface CadesOid {
  readonly Value: Promise<string>;
}

/** `CAdESCOM.PublicKey`. */
export interface CadesPublicKey {
  readonly Algorithm: Promise<CadesOid>;
}

/** `CAdESCOM.KeyUsage` — декодированное расширение X.509 (OID 2.5.29.15); `Is*Enabled` резолвятся `0`/`1`, не `false`/`true`. */
export interface CadesKeyUsage {
  readonly IsPresent: Promise<boolean>;
  readonly IsKeyEnciphermentEnabled: Promise<boolean>;
  readonly IsKeyAgreementEnabled: Promise<boolean>;
}

/** `CAdESCOM.Certificate` (CPCertificate). `PublicKey`/`KeyUsage` — методы, не свойства. */
export interface CadesCertificate {
  readonly Thumbprint: Promise<string>;
  /** DN-строка (`"CN=..., ИНН=..."`) — формат не гарантирован официальной документацией. */
  readonly SubjectName: Promise<string>;
  readonly IssuerName: Promise<string>;
  readonly ValidFromDate: Promise<string>;
  readonly ValidToDate: Promise<string>;
  /** Необязательное расширение (OID 2.5.29.16) — `null`, если у сертификата его нет. */
  readonly PrivateKeyUsagePeriodFrom: Promise<string | null>;
  readonly PrivateKeyUsagePeriodTo: Promise<string | null>;
  Export(encoding: number): Promise<string>;
  PublicKey(): Promise<CadesPublicKey>;
  KeyUsage(): Promise<CadesKeyUsage>;
  HasPrivateKey(): Promise<boolean>;
}

/** `CAdESCOM.CPEnvelopedData` — расшифровка CMS/PKCS#7 с ГОСТ 28147-89. `ContentEncoding` выставляется до чтения `Content`. */
export interface CadesEnvelopedData {
  propset_ContentEncoding(value: number): Promise<void>;
  Decrypt(envelopedMessageBase64: string): Promise<void>;
  readonly Content: Promise<string>;
}

/** `window.cadesplugin` — сам нативный `Promise`, резолвится в `undefined`; методы/константы навешаны на него же. */
export interface CadesPlugin extends Promise<void> {
  CreateObjectAsync(progId: 'CAdESCOM.Store'): Promise<CadesStore>;
  CreateObjectAsync(progId: 'CAdESCOM.CPEnvelopedData'): Promise<CadesEnvelopedData>;
  getLastError(exception: unknown): string;
  readonly CAPICOM_CURRENT_USER_STORE: number;
  readonly CAPICOM_MY_STORE: string;
  readonly CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: number;
  readonly CADESCOM_ENCODE_BASE64: number;
  readonly CADESCOM_BASE64_TO_BINARY: number;
}

declare global {
  interface Window {
    cadesplugin?: CadesPlugin;
  }
}
