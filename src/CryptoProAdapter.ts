/**
 * Контракт с браузерным плагином КриптоПро ЭЦП Browser plug-in. `WindowCadesPluginAdapter` —
 * реализация поверх `window.cadesplugin`/`CAdESCOM.*` (см. `docs/roadmap.md`, M1 — проверено против
 * официальной документации CryptoPro и демо-примеров, не запускалось на реальном стенде с реальным
 * `EncryptedKey`, см. открытый вопрос 1). Интерфейс остаётся отдельным от реализации, чтобы
 * `certificateAuthFlow.ts` тестировался через мок, без реального плагина/браузера.
 */
export interface CryptoProAdapter {
  /** Отпечатки сертификатов, доступных плагину (обычно — на подключённом токене). */
  listCertificateThumbprints(): Promise<readonly string[]>;

  /** Сертификат электронной подписи в Base-64 — то, что уходит в `authenticate-by-cert` как есть. */
  getCertificateBase64(thumbprint: string): Promise<string>;

  /**
   * Расшифровывает `encryptedKeyBase64` (см. `EncryptedKeyResponse`) — **без указания сертификата**:
   * `CAdESCOM.CPEnvelopedData.Decrypt()` (см. `WindowCadesPluginAdapter`) сам ищет в хранилище
   * приватный ключ, подходящий под конкретный CMS-конверт, а не берёт первый попавшийся или
   * переданный явно — сама зашифрованная структура определяет, чьим ключом её можно открыть.
   * Приватный ключ не покидает плагин/токен, наружу отдаётся только результат.
   *
   * @returns Base64 расшифрованных байт, готовых для `ApproveCertPayload.decryptedBytesBase64`.
   */
  decryptEncryptedKey(encryptedKeyBase64: string): Promise<string>;
}
