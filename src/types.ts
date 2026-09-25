/**
 * Данные, которыми браузер обменивается со своим backend (relsy или любым другим потребителем) —
 * не с Контур.ОФД напрямую: `api.kontur.ru` не отдаёт CORS-заголовков ни на одном эндпоинте
 * (проверено эмпирически, см. `docs/roadmap.md`), поэтому сетевые вызовы к Контур.ОФД всегда на
 * стороне backend (например, `kontur-ofd-php-sdk`'s `AuthClient`), эта библиотека сети не касается
 * вовсе — только браузерная ГОСТ-операция между двумя вызовами backend.
 */

/** Ответ backend-прокси на шаг `authenticate-by-cert` — зеркалит `EncryptedKeyResult` из `kontur-ofd-php-sdk`. */
export interface EncryptedKeyResponse {
  /** Base64, зашифрован на сертификат по ГОСТ 28147-89 — расшифровать может только держатель приватного ключа. */
  readonly encryptedKeyBase64: string;
  /** Абсолютный URL для следующего шага (`approve-cert`) — уже содержит `thumbprint` в query, идти по нему как есть. */
  readonly approveCertUrl: string;
}

/** Тело запроса на backend-прокси шага `approve-cert`. */
export interface ApproveCertPayload {
  readonly approveCertUrl: string;
  /** Base64 результата расшифровки `encryptedKeyBase64` — то, что backend передаст в `approve-cert` как есть. */
  readonly decryptedBytesBase64: string;
}
