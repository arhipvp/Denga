from collections.abc import Generator
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import get_settings


Base = declarative_base()
settings = get_settings()


def normalize_sqlalchemy_database_url(database_url: str) -> str:
    parts = urlsplit(database_url)
    if "+" in parts.scheme:
        return database_url
    if parts.scheme == "postgresql":
        return urlunsplit(("postgresql+psycopg", parts.netloc, parts.path, parts.query, parts.fragment))
    if parts.scheme == "postgres":
        return urlunsplit(("postgresql+psycopg", parts.netloc, parts.path, parts.query, parts.fragment))
    return database_url


engine = create_engine(normalize_sqlalchemy_database_url(settings.database_url), future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
