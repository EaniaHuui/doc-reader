"""UTC ISO-8601 helpers."""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso(dt: datetime | None = None) -> str:
    if dt is None:
        dt = utc_now()
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.replace(microsecond=0).isoformat() + 'Z'


def from_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        raw = value.replace('Z', '+00:00')
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def from_mtime(mtime: float) -> str:
    return to_iso(datetime.utcfromtimestamp(mtime))
