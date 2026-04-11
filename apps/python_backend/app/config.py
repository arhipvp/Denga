from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "denga-python-api"
    api_prefix: str = "/api"
    port: int = 3001
    node_env: str = "development"
    web_url: str | None = None
    cors_allowed_origins: str | None = None
    database_url: str = "postgresql://denga:denga@localhost:5433/denga?schema=public"
    jwt_secret: str = "change-me"
    jwt_expires_days: int = 7
    household_name: str = "Моя семья"
    default_currency: str = "EUR"
    admin_email: str = "admin@example.com"
    admin_password: str = "change-me-now"
    admin_telegram_id: str | None = None
    second_user_telegram_id: str | None = None
    upload_dir: str = "uploads"
    backup_dir: str = "backups"
    backup_keep_count: int = 10
    log_dir: str = "logs"
    log_level: str = "info"
    polza_api_key: str | None = None
    polza_base_url: str = "https://polza.ai/api/v1"
    polza_model: str = "google/gemini-2.5-flash"
    telegram_bot_token: str | None = None
    telegram_mode: str = "polling"
    telegram_webhook_url: str | None = None
    bootstrap_household_id: str = "bootstrap-household"
    clarification_timeout_minutes: int = 30
    worker_poll_interval_seconds: float = 2.0
    worker_id: str = "python-worker"
    job_lease_seconds: int = 120
    feature_job_dedupe_enabled: bool = True
    feature_strict_draft_state_enabled: bool = True
    feature_enhanced_observability_enabled: bool = True
    feature_dead_letter_jobs_enabled: bool = True

    @property
    def upload_path(self) -> Path:
        return Path.cwd() / self.upload_dir

    @property
    def backup_path(self) -> Path:
        return Path.cwd() / self.backup_dir

    @property
    def log_path(self) -> Path:
        return Path.cwd() / self.log_dir

    @property
    def allowed_cors_origins(self) -> list[str]:
        origins: list[str] = []

        def add_origin(candidate: str | None) -> None:
            value = candidate.strip() if candidate else ""
            if value and value not in origins:
                origins.append(value)

        add_origin(self.web_url)
        if self.cors_allowed_origins:
            for origin in self.cors_allowed_origins.split(","):
                add_origin(origin)

        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
