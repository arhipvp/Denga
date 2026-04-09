# Architecture Notes

## API

- `TelegramService` теперь является тонким фасадом и только делегирует входящий update в `UpdateRouterService`.
- Telegram pipeline разделен на отдельные сервисы:
  - `UpdateRouterService`: маршрутизация входящих Telegram updates
  - `MessageIngestionService`: прием нового сообщения, upsert автора, создание `SourceMessage`
  - `AttachmentService`: работа с Telegram file API и подготовка вложений
- `DraftLifecycleService`: parse/create/render/confirm/cancel review drafts
  - `ClarificationService`: callback actions, ручные правки, постраничный category picker и reparse clarification-flow
  - `TelegramDeliveryService`: `sendMessage`, `editMessageText`, `answerCallbackQuery`, retry network requests
  - `TelegramDraftService`: чистые draft helpers, эвристики, normalizers и rendering текста
- `DraftLifecycleService` сохраняет в `AiParseAttempt.prompt` диагностический snapshot, где итоговый runtime `system prompt` содержит список переданных категорий.

## Transaction Core

- Общие правила подтверждения операций и проверки соответствия категории вынесены в `TransactionCoreService`.
- `TransactionService` и Telegram draft confirmation используют один и тот же core path.
- Single-household допущение централизовано через `HouseholdContextService`.

## Runtime and Health

- На старте API выполняется `RuntimeValidationService`.
- Runtime validation:
  - проверяет обязательные env
  - различает hard errors и degraded-mode warnings
  - гарантирует наличие рабочих каталогов `uploads`, `backups`, `logs`
- Health endpoints:
  - `GET /api/health` для liveness
  - `GET /api/health/ready` для readiness c деталями по database/storage/runtime config

## Web Admin

- `Dashboard` больше не держит весь section-specific state внутри одного компонента.
- Состояние разрезано по feature hooks:
  - `useOperationsSection`
  - `useCategoriesSection`
  - `useSettingsSection`
  - `useLogsSection`
- Typed API access сгруппирован в `createDashboardFeatureApi`, чтобы операции, категории, настройки и dataset loading имели явные границы.

## Growth Rules

- Бизнес-правила и вычисления должны жить в чистых utility/domain-модулях без прямой зависимости от HTTP-фреймворка, Prisma или React, если логику можно проверить без I/O.
- `PrismaService` допустим только в orchestration- и repository-слое. UI helpers, summary calculators и draft transition helpers не должны читать базу напрямую.
- Новый Telegram flow добавляется через отдельный coordinator, transition helper или renderer, а не через разрастание одного lifecycle-файла.
- Новая dashboard section должна иметь собственный hook/controller или action-module. `Dashboard` остаётся composition root.
- Если сценарий можно вынести в отдельный use case/service без изменения публичного API, расширение должно идти через extraction, а не через рост existing god-file.
- Engineering gate: если файл приближается к `300-400` строкам и одновременно держит несколько ответственностей, следующая доработка начинается с выделения отдельного модуля.
