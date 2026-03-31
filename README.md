# Denga

Семейный учет доходов и расходов с приемом сообщений и чеков через Telegram-бота, AI-разбором через `Polza AI` и админ-панелью на `Next.js`.

## Стек

- `NestJS` API
- `Next.js` админ-панель
- `Prisma + PostgreSQL`
- `Telegraf` для Telegram polling
- `Polza AI` через OpenAI-compatible API
- `Docker Compose` для локального и серверного запуска
- `GitHub Actions` для CI/CD

## Что умеет MVP

- Принимать текстовые сообщения и фото чеков из Telegram
- Сохранять исходное сообщение и вложения
- Разбирать данные через AI в структурированную операцию
- Автосохранять подтвержденные операции
- Показывать черновик операции с уточняющим вопросом, если AI не уверен
- Выбирать категорию операции только из активного справочника категорий
- Давать администратору ручной CRUD операций в веб-интерфейсе
- Давать администратору ручной CRUD категорий с мягким отключением и восстановлением
- Показывать дашборд с доходами, расходами, балансом и месячным трендом
- Показывать операции, категории, пользователей и настройки в админке
- Позволять администратору менять пароль из админки после входа
- Создавать bootstrap-администратора из env/seed
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
npx prisma db push
npm run prisma:seed
```

4. Запустите backend и frontend:

```bash
npm run dev:api
npm run dev:web
```

`NEXT_PUBLIC_API_URL` обязателен для запуска и production build админки. Для локальной разработки используйте значение вида `http://localhost:3001/api`.

5. Откройте:

- Веб: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001/api](http://localhost:3001/api)

## Docker

Проект можно поднять целиком в контейнерах:

```bash
docker compose up --build -d
```

Что делает контейнерный запуск:

- поднимает PostgreSQL
- API-контейнер автоматически применяет `prisma db push`
- API-контейнер автоматически выполняет `npm run prisma:seed`
- затем запускаются backend и frontend

После запуска доступны:

- Веб: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001/api](http://localhost:3001/api)

## Основные env

- `DATABASE_URL`: PostgreSQL connection string
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
- `LOG_DIR`: каталог файловых логов API, по умолчанию `logs`
- `LOG_LEVEL`: минимальный уровень логирования, по умолчанию `info`
- `CLARIFICATION_TIMEOUT_MINUTES`: таймаут ожидания уточнения

Локальный `docker compose` поднимает PostgreSQL на `localhost:5433`, чтобы не конфликтовать с локальным Postgres на стандартном `5432`. При необходимости порт можно переопределить через `POSTGRES_PORT`.

## Telegram flow

- `polling`: используется локально и на VPS без публичного URL
- `webhook`: доступен через endpoint `POST /api/telegram/webhook`
- при разборе бот и AI могут выбирать категорию только из списка активных категорий
- если дата в сообщении явно не указана, для новой операции используется текущая дата обработки
- при неуверенном разборе бот сохраняет черновик, показывает недостающие поля и вопрос на уточнение, а следующий ответ пользователя дополняет тот же черновик вместо создания новой операции
- новые операции по умолчанию сохраняются в `EUR`; исторические записи не пересчитываются автоматически

## API endpoints

- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `GET /api/auth/me`
- `GET /api/logs`
- `GET/POST/PATCH/DELETE /api/transactions`
- `GET /api/transactions/summary`
- `GET/POST/PATCH/DELETE /api/categories`
- `GET /api/users`
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
- `npm test`
- `npm run build`

Для production build фронтенда workflow использует `NEXT_PUBLIC_API_URL`. По умолчанию в CI применяется `http://localhost:3001/api`. Если нужен другой адрес для CI-проверок, задайте repository variable `CI_NEXT_PUBLIC_API_URL`.

## CD

Workflow [`.github/workflows/deploy.yml`](/C:/Dev/Denga/.github/workflows/deploy.yml) запускается только на `push` в `main` и деплоит проект на VPS через `SSH + Docker Compose`.

Логика деплоя:

- проверяет наличие обязательных secrets
- копирует репозиторий на сервер через `rsync`
- создает или обновляет серверный `.env` из GitHub Secret
- выполняет `docker compose up --build -d`
- проверяет доступность API и web после выката

## Обязательные GitHub Secrets

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`
- `REMOTE_APP_DIR`: абсолютный путь проекта на сервере
- `PROD_ENV_FILE`: полный production `.env` одним многострочным secret
- `APP_URL`: URL главной страницы для post-deploy проверки
- `API_HEALTHCHECK_URL`: URL API для post-deploy проверки

Рекомендуется хранить production-конфигурацию целиком в `PROD_ENV_FILE`, а не раскладывать ее по десяткам шагов workflow. Внутри него должны быть все обязательные env проекта, включая `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL`, `TELEGRAM_BOT_TOKEN`, `POLZA_API_KEY` и остальные production-значения.

## Веточная модель

- Любой `push` и `pull_request` запускает CI.
- Pull request в `main` используется для проверки изменений до merge.
- Merge или прямой `push` в `main` запускает production deploy.

## Ручные операции на сервере

Перезапуск контейнеров:

```bash
docker compose up --build -d
```

Просмотр логов:

```bash
docker compose logs -f api
tail -f logs/app.log
```

Остановка сервисов:

```bash
docker compose down
```

## Ограничения текущей версии

- Одно семейное пространство на установку
- Вход в web только для админа
- Категории строго из ручного справочника
- Изображения чеков не сохраняются на диск сервера, а используются только во время разбора
- Для clarification пока нет отдельного UI resolution flow, операции остаются видимыми в журнале
