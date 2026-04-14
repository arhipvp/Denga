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
  - `GET /api/health/ready` для readiness c деталями по database/storage/runtime config, queue lag и dead-letter jobs
  - `GET /api/metrics` для lightweight process metrics без внешнего monitoring stack

## Queue and Jobs

- DB-backed queue теперь поддерживает:
  - `dedupeKey` для идемпотентного enqueue
  - `correlationId` для сквозной observability
  - `leaseExpiresAt` для reclaim зависших `running` jobs
- Job statuses:
  - `pending`
  - `running`
  - `completed`
  - `failed`
  - `dead_letter`
- Worker использует registry-based dispatch вместо роста одного `if/elif` chain.
- Retry path переводит job обратно в `pending` c `notBefore`; после исчерпания попыток job уходит в `dead_letter`.

## Domain Boundaries

- В Python backend добавлены явные слои:
  - `app/domain` для чистых state machine и policy helpers
  - `app/repositories` для SQLAlchemy-backed persistence
  - `app/use_cases` для application orchestration поверх repositories
- `app/workflows.py` сохранен только как compatibility facade для worker/tests; новая логика должна идти в `app/use_cases/*`, а не возвращаться в facade.
- Архитектурные правила:
  - `domain` не импортирует `sqlalchemy`, `fastapi` и transport adapters
  - `use_cases` не импортируют `fastapi`
  - `repositories` не импортируют `api.py`, `worker.py` или Telegram transport
- Эти правила проверяются архитектурными smoke tests.

## Draft Lifecycle

- Canonical draft lifecycle формализован через state machine в `app/domain/draft_state.py`.
- Canonical owner состояния теперь `PendingOperationReview`; `SourceMessage.status` и `ClarificationSession.status` синхронизируются как derived state через `DraftRepository.transition_review(...)`.
- Ключевые переходы:
  - `received -> parsed -> pending_review`
  - `pending_review -> needs_clarification | clarification_enqueued | confirmed | cancelled | expired`
  - `clarification_enqueued -> pending_review | needs_clarification | cancelled | expired`
- Новые сценарии должны менять draft state только через transition helpers, а не ad hoc присваиваниями.
- Feature flags:
  - `feature_strict_draft_state_enabled` включает жесткую валидацию invalid transitions
  - `feature_job_dedupe_enabled` и `feature_dead_letter_jobs_enabled` управляют risky queue behavior без смены публичного API

## Web Admin

- `Dashboard` больше не держит весь section-specific state внутри одного компонента.
- Состояние разрезано по feature hooks:
  - `useOperationsSection`
  - `useCategoriesSection`
  - `useSettingsSection`
  - `useLogsSection`
- Typed API access сгруппирован в `createDashboardFeatureApi`, чтобы операции, категории, настройки и dataset loading имели явные границы.

## Growth Rules

- Бизнес-правила и вычисления должны жить в чистых utility/domain-модулях без прямой зависимости от HTTP-фреймворка, SQLAlchemy ORM-сессии или React, если логику можно проверить без I/O.
- Доступ к БД допустим только в repository- и orchestration-слое. UI helpers, summary calculators и draft transition helpers не должны читать базу напрямую.
- Новый Telegram flow добавляется через отдельный coordinator, transition helper или renderer, а не через разрастание одного lifecycle-файла.
- Новая dashboard section должна иметь собственный hook/controller или action-module. `Dashboard` остаётся composition root.
- Если сценарий можно вынести в отдельный use case/service без изменения публичного API, расширение должно идти через extraction, а не через рост existing god-file.
- Engineering gate: если файл приближается к `300-400` строкам и одновременно держит несколько ответственностей, следующая доработка начинается с выделения отдельного модуля.
