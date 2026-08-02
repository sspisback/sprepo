"""SQLite persistence for the job agent.

One table, keyed on SerpApi's job_id so re-runs are idempotent.
"""

import sqlite3

DEFAULT_DB_PATH = "jobs.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    job_id      TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    company     TEXT,
    location    TEXT,
    posted_date TEXT,
    seen_at     TEXT NOT NULL
);
"""


def connect(path=DEFAULT_DB_PATH):
    """Open the database and make sure the schema exists."""
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    conn.commit()
    return conn


def insert_new_jobs(conn, jobs):
    """Insert jobs, skipping any job_id already stored.

    Returns the subset that was actually inserted, in the order given.
    INSERT OR IGNORE makes the skip a no-op at the database level; rowcount
    tells us which rows were genuinely new.
    """
    inserted = []
    with conn:  # single transaction; rolls back as a unit on error
        for job in jobs:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO jobs
                    (job_id, title, company, location, posted_date, seen_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    job["job_id"],
                    job["title"],
                    job["company"],
                    job["location"],
                    job["posted_date"],
                    job["seen_at"],
                ),
            )
            if cur.rowcount:
                inserted.append(job)
    return inserted


def count_jobs(conn):
    return conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
