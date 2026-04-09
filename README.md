# Denga

Семейный учет доходов и расходов с приемом сообщений и чеков через Telegram-бота, AI-разбором через `Polza AI` и админ-панелью на `Next.js`.

## Стек

- `FastAPI + worker` backend для production runtime
- `Next.js` админ-панель
- `Prisma + PostgreSQL`
- legacy `NestJS` runtime сохранен как rollback-контур
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
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
```

`npm run prisma:seed` больше не создает и не синхронизирует категории. Категории хранятся только в БД и управляются вручную через админку.

Для локальной разработки все следующие изменения схемы оформляйте через Prisma-миграции:

```bash
npm run prisma:migrate -- --name <migration_name>
```

Если база была создана до появления Prisma-истории миграций и в ней уже есть текущая схема, сначала пометьте baseline как примененный, а затем примените остальные миграции:

```bash
npx prisma migrate resolve --applied 20260407110000_init
npm run prisma:migrate:deploy
```

Этого достаточно и для одноразового перевода старых плоских категорий в иерархию: миграция `20260407111000_migrate_category_hierarchy` сама создает для каждой прежней плоской категории верхнюю категорию с тем же именем и переводит исходную запись в подкатегорию `Общее`, сохраняя существующие ссылки операций на ту же leaf-запись.

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
docker compose up -d postgres
docker compose -f docker-compose.yml -f docker-compose.migrate.yml run --rm prisma-bootstrap
docker compose up --build -d --remove-orphans
```

Что делает контейнерный запуск:

- поднимает PostgreSQL
- выполняет helper `prisma-bootstrap` для `prisma migrate deploy` и `npm run prisma:seed`
- если база уже существовала до ввода Prisma-истории миграций, helper автоматически помечает baseline `20260407110000_init` как примененный и повторяет deploy
- helper выполняет seed только для bootstrap-данных и настроек, но не трогает категории
- затем запускаются `python-api`, `python-worker` и frontend
- файловые логи сохраняются в `./logs`, а локальные бэкапы базы в `./backups`

После запуска доступны:

- Веб: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001/api](http://localhost:3001/api)

## Python backend

В репозитории production runtime по умолчанию уже переключен на `FastAPI + worker` в каталоге [`apps/python_backend`](/C:/Dev/Denga/apps/python_backend).

Что уже есть в Python-контуре:

- совместимый `/api` HTTP-слой для `auth`, `health`, `transactions`, `categories`, `users`, `settings`, `backups`, `logs`, `telegram status`
- отдельный worker entrypoint
- additive `Job`-таблица для DB-backed background execution
- основной [`docker-compose.yml`](/C:/Dev/Denga/docker-compose.yml) теперь поднимает `python-api + python-worker`
- отдельный rollback compose-файл [`docker-compose.node.yml`](/C:/Dev/Denga/docker-compose.node.yml) сохраняет legacy Node runtime
- helper compose-файл [`docker-compose.migrate.yml`](/C:/Dev/Denga/docker-compose.migrate.yml) запускает Prisma migrations и bootstrap seed перед Python runtime
- worker-parity для основного Telegram pipeline: webhook/polling update routing, draft creation, clarification reparse, category picker callbacks, confirm/cancel draft, transaction notification jobs, scheduled backup job и monthly stats reports

Быстрый запуск Python-контура:

```bash
docker compose -f docker-compose.python.yml up --build
```

Локальная проверка Python-контура без Docker:

```bash
python -m venv apps/python_backend/.venv
apps/python_backend/.venv/Scripts/python -m pip install -e "apps/python_backend[dev]"
apps/python_backend/.venv/Scripts/python -m pytest apps/python_backend/tests -q
apps/python_backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir apps/python_backend --host 0.0.0.0 --port 3001
```

Runbook для rehearsal, production cutover и rollback лежит в [`docs/python-cutover-runbook.md`](/C:/Dev/Denga/docs/python-cutover-runbook.md).
Для самого server-side orchestration используйте [`scripts/production-cutover.sh`](/C:/Dev/Denga/scripts/production-cutover.sh) и [`scripts/production-rollback.sh`](/C:/Dev/Denga/scripts/production-rollback.sh).

## Основные env

- `DATABASE_URL`: PostgreSQL connection string; допустим обычный DSN вида `postgresql://...`, Python backend сам нормализует его к драйверу `psycopg3`
- `POSTGRES_PORT`: публикуемый порт PostgreSQL на хосте, по умолчанию `5433`
- `JWT_SECRET`: secret for admin auth
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: bootstrap-администратор
- `NEXT_PUBLIC_API_URL`: обязательный публичный base URL API для Next.js админки
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
- после создания новой операции уведомление в Telegram рассылается всем активным `telegramAccounts` текущего household; в Telegram flow автор видит только персональное подтверждение `Операция сохранена`, а общий fan-out уходит остальным участникам
- при удалении операции через `DELETE /api/transactions/:id` Telegram-уведомление об удалении рассылается всем активным `telegramAccounts` текущего household

## API endpoints

- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `GET /api/auth/me`
- `GET /api/health`
- `GET /api/health/ready`
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

## CI

Workflow [`.github/workflows/ci.yml`](/C:/Dev/Denga/.github/workflows/ci.yml) запускается на каждый `push` и `pull_request` и выполняет:

- `npm ci`
- `npm run prisma:generate`
- `npm run lint`
- `npm test`
- `npm run build`

Для production build фронтенда workflow использует `NEXT_PUBLIC_API_URL`. По умолчанию в CI применяется `http://localhost:3001/api`. Если нужен другой адрес для CI-проверок, задайте repository variable `CI_NEXT_PUBLIC_API_URL`.

## CD

Workflow [`.github/workflows/deploy.yml`](/C:/Dev/Denga/.github/workflows/deploy.yml) запускается только после успешного завершения workflow `CI` для ветки `main` и деплоит Python-first runtime на VPS через `SSH + Docker Compose`.

Логика деплоя:

- проверяет наличие обязательных secrets
- копирует репозиторий на сервер через `rsync`
- проверяет, что серверный `.env` уже существует
- поднимает `postgres`, затем запускает helper `prisma-bootstrap` через [`docker-compose.migrate.yml`](/C:/Dev/Denga/docker-compose.migrate.yml)
- запускает [`scripts/production-cutover.sh`](/C:/Dev/Denga/scripts/production-cutover.sh), который сам делает fresh DB backup, baseline invariants snapshot, write-freeze switch, contract verification и post-start invariant compare
- поднимает `web` только после зелёных automated gates
- проверяет, что `python-worker` находится в состоянии `running`
- проверяет доступность API и web после выката прямо на сервере по SSH
- при неуспешной проверке печатает `docker compose ps` и последние логи `python-api`/`python-worker`/`web`
- если вкладка админки была открыта во время деплоя, браузер может сохранить старый Next.js bundle; в таком случае сделайте hard refresh и при необходимости войдите заново

Перед production cutover прогоняйте rehearsal и invariants compare по [`docs/python-cutover-runbook.md`](/C:/Dev/Denga/docs/python-cutover-runbook.md).

## Обязательные GitHub Secrets

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`
- `REMOTE_APP_DIR`: абсолютный путь проекта на сервере
- `APP_URL`: URL главной страницы для post-deploy проверки
- `VERIFY_MEMBER_EMAIL` / `VERIFY_MEMBER_PASSWORD`: опциональные данные обычного пользователя для `403`-проверки в contract gate

Production `.env` должен храниться только на сервере в `$REMOTE_APP_DIR/.env`. GitHub Actions деплоит код, но не хранит и не перезаписывает боевые секреты.
CI/CD также не создает и не синхронизирует категории: после деплоя используется тот справочник категорий, который уже хранится в БД.

Первичная настройка сервера:

```bash
scp PROD_ENV_FILE.env root@<server>:/root/denga/.env
ssh root@<server> "chown root:root /root/denga/.env && chmod 600 /root/denga/.env"
```

Если файла `/root/denga/.env` нет, deploy завершится с явной ошибкой.

## Веточная модель

- Любой `push` и `pull_request` запускает CI.
- Pull request в `main` используется для проверки изменений до merge.
- Merge или прямой `push` в `main` сначала запускает CI.
- Production deploy стартует только если этот CI завершился успешно.

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
- Для создания backup API использует текущий `DATABASE_URL`, но автоматически убирает Prisma-специфичные query-параметры вроде `schema` перед вызовом `pg_dump`.

Восстановление из backup:

```bash
npm run prisma:migrate:deploy
pg_restore --clean --if-exists --no-owner --host localhost --port 5433 --username denga --dbname denga ./backups/<backup-file>.dump
```

Если восстановление выполняется внутри API-контейнера, используйте путь `/app/backups/<backup-file>.dump`. Для `pg_restore` не передавайте Prisma-style URI с query-параметрами вроде `?schema=public` как `--dbname`.

Перезапуск контейнеров:

```bash
docker compose up --build -d
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
- CI/CD, startup и seed не изменяют категории; единственный способ поменять их это ручной CRUD через админку
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

- Каталоги `apps/api/dist`, `packages/shared/dist`, `apps/web/.next`, `coverage` и `tmp` считаются локальными generated artifacts.
- Они не должны попадать в коммиты и при необходимости очищаются командой `npm run clean`.
- Для локального поиска по репозиторию используется файл `.ignore`, чтобы служебные каталоги не засоряли результаты навигации.
- `apps/python_backend/*.egg-info` считается generated packaging metadata и не должен коммититься.
