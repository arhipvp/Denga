from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from passlib.context import CryptContext

from app.config import get_settings


password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(password: str, password_hash: str) -> bool:
    return password_context.verify(password, password_hash)


def hash_password(password: str) -> str:
    return password_context.hash(password)


def create_access_token(payload: dict[str, str]) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expires_days)
    encoded = {
        **payload,
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(encoded, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, str]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        ) from exc

    return {
        "sub": str(payload.get("sub", "")),
        "email": str(payload.get("email", "")),
        "role": str(payload.get("role", "")),
    }

