/**
 * Контракт с браузерным плагином КриптоПро ЭЦП Browser plug-in — сама эта библиотека НЕ
 * реализует ни один метод (см. `docs/roadmap.md`, открытый вопрос 1: точный вызов плагина для
 * расшифровки ГОСТ-блоба из `authenticate-by-cert` не проверен ни на одном реальном стенде).
 * Реализацию адаптера предоставляет потребитель — тонкая обёртка над `window.cadesplugin`/
 * `CAdESCOM.*`, которую можно протестировать и заменить независимо от логики в
 * `certificateAuthFlow.ts` (та тестируется через мок этого интерфейса, без реального плагина).
 */
export interface CryptoProAdapter {
  /** Отпечатки сертификатов, доступных плагину (обычно — на подключённом токене). */
  listCertificateThumbprints(): Promise<readonly string[]>;

  /** Сертификат электронной подписи в Base-64 — то, что уходит в `authenticate-by-cert` как есть. */
  getCertificateBase64(thumbprint: string): Promise<string>;

  /**
   * Расшифровывает `encryptedKeyBase64` (см. `EncryptedKeyResponse`) приватным ключом сертификата
   * `thumbprint` — приватный ключ не покидает плагин/токен, наружу отдаётся только результат.
   *
   * @returns Base64 расшифрованных байт, готовых для `ApproveCertPayload.decryptedBytesBase64`.
   */
  decryptEncryptedKey(encryptedKeyBase64: string, thumbprint: string): Promise<string>;
}
