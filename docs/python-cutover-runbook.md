# Python Production Cutover Runbook

Этот runbook нужен для первого production-переключения с legacy `NestJS api` на `python-api + python-worker`, а также для rehearsal на staging или на restore-копии production БД.

## 1. Что должно быть готово до выката

- `docker-compose.yml` уже Python-first: поднимаются `postgres`, `python-api`, `python-worker`, `web`
- rollback-контур сохранен в [`docker-compose.node.yml`](/C:/Dev/Denga/docker-compose.node.yml)
- Prisma-миграции и bootstrap seed запускаются отдельным helper compose-файлом [`docker-compose.migrate.yml`](/C:/Dev/Denga/docker-compose.migrate.yml)
- contract smoke запускается через [`apps/python_backend/scripts/verify_contract.py`](/C:/Dev/Denga/apps/python_backend/scripts/verify_contract.py)
- data invariants snapshot/compare запускается через [`apps/python_backend/scripts/verify_invariants.py`](/C:/Dev/Denga/apps/python_backend/scripts/verify_invariants.py)
- серверный orchestration script для cutover лежит в [`scripts/production-cutover.sh`](/C:/Dev/Denga/scripts/production-cutover.sh)
- явный rollback helper лежит в [`scripts/production-rollback.sh`](/C:/Dev/Denga/scripts/production-rollback.sh)

## 2. Rehearsal на staging или restore-копии production

1. Зафиксировать baseline инвариантов:

```bash
apps/python_backend/.venv/Scripts/python apps/python_backend/scripts/verify_invariants.py --write docs/local/cutover-before.json
```

2. Поднять Python runtime:

```bash
docker compose up --build -d --remove-orphans
```

3. Прогнать contract verification:

```bash
$env:VERIFY_API_BASE_URL='http://localhost:3001/api'
$env:VERIFY_ADMIN_EMAIL='<admin_email>'
$env:VERIFY_ADMIN_PASSWORD='<admin_password>'
$env:VERIFY_MEMBER_EMAIL='<member_email>'
$env:VERIFY_MEMBER_PASSWORD='<member_password>'
apps/python_backend/.venv/Scripts/python apps/python_backend/scripts/verify_contract.py
```

4. Сравнить post-start инварианты:

```bash
apps/python_backend/.venv/Scripts/python apps/python_backend/scripts/verify_invariants.py --compare docs/local/cutover-before.json
```

5. Выполнить ручной smoke:

- login в web
- dashboard load
- `GET /api/categories`
- `GET /api/backups/latest`
- один Telegram text flow
- один callback `Расходы за этот месяц`

## 3. Production cutover

1. Перед релизом зафиксировать maintenance window и write freeze.
2. Убедиться, что в production `.env` заданы `ADMIN_EMAIL` и `ADMIN_PASSWORD`; `VERIFY_MEMBER_EMAIL` / `VERIFY_MEMBER_PASSWORD` опциональны.
3. Запустить deploy workflow или вручную выполнить на сервере:

```bash
APP_URL='<app_url>' API_HEALTHCHECK_URL='<api_healthcheck_url>' sh ./scripts/production-cutover.sh
```

4. Скрипт сам:

- снимает свежий backup БД
- пишет baseline invariants snapshot
- останавливает legacy runtime
- запускает `prisma-bootstrap`
- поднимает `python-api` и `python-worker`
- прогоняет `verify_contract.py`
- прогоняет invariant compare
- поднимает `web` только после зелёных automated gates
- при любом сбое автоматически откатывается на `docker-compose.node.yml`

5. После выката проверить:

- `python-worker` в `docker compose ps` находится в состоянии `running`
- `API_HEALTHCHECK_URL` отвечает `200`
- `APP_URL` отвечает `200`
- contract smoke проходит на боевом адресе
- инварианты по `Transaction` и `Category` совпадают с pre-cutover snapshot

Команды для ручной post-start проверки:

```bash
docker compose ps
docker compose logs --tail=200 python-api
docker compose logs --tail=200 python-worker
docker compose logs --tail=100 web
```

## 4. Rollback

Если post-start smoke не проходит после зелёных automated gates, либо нужен ручной возврат на Node runtime:

1. Остановить Python runtime:

```bash
sh ./scripts/production-rollback.sh
```

Проверить:

- web доступен
- old `api` отвечает на healthcheck
- Telegram updates снова обрабатывает только Node runtime

Rollback в этом сценарии не требует restore БД, пока после cutover не применялись несовместимые schema changes.
