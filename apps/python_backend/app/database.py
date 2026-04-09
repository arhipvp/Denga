from collections.abc import Generator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import get_settings


Base = declarative_base()
settings = get_settings()


def normalize_sqlalchemy_database_url(database_url: str) -> str:
    parts = urlsplit(database_url)
    query_items = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key.lower() != "schema"]
    query = urlencode(query_items)
    if "+" in parts.scheme:
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
    if parts.scheme == "postgresql":
        return urlunsplit(("postgresql+psycopg", parts.netloc, parts.path, query, parts.fragment))
    if parts.scheme == "postgres":
        return urlunsplit(("postgresql+psycopg", parts.netloc, parts.path, query, parts.fragment))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


engine = create_engine(normalize_sqlalchemy_database_url(settings.database_url), future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
