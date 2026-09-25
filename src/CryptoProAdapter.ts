/** Контракт с КриптоПро ЭЦП Browser plug-in — отдельно от `WindowCadesPluginAdapter`, чтобы `certificateAuthFlow.ts` тестировался без реального плагина. */

/** Данные сертификата для UI выбора — поля кроме `thumbprint`/`validTo` — `null`, если атрибут не найден в DN. */
export interface CertificateSummary {
  readonly thumbprint: string;
  readonly ownerName: string | null;
  readonly organization: string | null;
  readonly issuerName: string | null;
  readonly validTo: Date;
  readonly inn: string | null;
  readonly ogrn: string | null;
}

export interface CryptoProAdapter {
  /** Пригодные для аутентификации сертификаты — то, что стоит предложить пользователю на выбор. */
  listCertificates(): Promise<readonly CertificateSummary[]>;

  /** Сертификат электронной подписи в Base-64 — то, что уходит в `authenticate-by-cert` как есть. */
  getCertificateBase64(thumbprint: string): Promise<string>;

  /** Без указания сертификата — плагин сам находит подходящий приватный ключ по содержимому CMS-конверта. */
  decryptEncryptedKey(encryptedKeyBase64: string): Promise<string>;
}
