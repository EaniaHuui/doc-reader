import json
import os
import sqlite3
from pathlib import Path


DEFAULT_SETTINGS = {
    "enabled": True,
    "text_provider": "openai-compatible",
    "text_model": "gpt-4.1-mini",
    "text_base_url": "https://api.openai.com/v1",
    "text_api_key_env": "OPENAI_API_KEY",
    "image_provider": "openai-compatible",
    "image_model": "gpt-image-1",
    "image_base_url": "https://api.openai.com/v1",
    "image_api_key_env": "OPENAI_API_KEY",
    "image_size": "1536x1024",
    "image_quality": "auto",
    "custom_image_command": "",
    "default_preset": "hand-drawn-edu",
    "default_density": "balanced",
    "default_output_dir": "imgs-subdir",
    "batch_size": 2,
    "timeout_seconds": 120,
    "retry_count": 1,
}


PUBLIC_SETTING_KEYS = [
    "enabled",
    "text_provider",
    "text_model",
    "text_base_url",
    "text_api_key_env",
    "image_provider",
    "image_model",
    "image_base_url",
    "image_api_key_env",
    "image_size",
    "image_quality",
    "custom_image_command",
    "default_preset",
    "default_density",
    "default_output_dir",
    "batch_size",
    "timeout_seconds",
    "retry_count",
]


class IllustratorSettingsStore:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def load(self, config_defaults=None):
        settings = dict(DEFAULT_SETTINGS)
        if config_defaults:
            settings.update({k: v for k, v in config_defaults.items() if k in PUBLIC_SETTING_KEYS})

        with self._connect() as conn:
            rows = conn.execute("SELECT key, value FROM ai_settings").fetchall()
        for key, raw_value in rows:
            if key in PUBLIC_SETTING_KEYS:
                try:
                    settings[key] = json.loads(raw_value)
                except json.JSONDecodeError:
                    settings[key] = raw_value

        return self._normalize(settings)

    def save(self, values, config_defaults=None):
        current = self.load(config_defaults)
        cleaned = {}
        for key in PUBLIC_SETTING_KEYS:
            if key in values:
                cleaned[key] = values[key]
        current.update(cleaned)
        current = self._normalize(current)

        with self._connect() as conn:
            for key, value in current.items():
                conn.execute(
                    """
                    INSERT INTO ai_settings (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (key, json.dumps(value, ensure_ascii=False)),
                )
        return current

    def _normalize(self, settings):
        normalized = dict(DEFAULT_SETTINGS)
        normalized.update(settings or {})

        for key in ("batch_size", "timeout_seconds", "retry_count"):
            try:
                normalized[key] = int(normalized[key])
            except (TypeError, ValueError):
                normalized[key] = DEFAULT_SETTINGS[key]

        normalized["batch_size"] = max(1, min(normalized["batch_size"], 8))
        normalized["timeout_seconds"] = max(10, min(normalized["timeout_seconds"], 600))
        normalized["retry_count"] = max(0, min(normalized["retry_count"], 3))
        normalized["enabled"] = bool(normalized.get("enabled", True))

        for key in PUBLIC_SETTING_KEYS:
            if key not in normalized:
                normalized[key] = DEFAULT_SETTINGS[key]
            if isinstance(normalized[key], str):
                normalized[key] = normalized[key].strip()

        return normalized


def public_settings(settings):
    result = {key: settings.get(key, DEFAULT_SETTINGS.get(key)) for key in PUBLIC_SETTING_KEYS}
    result["text_api_key_available"] = bool(os.environ.get(result.get("text_api_key_env", "")))
    result["image_api_key_available"] = bool(os.environ.get(result.get("image_api_key_env", "")))
    return result
