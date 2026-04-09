FROM python:3.12-slim AS runner

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY apps/python_backend ./apps/python_backend

RUN pip install --no-cache-dir ./apps/python_backend

WORKDIR /app/apps/python_backend

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3001"]
