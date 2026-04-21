FROM python:3.14-slim@sha256:bc389f7dfcb21413e72a28f491985326994795e34d2b86c8ae2f417b4e7818aa AS runner

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-client ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY apps/python_backend ./apps/python_backend

RUN pip install --no-cache-dir ./apps/python_backend

WORKDIR /app/apps/python_backend

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3001"]
