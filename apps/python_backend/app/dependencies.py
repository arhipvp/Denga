from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.security import decode_access_token


DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(authorization: Annotated[str | None, Header()] = None) -> dict[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    token = authorization.split(" ", 1)[1]
    return decode_access_token(token)


CurrentUser = Annotated[dict[str, str], Depends(get_current_user)]


def require_admin(user: CurrentUser) -> dict[str, str]:
    if user.get("role") != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


AdminUser = Annotated[dict[str, str], Depends(require_admin)]
