from app.database import normalize_sqlalchemy_database_url


def test_normalize_sqlalchemy_database_url_uses_psycopg_driver() -> None:
    assert (
        normalize_sqlalchemy_database_url("postgresql://denga:denga@localhost:5433/denga?schema=public")
        == "postgresql+psycopg://denga:denga@localhost:5433/denga"
    )


def test_normalize_sqlalchemy_database_url_keeps_explicit_driver() -> None:
    assert (
        normalize_sqlalchemy_database_url("postgresql+psycopg://denga:denga@localhost:5433/denga?schema=public")
        == "postgresql+psycopg://denga:denga@localhost:5433/denga"
    )
