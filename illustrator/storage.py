import json
import sqlite3
from datetime import datetime
from pathlib import Path


def utc_now():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


class IllustratorJobStore:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS illustrator_jobs (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    message TEXT NOT NULL DEFAULT '',
                    settings_json TEXT NOT NULL,
                    analysis_json TEXT NOT NULL DEFAULT '{}',
                    result_json TEXT NOT NULL DEFAULT '{}',
                    error TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS illustrator_job_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    message TEXT NOT NULL
                )
                """
            )

    def create(self, job_id, path, settings, analysis):
        now = utc_now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO illustrator_jobs
                    (id, path, status, progress, message, settings_json, analysis_json, created_at, updated_at)
                VALUES (?, ?, 'queued', 0, 'Queued', ?, ?, ?, ?)
                """,
                (
                    job_id,
                    path,
                    json.dumps(settings, ensure_ascii=False),
                    json.dumps(analysis, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            conn.execute(
                "INSERT INTO illustrator_job_logs (job_id, created_at, message) VALUES (?, ?, ?)",
                (job_id, now, "Queued"),
            )

    def update(self, job_id, **fields):
        allowed = {
            "status",
            "progress",
            "message",
            "result_json",
            "analysis_json",
            "error",
            "cancel_requested",
        }
        updates = []
        values = []
        for key, value in fields.items():
            if key not in allowed:
                continue
            if key.endswith("_json") and not isinstance(value, str):
                value = json.dumps(value, ensure_ascii=False)
            updates.append(f"{key} = ?")
            values.append(value)

        if not updates:
            return

        updates.append("updated_at = ?")
        values.append(utc_now())
        values.append(job_id)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE illustrator_jobs SET {', '.join(updates)} WHERE id = ?",
                values,
            )

    def log(self, job_id, message):
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO illustrator_job_logs (job_id, created_at, message) VALUES (?, ?, ?)",
                (job_id, utc_now(), message),
            )
            conn.execute(
                "UPDATE illustrator_jobs SET message = ?, updated_at = ? WHERE id = ?",
                (message, utc_now(), job_id),
            )

    def get(self, job_id):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM illustrator_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            logs = conn.execute(
                "SELECT created_at, message FROM illustrator_job_logs WHERE job_id = ? ORDER BY id ASC",
                (job_id,),
            ).fetchall()

        result = dict(row)
        for key in ("settings_json", "analysis_json", "result_json"):
            public_key = key.replace("_json", "")
            try:
                result[public_key] = json.loads(result.get(key) or "{}")
            except json.JSONDecodeError:
                result[public_key] = {}
            result.pop(key, None)
        result["logs"] = [dict(log) for log in logs]
        result["cancel_requested"] = bool(result.get("cancel_requested"))
        return result

    def request_cancel(self, job_id):
        self.update(job_id, cancel_requested=1, message="Cancel requested")
        self.log(job_id, "Cancel requested")

    def is_cancel_requested(self, job_id):
        job = self.get(job_id)
        return bool(job and job.get("cancel_requested"))

