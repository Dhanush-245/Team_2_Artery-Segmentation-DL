import pytest
from fastapi import HTTPException

from app.security import MAX_PASSWORD_CHARS, hash_password, verify_password


def test_overlong_password_is_refused_not_crashed():
    stored = hash_password("a-valid-passphrase-1")
    assert verify_password("a-valid-passphrase-1", stored)
    assert verify_password("x" * (MAX_PASSWORD_CHARS + 1), stored) is False
    with pytest.raises(HTTPException) as caught:
        hash_password("x" * (MAX_PASSWORD_CHARS + 1))
    assert caught.value.status_code == 422
