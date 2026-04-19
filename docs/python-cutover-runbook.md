# Python Production Deploy Runbook

Этот runbook описывает обычный production deploy для `python-api + python-worker`, проверку автоматических gate'ов и ручное восстановление через повторный deploy или restore из pre-deploy backup.

## 1. Что должно быть готово до выката

- production [`docker-compose.yml`](/C:/Dev/Denga/docker-compose.yml) поднимает `postgres`, `python-api`, `python-worker`, `web` из immutable image refs
- локальный [`docker-compose.dev.yml`](/C:/Dev/Denga/docker-compose.dev.yml) добавляет `build`-настройки для разработки и локального rehearsal
- Alembic-миграции выполняются helper-скриптом [`apps/python_backend/scripts/migrate.py`](/C:/Dev/Denga/apps/python_backend/scripts/migrate.py)
- contract smoke запускается через [`apps/python_backend/scripts/verify_contract.py`](/C:/Dev/Denga/apps/python_backend/scripts/verify_contract.py)
- data invariants snapshot/compare запускается через [`apps/python_backend/scripts/verify_invariants.py`](/C:/Dev/Denga/apps/python_backend/scripts/verify_invariants.py)
- bootstrap-данные и настройки создаются через идемпотентный [`apps/python_backend/scripts/bootstrap_seed.py`](/C:/Dev/Denga/apps/python_backend/scripts/bootstrap_seed.py)
- основной orchestration идёт через GitHub Actions workflow [`deploy.yml`](/C:/Dev/Denga/.github/workflows/deploy.yml)

## 2. Rehearsal на staging или restore-копии production

1. Зафиксировать baseline инвариантов:

```bash
apps/python_backend/.venv/Scripts/python apps/python_backend/scripts/verify_invariants.py --write docs/local/deploy-before.json
```

2. Применить миграции и bootstrap seed:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/migrate.py upgrade
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/bootstrap_seed.py
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --remove-orphans
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

- скачивает release manifest с pinned digests из завершившегося `CI`
- копирует на сервер только `docker-compose.yml` и новый release manifest
- проверяет `docker compose`, registry login/pull и свободное место на диске
- снимает свежий backup БД
- пишет baseline invariants snapshot
- подтягивает immutable images по digest
- запускает Alembic migrations и идемпотентный bootstrap seed
- поднимает `python-api` и `python-worker`
- проверяет, что фактически запущенные контейнеры `python-api` и `python-worker` совпадают с image digest из `current-release.env`
- прогоняет `verify_contract.py`
- прогоняет invariant compare
- поднимает `web` только после зелёных automated gates
- при сбое возвращает runtime к `stable-release.env` без rebuild и печатает диагностику в логах GitHub Actions

На сервере используются release state файлы:

- `current-release.env`
- `stable-release.env`
- `previous-release.env`
- `releases/release-<git_sha>.env`

4. После выката проверить:

- `python-worker` в `docker compose ps` находится в состоянии `running`
- `python-api` и `python-worker` в рантайме совпадают с image ref из `current-release.env`
- `http://127.0.0.1:3001/api/health/ready` отвечает `200`
- `GET /api/health/ready` показывает `jobQueue.deadLetterCount = 0`
- `GET /api/health/ready` не показывает runaway `runningCount`
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

Дополнительная проверка соответствия release manifest и running containers:

```bash
service=python-worker
container_id="$(docker compose ps -q "$service")"
docker inspect --format '{{.Config.Image}}' "$container_id"
cat current-release.env | grep '^PYTHON_WORKER_IMAGE='
docker image inspect "$(docker inspect --format '{{.Config.Image}}' "$container_id")" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

Если `current-release.env` уже новый, а `docker inspect --format '{{.Config.Image}}'` для `python-worker` показывает другой digest, это симптом частичного rollout: release manifest обновился, но running worker остался старым. Такой deploy теперь должен завершаться ошибкой автоматически.

Дополнительная проверка observability и queue state:

```bash
curl http://127.0.0.1:3001/api/health/ready
curl http://127.0.0.1:3001/api/metrics
```

## 4. Recovery

Если deploy завершился ошибкой или после выката не проходит ручной smoke:

1. Просмотреть backup, сохранённый deploy workflow, и причины падения в логах GitHub Actions.
2. Если workflow уже сделал auto-restore к `stable-release.env`, проверить health и только потом разбирать причину падения.
3. Если release markers разошлись с фактическим последним healthy runtime, выполнить на сервере recovery-команду без указания конкретного SHA:

```bash
cd /root/denga
REMOTE_APP_DIR=/root/denga bash ./scripts/deploy/remote_sync_current_with_stable.sh
```

4. Если нужен явный возврат к предыдущему успешному релизу, запустить `Deploy` workflow вручную в режиме `rollback-previous`.
5. Если проблема вызвана миграцией или данными, восстановить БД из pre-deploy backup:

```bash
pg_restore --clean --if-exists --no-owner --host localhost --port 5433 --username denga --dbname denga ./backups/<backup-file>.dump
```

6. После restore повторно выполнить:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/migrate.py upgrade
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/bootstrap_seed.py
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --remove-orphans
```

В этой схеме отдельного legacy runtime больше нет; восстановление выполняется через backup и повторный Python-first deploy.

Если после выката появились `dead_letter` jobs:

1. Посмотреть `GET /api/health/ready` и `GET /api/metrics`
2. Найти последние `job_failed` записи в логах `python-worker`
3. Исправить код или конфигурацию и повторить deploy
4. Не делать destructive cleanup очереди как часть аварийного восстановления
