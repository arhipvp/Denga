# Python Production Deploy Runbook

Этот runbook описывает обычный production deploy для `python-api + python-worker`, проверку автоматических gate'ов и ручное восстановление через повторный deploy или restore из pre-deploy backup.

## 1. Что должно быть готово до выката

- `docker-compose.yml` поднимает `postgres`, `python-api`, `python-worker`, `web`
- Prisma-миграции и bootstrap seed запускаются helper compose-файлом [`docker-compose.migrate.yml`](/C:/Dev/Denga/docker-compose.migrate.yml)
- contract smoke запускается через [`apps/python_backend/scripts/verify_contract.py`](/C:/Dev/Denga/apps/python_backend/scripts/verify_contract.py)
- data invariants snapshot/compare запускается через [`apps/python_backend/scripts/verify_invariants.py`](/C:/Dev/Denga/apps/python_backend/scripts/verify_invariants.py)
- bootstrap-данные и настройки создаются через [`apps/python_backend/scripts/bootstrap_seed.py`](/C:/Dev/Denga/apps/python_backend/scripts/bootstrap_seed.py)
- основной orchestration идёт через GitHub Actions workflow [`deploy.yml`](/C:/Dev/Denga/.github/workflows/deploy.yml)

## 2. Rehearsal на staging или restore-копии production

1. Зафиксировать baseline инвариантов:

```bash
apps/python_backend/.venv/Scripts/python apps/python_backend/scripts/verify_invariants.py --write docs/local/deploy-before.json
```

2. Применить миграции и bootstrap seed:

```bash
docker compose up -d postgres
docker compose -f docker-compose.yml -f docker-compose.migrate.yml run --rm prisma-bootstrap
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
apps/python_backend/.venv/Scripts/python apps/python_backend/scripts/verify_invariants.py --compare docs/local/deploy-before.json
```

5. Выполнить ручной smoke:

- login в web
- dashboard load
- `GET /api/categories`
- `GET /api/backups/latest`
- один Telegram text flow
- один callback `Расходы за этот месяц`

## 3. Production deploy

1. Убедиться, что в production `.env` заданы `ADMIN_EMAIL` и `ADMIN_PASSWORD`; `VERIFY_MEMBER_EMAIL` / `VERIFY_MEMBER_PASSWORD` опциональны.
2. Запустить deploy workflow.
3. Workflow сам:

- билдит `python-api`, `python-worker`, `web`, `prisma-bootstrap`
- снимает свежий backup БД
- пишет baseline invariants snapshot
- запускает `prisma-bootstrap`
- поднимает `python-api` и `python-worker`
- прогоняет `verify_contract.py`
- прогоняет invariant compare
- поднимает `web` только после зелёных automated gates
- при сбое завершает job ошибкой и печатает диагностику без автоматического rollback на альтернативный runtime

4. После выката проверить:

- `python-worker` в `docker compose ps` находится в состоянии `running`
- `http://127.0.0.1:3001/api/health/ready` отвечает `200`
- `APP_URL` отвечает `200`
- contract smoke проходит на боевом адресе
- инварианты по `Transaction` и `Category` совпадают с pre-deploy snapshot

Команды для ручной post-start проверки:

```bash
docker compose ps
docker compose logs --tail=200 python-api
docker compose logs --tail=200 python-worker
docker compose logs --tail=100 web
```

## 4. Recovery

Если deploy завершился ошибкой или после выката не проходит ручной smoke:

1. Просмотреть backup, сохранённый deploy workflow, и причины падения в логах GitHub Actions.
2. Исправить конфигурацию или код и повторить deploy.
3. Если проблема вызвана миграцией или данными, восстановить БД из pre-deploy backup:

```bash
pg_restore --clean --if-exists --no-owner --host localhost --port 5433 --username denga --dbname denga ./backups/<backup-file>.dump
```

4. После restore повторно выполнить:

```bash
docker compose -f docker-compose.yml -f docker-compose.migrate.yml run --rm prisma-bootstrap
docker compose up --build -d --remove-orphans
```

В этой схеме отдельного legacy runtime больше нет; восстановление выполняется через backup и повторный Python-first deploy.
