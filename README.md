# Denga

Семейный учет доходов и расходов с приемом сообщений и чеков через Telegram-бота, AI-разбором через `Polza AI` и админ-панелью на `Next.js`.

## Стек

- `FastAPI + worker` backend для production runtime
- `Next.js` админ-панель
- `SQLAlchemy + Alembic + PostgreSQL`
- `Polza AI` через OpenAI-compatible API
- `Pillow` для генерации PNG-отчетов Telegram в Python worker
- `Docker Compose` для локального и серверного запуска
- `GitHub Actions` для CI/CD

## Что умеет MVP

- Принимать текстовые сообщения и фото чеков из Telegram
- Сохранять исходное сообщение и вложения
- Разбирать данные через AI в структурированную операцию
- Автосохранять подтвержденные операции
- Показывать черновик операции с уточняющим вопросом, если AI не уверен
- Выбирать подкатегорию операции только из активного иерархического справочника
- Давать администратору ручной CRUD операций в веб-интерфейсе
- Давать администратору ручной CRUD верхних категорий и подкатегорий с мягким отключением и восстановлением
- Показывать в админке верхние категории таблицей с раскрываемыми подкатегориями и быстрым добавлением подкатегории из строки родителя
- Показывать в админке расширенный финансовый обзор: KPI за месяц, сравнение с прошлым месяцем, тренд и топ категорий
- Показывать операции, категории, пользователей и настройки в админке
- Поддерживать в админке единый data-table UX: поиск, сортировки, пагинацию, валютные обозначения и цветовые индикаторы доходов/расходов
- Показывать во вкладке пользователей расширенный профиль участника: роль, дату создания, статусы Telegram-связок и inline-переименование display name
- Позволять администратору менять пароль из админки после входа
- Давать в настройках карточный UX с черновиком изменений, reset к последнему сохраненному состоянию и сворачиваемым advanced-блоком AI-настроек
- Создавать bootstrap-администратора из env/seed
- Хранить категории только в БД и менять их только вручную через админку
- Использовать `EUR` как базовую валюту для всех новых операций

## Быстрый старт

1. Скопируйте `.env.example` в `.env`
2. Запустите PostgreSQL:

```bash
docker compose up -d postgres
```

3. Установите зависимости и подготовьте базу:

```bash
npm ci
python -m pip install -e "apps/python_backend[dev]"
python apps/python_backend/scripts/migrate.py upgrade
python apps/python_backend/scripts/bootstrap_seed.py
```

`bootstrap_seed.py` не создает и не синхронизирует категории. Категории хранятся только в БД и управляются вручную через админку.

Для локальной разработки все следующие изменения схемы оформляйте через Alembic:

```bash
alembic -c apps/python_backend/alembic.ini revision --autogenerate -m "<migration_name>"
```

Если база уже существовала до ввода `alembic_version`, canonical helper сам пометит baseline как примененный и затем догонит БД до `head`:

```bash
python apps/python_backend/scripts/migrate.py upgrade
```

Если локальная сборка или dev-сервер оставили служебные артефакты, очистите рабочее дерево:

```bash
npm run clean
```

4. Запустите backend и frontend:

```bash
npm run dev:api
npm run dev:web
```

`NEXT_PUBLIC_API_URL` обязателен для production build и для корректной работы админки. Если переменная не задана, web-приложение не падает на prerender, а показывает явную ошибку конфигурации в UI. Для локальной разработки используйте значение вида `http://localhost:3001/api`.

5. Откройте:

- Веб: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001/api](http://localhost:3001/api)

## Docker

Проект можно поднять целиком в контейнерах:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/migrate.py upgrade
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/bootstrap_seed.py
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --remove-orphans
```

Что делает контейнерный запуск:

- поднимает PostgreSQL
- применяет Alembic-миграции через `python apps/python_backend/scripts/migrate.py upgrade`
- если база уже существовала до ввода `alembic_version`, helper автоматически помечает baseline как примененный и затем догоняет миграции до `head`
- выполняет идемпотентный `bootstrap_seed.py` только для bootstrap-данных и настроек, но не трогает категории
- затем запускаются `python-api`, `python-worker` и frontend
- файловые логи сохраняются в `./logs`, а локальные бэкапы базы в `./backups`

После запуска доступны:

- Веб: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001/api](http://localhost:3001/api)

Политика образов:

- production runtime использует только ваши образы `denga-python-api`, `denga-python-worker`, `denga-web`, опубликованные в `GHCR`
- внешние vendor-образы `node`, `python`, `postgres` используются только как upstream base layers на этапе build
- base image references в `Dockerfile` и `docker-compose.yml` pinned по digest и обновляются через dependency PR, а не вручную по loose tags

## Python backend

В репозитории production runtime по умолчанию уже переключен на `FastAPI + worker` в каталоге [`apps/python_backend`](/C:/Dev/Denga/apps/python_backend).

Что уже есть в Python-контуре:

- совместимый `/api` HTTP-слой для `auth`, `health`, `transactions`, `categories`, `users`, `settings`, `backups`, `logs`, `telegram status`
- отдельный worker entrypoint
- additive `Job`-таблица для DB-backed background execution
- основной [`docker-compose.yml`](/C:/Dev/Denga/docker-compose.yml) теперь поднимает `python-api + python-worker`
- Alembic migration helper [`apps/python_backend/scripts/migrate.py`](/C:/Dev/Denga/apps/python_backend/scripts/migrate.py) запускает schema upgrades для local/CI/deploy
- worker-parity для основного Telegram pipeline: webhook/polling update routing, draft creation, clarification reparse, category picker callbacks, confirm/cancel draft, transaction notification jobs, scheduled backup job и monthly stats reports

Быстрый запуск Python-контура:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up python-api python-worker
```

Локальная проверка Python-контура без Docker:

```bash
python -m venv apps/python_backend/.venv
apps/python_backend/.venv/Scripts/python -m pip install -e "apps/python_backend[dev]"
apps/python_backend/.venv/Scripts/python -m pytest apps/python_backend/tests -q
apps/python_backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir apps/python_backend --host 0.0.0.0 --port 3001
```

Runbook для production deploy, smoke-проверок и восстановления лежит в [`docs/python-cutover-runbook.md`](/C:/Dev/Denga/docs/python-cutover-runbook.md).

## Основные env

- `DATABASE_URL`: PostgreSQL connection string; допустим обычный DSN вида `postgresql://...`, Python backend сам нормализует его к драйверу `psycopg3`
- `POSTGRES_PORT`: публикуемый порт PostgreSQL на хосте, по умолчанию `5433`
- `JWT_SECRET`: secret for admin auth
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: bootstrap-администратор
- `NEXT_PUBLIC_API_URL`: обязательный публичный base URL API для Next.js админки
- `WEB_URL`: origin web-приложения; используется в том числе для CORS allowlist Python API
- web runtime всегда слушает `3000`; этот порт закреплён в compose и не должен зависеть от общего `PORT` в `.env`
- `CORS_ALLOWED_ORIGINS`: дополнительный comma-separated список origin-ов для CORS, если кроме `WEB_URL` нужно разрешить другие клиенты
- `TELEGRAM_BOT_TOKEN`: token бота
- `TELEGRAM_MODE`: `polling` или `webhook`
- `TELEGRAM_WEBHOOK_URL`: публичный URL для webhook-режима
- `TELEGRAM_WEBHOOK_SECRET`: секрет проверки webhook
- `POLZA_API_KEY`: ключ `Polza AI`
- `POLZA_BASE_URL`: по умолчанию `https://polza.ai/api/v1`
- `POLZA_MODEL`: модель для parsing
- `API_URL`: публичный URL API для доступа к сохраненным изображениям чеков
- `DEFAULT_CURRENCY`: по умолчанию `EUR`
- `UPLOAD_DIR`: директория для загрузок
- `BACKUP_DIR`: каталог локальных backup-файлов API, по умолчанию `backups`
- `BACKUP_KEEP_COUNT`: сколько последних backup-файлов хранить локально, по умолчанию `10`
- `LOG_DIR`: каталог файловых логов API, по умолчанию `logs`
- `LOG_LEVEL`: минимальный уровень логирования, по умолчанию `info`
- `CLARIFICATION_TIMEOUT_MINUTES`: таймаут ожидания уточнения
- `JOB_LEASE_SECONDS`: lease timeout для worker jobs, по умолчанию `120`
- `FEATURE_JOB_DEDUPE_ENABLED`: флаг идемпотентного enqueue для jobs
- `FEATURE_STRICT_DRAFT_STATE_ENABLED`: флаг строгой draft state machine
- `FEATURE_ENHANCED_OBSERVABILITY_ENABLED`: флаг request/job correlation полей в логах и readiness
- `FEATURE_DEAD_LETTER_JOBS_ENABLED`: флаг dead-letter поведения вместо бесконечного retry

Локальный `docker compose` поднимает PostgreSQL на `localhost:5433`, чтобы не конфликтовать с локальным Postgres на стандартном `5432`. При необходимости порт можно переопределить через `POSTGRES_PORT`.

## Telegram flow

- `polling`: используется локально и на VPS без публичного URL
- `webhook`: доступен через endpoint `POST /api/telegram/webhook`
- команда `/start` показывает постоянное reply-меню бота с кнопками `Добавить операцию` и `Посмотреть статистику`
- кнопка `Добавить операцию` не запускает отдельный wizard, а подсказывает пользователю отправить текст операции или фото чека
- кнопка `Посмотреть статистику` открывает inline-подменю отчетов; сейчас доступны отчеты `Расходы за этот месяц` и `Доходы за этот месяц`
- отчет `Расходы за этот месяц` отправляет PNG с круговой диаграммой расходов по категориям текущего месяца и Telegram-formatted текстовую расшифровку сумм с валютой; на PNG в `Прочие категории` объединяется только самый маленький хвост категорий, если их суммарная доля не превышает `5%`, а в тексте показывается полный список исходных категорий
- отчет `Доходы за этот месяц` отправляет такой же PNG-отчет по категориям доходов текущего месяца: на PNG в `Прочие категории` объединяется только самый маленький хвост категорий, если их суммарная доля не превышает `5%`, а в текстовой расшифровке показывается полный список исходных категорий
- при разборе бот и AI могут выбирать только активные подкатегории; в prompt и Telegram picker они показываются как путь `Родитель / Подкатегория`
- если активных категорий нет, бот и админка используют текущее пустое состояние из БД без автосоздания категорий
- при ручном изменении категории в Telegram бот показывает все доступные подкатегории постранично по `8` элементов
- если дата в сообщении явно не указана, для новой операции используется текущая дата обработки
- при неуверенном разборе бот сохраняет черновик, показывает недостающие поля и вопрос на уточнение, а следующий ответ пользователя дополняет тот же черновик вместо создания новой операции
- для каждого AI parse attempt сохраняется diagnostic snapshot, где итоговый runtime `system prompt` включает строку `Доступные категории: ...`
- новые операции по умолчанию сохраняются в `EUR`; исторические записи не пересчитываются автоматически
- после создания новой операции уведомление в Telegram рассылается всем активным `telegramAccounts` текущего household; в Telegram flow автор видит только персональное подтверждение `✅ Операция сохранена`, а общий fan-out уходит остальным участникам
- при удалении операции через `DELETE /api/transactions/:id` Telegram-уведомление об удалении рассылается всем активным `telegramAccounts` текущего household

## API endpoints

- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `GET /api/auth/me`
- `GET /api/health`
- `GET /api/health/ready`
- `GET /api/metrics`
- `GET /api/logs` с query-параметрами `level`, `source`, `search`, `sortBy`, `sortDir`, `page`, `pageSize`
- `POST /api/backups`
- `GET /api/backups/latest`
- `GET /api/backups/latest/download`
- `GET /api/transactions` с query-параметрами `status`, `type`, `search`, `sortBy`, `sortDir`, `page`, `pageSize`
- `POST/PATCH/DELETE /api/transactions`
- `GET /api/transactions/summary`
- `GET/POST/PATCH/DELETE /api/categories`
  Возвращает и принимает иерархический справочник; `parentId = null` означает верхнюю категорию, операциям доступны только leaf-подкатегории.
- `GET /api/users`
- `PATCH /api/users/:id`
- `GET/PUT /api/settings`
- `GET /api/telegram/status`
- `POST /api/telegram/webhook`

## Observability и queue semantics

- Все HTTP-ответы API теперь возвращают `X-Request-Id` и `X-Correlation-Id`.
- Worker и API пишут JSON-логи с общим correlation context для запросов и jobs.
- DB-backed queue теперь использует:
  - `dedupeKey` для идемпотентного enqueue
  - `leaseExpiresAt` для reclaim зависших `running` jobs
  - `dead_letter` после исчерпания `maxAttempts`
- Readiness дополнительно показывает:
  - `pendingCount`
  - `runningCount`
  - `deadLetterCount`
  - `oldestPendingLagSeconds`

## GitHub: первый пуш

Инициализация уже подготовлена под ветку `main`. Для публикации в новый private-репозиторий:

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

Если репозиторий уже создан в GitHub UI, используйте его HTTPS или SSH URL вместо `<GITHUB_REPOSITORY_URL>`.

## Tests

Workflow [`.github/workflows/ci.yml`](/C:/Dev/Denga/.github/workflows/ci.yml) запускается на каждый `pull_request` и на `push` в `main`, после чего выполняет:

- `npm ci`
- `python apps/python_backend/scripts/migrate.py upgrade`
- `npm run lint`
- `npm test`
- `npm run build`
- локальную сборку production-образов `python-api`, `python-worker`, `web` для supply-chain проверок
- установку `Trivy` из pinned GitHub release asset `aquasecurity/trivy v0.70.0` с обязательной checksum-проверкой
- `Trivy CLI`-сканирование репозитория и production image layers с fail на `HIGH`/`CRITICAL`
- генерацию `CycloneDX SBOM` для production-образов и публикацию SBOM как CI artifacts

Для `push` в `main` этот же workflow дополнительно:

- собирает immutable production images `python-api`, `python-worker`, `web`
- публикует их в `GHCR`
- сохраняет pinned digests в artifact `production-release-manifest`

Для production build фронтенда workflow использует `NEXT_PUBLIC_API_URL`. По умолчанию в `Tests` применяется `http://localhost:3001/api`. Если нужен другой адрес для CI-проверок, задайте repository variable `CI_NEXT_PUBLIC_API_URL`.

Security scanning policy:

- `Trivy` больше не запускается через `trivy-action` wrapper, потому что после security incident марта 2026 часть tag refs перестала стабильно резолвиться на GitHub runner'ах
- workflow `Tests` больше не использует `setup-trivy`, а скачивает pinned Trivy binary напрямую из официального GitHub release `aquasecurity/trivy`
- перед установкой workflow проверяет checksum release asset, чтобы зафиксировать воспроизводимую и проверяемую установку сканера
- в логах `Tests` всегда печатается `trivy --version`, чтобы была видна фактически установленная версия сканера

## CD

Workflow [`.github/workflows/deploy.yml`](/C:/Dev/Denga/.github/workflows/deploy.yml) запускается только после успешного завершения workflow `Tests` для ветки `main` и деплоит Python-first runtime на VPS через `SSH + Docker Compose`.

Логика деплоя:

- проверяет наличие обязательных secrets
- скачивает `production-release-manifest` из завершившегося `Tests` run
- копирует на сервер только production `docker-compose.yml` и новый release manifest
- проверяет, что серверный `.env` уже существует
- выполняет preflight: `docker compose`, login в `ghcr.io`, pull immutable image digests и проверку свободного места на диске
- делает fresh DB backup
- запускает baseline invariants snapshot
- подтягивает только `GHCR` immutable images по digest и запускает Alembic migrations + идемпотентный bootstrap seed без server-side build
- поднимает `python-api` и `python-worker`
- прогоняет `verify_contract.py` и invariant compare
- поднимает `web` только после зелёных automated gates
- при падении automated gate workflow откатывает runtime к `stable-release.env` без rebuild и оставляет диагностику в логах GitHub Actions
- проверяет, что `python-worker` находится в состоянии `running`
- проверяет доступность API и web после выката прямо на сервере по SSH
- при неуспешной проверке печатает `docker compose ps` и последние логи `python-api`/`python-worker`/`web`
- если вкладка админки была открыта во время деплоя, браузер может сохранить старый Next.js bundle; в таком случае сделайте hard refresh и при необходимости войдите заново

На сервере production release state хранится файлами:

- `current-release.env`: release, который сервер должен считать активным сейчас
- `stable-release.env`: последний полностью проверенный healthy release
- `previous-release.env`: предыдущий stable release для более глубокого rollback
- `releases/release-<git_sha>.env`

Перед production deploy прогоняйте rehearsal и invariants compare по [`docs/python-cutover-runbook.md`](/C:/Dev/Denga/docs/python-cutover-runbook.md).

## Обязательные GitHub Secrets

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`
- `REMOTE_APP_DIR`: абсолютный путь проекта на сервере
- `APP_URL`: URL главной страницы для post-deploy проверки
- `REGISTRY_USERNAME`: логин для `docker login` на production-сервере
- `REGISTRY_PASSWORD`: пароль или PAT для `docker login` в `ghcr.io` на production-сервере
- `VERIFY_MEMBER_EMAIL` / `VERIFY_MEMBER_PASSWORD`: опциональные данные обычного пользователя для `403`-проверки в contract gate

Production `.env` должен храниться только на сервере в `$REMOTE_APP_DIR/.env`. GitHub Actions деплоит только compose-конфиг и release manifest, но не хранит и не перезаписывает боевые runtime secrets.
`Tests` и `Deploy` также не создают и не синхронизируют категории: после деплоя используется тот справочник категорий, который уже хранится в БД.

Первичная настройка сервера:

```bash
scp PROD_ENV_FILE.env root@<server>:/root/denga/.env
ssh root@<server> "chown root:root /root/denga/.env && chmod 600 /root/denga/.env"
```

Если файла `/root/denga/.env` нет, deploy завершится с явной ошибкой.

## Веточная модель

- Workflow `Tests` запускается на каждый `pull_request` и на `push` в `main`.
- Pull request в `main` используется для проверки изменений до merge через workflow `Tests`.
- Merge или прямой `push` в `main` сначала запускает workflow `Tests`.
- Production deploy стартует только если этот `Tests` завершился успешно.

## Ручные операции на сервере

- Ручное создание операции через `POST /api/transactions` тоже триггерит Telegram-уведомление всем активным `telegramAccounts` текущего household.

## Бэкапы операций

- В админке в разделе `Настройки` доступны действия `Создать бэкап` и `Скачать последний`.
- API также автоматически создает и отправляет backup-файл в Telegram раз в 3 дня в `12:00` по Москве.
- Автоматическая отправка использует первого `ADMIN`-пользователя с активным `telegramAccounts`, отсортированного по `createdAt asc`.
- Для автоматической отправки должен быть настроен `TELEGRAM_BOT_TOKEN`, а бот должен иметь возможность писать этому пользователю в Telegram.
- После получения файла пользователь вручную сохраняет `.dump` в надежное место.
- Backup включает только таблицы `Household`, `User`, `Category`, `Transaction`, `AppSetting`.
- Backup не включает Telegram raw payload, AI-историю, вложения и каталог `uploads`.
- API хранит только последние `BACKUP_KEEP_COUNT` файлов, по умолчанию `10`.
- При docker-развертывании backup-файлы сохраняются на хосте в каталоге `./backups`.
- Для создания backup API используется текущий `DATABASE_URL`; helper нормализует SQLAlchemy/psycopg URI и убирает query-параметры вроде `schema` перед вызовом `pg_dump`.

Восстановление из backup:

```bash
python apps/python_backend/scripts/migrate.py upgrade
pg_restore --clean --if-exists --no-owner --host localhost --port 5433 --username denga --dbname denga ./backups/<backup-file>.dump
```

Если восстановление выполняется внутри API-контейнера, используйте путь `/app/backups/<backup-file>.dump`. Для `pg_restore` не передавайте URI с query-параметрами вроде `?schema=public` как `--dbname`.

Перезапуск контейнеров:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Просмотр логов:

```bash
docker compose logs -f python-api
docker compose logs -f python-worker
tail -f logs/app.log
ls -lh backups
ls -l /root/denga/.env
```

Остановка сервисов:

```bash
docker compose down
```

## Ограничения текущей версии

- Одно семейное пространство на установку
- Вход в web только для админа
- Категории строго из ручного иерархического справочника
- `Tests`/`Deploy`, startup и seed не изменяют категории; единственный способ поменять их это ручной CRUD через админку
- Изображения чеков не сохраняются на диск сервера, а используются только во время разбора
- Для clarification пока нет отдельного UI resolution flow, операции остаются видимыми в журнале
- Автоматический backup v1 отправляется только первому admin-пользователю с Telegram account; отдельная настройка chat id пока не добавлена

## Runtime и архитектура

- API при старте валидирует runtime-конфигурацию и создает рабочие каталоги `uploads`, `backups` и `logs`.
- Если отсутствует критичный runtime config вроде `DATABASE_URL` или `TELEGRAM_WEBHOOK_URL` в webhook-режиме, приложение завершает запуск с явной ошибкой.
- Если отсутствует `POLZA_API_KEY` или `TELEGRAM_BOT_TOKEN` для polling, API поднимается в degraded mode и отражает это в readiness-check.
- Telegram pipeline больше не сосредоточен в одном сервисе: прием сообщений, clarification-flow, доставка ответов, вложения и draft lifecycle вынесены в отдельные сервисы.
- Dashboard web-админки разрезан на feature hooks и typed feature API вместо одного orchestration-heavy компонента.
- Дополнительные заметки по разбиению модулей находятся в [docs/architecture.md](/C:/Dev/Denga/docs/architecture.md).

## Generated artifacts

- Каталоги `packages/shared/dist`, `apps/web/.next`, `coverage` и `tmp` считаются локальными generated artifacts.
- Они не должны попадать в коммиты и при необходимости очищаются командой `npm run clean`.
- Для локального поиска по репозиторию используется файл `.ignore`, чтобы служебные каталоги не засоряли результаты навигации.
- `apps/python_backend/*.egg-info` считается generated packaging metadata и не должен коммититься.
