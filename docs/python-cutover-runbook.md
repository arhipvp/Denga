# Python Production Deploy Runbook

Этот runbook описывает обычный production deploy для `python-api + python-worker` в forward-only модели: либо новый release полностью проходит все gate'ы и только потом становится активным, либо deploy падает без автоматического rollback и без продвижения release markers.

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
- подтверждает, что БД действительно дошла до Alembic head через `python scripts/migrate.py verify-head`
- поднимает `python-api` и `python-worker`
- проверяет, что фактически запущенные контейнеры `python-api` и `python-worker` совпадают с image digest из release candidate manifest
- прогоняет `verify_contract.py`
- прогоняет invariant compare
- поднимает `web` только после зелёных automated gates
- обновляет `current-release.env`, `stable-release.env`, `previous-release.env`, `DEPLOYED_SHA` и `DEPLOYED_AT_UTC` только после полного зелёного pipeline
- при сбое останавливается с диагностикой в логах GitHub Actions и не продвигает release markers

На сервере используются release state файлы:

- `current-release.env`
- `stable-release.env`
- `previous-release.env`
- `releases/release-<git_sha>.env`

4. После выката проверить:

- `python-worker` в `docker compose ps` находится в состоянии `running`
- `python-api` и `python-worker` в рантайме совпадают с image ref из promoted release manifest
- `http://127.0.0.1:3001/api/health/ready` отвечает `200`
- `GET /api/health/ready` показывает `jobQueue.deadLetterCount = 0`
- `GET /api/health/ready` не показывает runaway `runningCount`
- `APP_URL` отвечает `200`
- contract smoke проходит на боевом адресе
- инварианты по `Transaction` и `Category` совпадают с pre-deploy snapshot
- `python scripts/migrate.py current` показывает Alembic head, а `python scripts/migrate.py verify-head` проходит без ошибок

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

Если `docker inspect --format '{{.Config.Image}}'` для `python-worker` показывает digest, отличный от candidate/promoted manifest, это симптом частичного rollout. Такой deploy теперь должен завершаться ошибкой автоматически до promotion release markers.

Дополнительная проверка Alembic head:

```bash
docker compose exec -T python-api python scripts/migrate.py current
docker compose exec -T python-api python scripts/migrate.py verify-head
```

Если `verify-head` падает или `current` не равен ожидаемому head revision, новый release нельзя считать валидным, даже если контейнеры поднялись.

Дополнительная проверка observability и queue state:

```bash
curl http://127.0.0.1:3001/api/health/ready
curl http://127.0.0.1:3001/api/metrics
```

## 4. Если deploy упал

Если deploy завершился ошибкой или после выката не проходит ручной smoke:

1. Просмотреть backup, сохранённый deploy workflow, и причину падения в логах GitHub Actions.
2. Проверить, что release markers не были продвинуты:

```bash
cat current-release.env
cat stable-release.env
cat previous-release.env
```

3. Проверить, что failure вызван не schema drift и не mismatch runtime candidate:

```bash
docker compose ps
docker compose logs --tail=200 python-api
docker compose logs --tail=200 python-worker
docker compose exec -T python-api python scripts/migrate.py current
docker compose exec -T python-api python scripts/migrate.py verify-head
```

4. Если проблема вызвана миграцией или данными, восстановить БД из pre-deploy backup:

```bash
pg_restore --clean --if-exists --no-owner --host localhost --port 5433 --username denga --dbname denga ./backups/<backup-file>.dump
```

5. После restore повторно выполнить:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/migrate.py upgrade
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/migrate.py verify-head
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm python-api python scripts/bootstrap_seed.py
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --remove-orphans
```

6. После устранения причины повторить обычный forward deploy через CI/CD. Автоматического rollback и manual rollback workflow больше нет.

Если после выката появились `dead_letter` jobs:

1. Посмотреть `GET /api/health/ready` и `GET /api/metrics`
2. Найти последние `job_failed` записи в логах `python-worker`
3. Исправить код или конфигурацию и повторить deploy
4. Не делать destructive cleanup очереди как часть аварийного восстановления
