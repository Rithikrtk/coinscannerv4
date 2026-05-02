"""
database.py — CoinScanner Database Layer
==========================================
This file handles everything related to the SQLite database:
  - Where the database file lives on disk
  - How to open a connection to it
  - How to create the tables if they don't exist yet

SQLite is a simple file-based database — no separate server needed.
The entire database is stored in one file: coinscanner.db

Tables created here:
  - users            → stores registered accounts
  - coin_watchlist   → coins a user has starred/saved
  - exchange_watchlist → exchanges a user has starred/saved

HOW TO USE:
  from database import get_db_connection, init_db

  # Open a connection (always close it when done):
  conn   = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
  row    = cursor.fetchone()
  conn.close()

  # Access columns by name (thanks to row_factory):
  print(row["email"])   # ✅ works
  print(row[2])         # also works but less readable
"""

import sqlite3
import os


# ══════════════════════════════════════════════════════════
# DATABASE FILE PATH
# os.path.dirname(__file__) → the folder this file lives in
# We store coinscanner.db in the same folder as database.py
# ══════════════════════════════════════════════════════════
DB_PATH = os.path.join(os.path.dirname(__file__), "coinscanner.db")


def get_db_connection():
    """
    Open and return a SQLite database connection.

    Sets row_factory = sqlite3.Row so you can access columns
    by name (e.g. row["email"]) instead of index (row[2]).

    IMPORTANT: Always call conn.close() when you're done,
    or use a try/finally block to guarantee it closes.

    Returns:
        sqlite3.Connection — an open database connection
    """
    conn = sqlite3.connect(DB_PATH)
    # This makes each row act like a dictionary
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """
    Create all database tables if they don't already exist.

    This is safe to call every time the app starts — the
    'CREATE TABLE IF NOT EXISTS' statement does nothing if
    the table is already there.

    Called once in app.py at startup:
        if __name__ == "__main__":
            init_db()
            app.run()
    """
    conn   = get_db_connection()
    cursor = conn.cursor()

    # ── USERS TABLE ───────────────────────────────────────
    # Stores one row per registered user.
    # is_verified:     0 = not verified yet, 1 = email/phone confirmed
    # otp_code + otp_expiry: used during signup and password reset
    # failed_attempts: count of consecutive failed login attempts
    # locked_until:    Unix timestamp — account locked until this time
    # session_version: incremented on password change to invalidate old sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT    NOT NULL,
            email              TEXT    UNIQUE NOT NULL,
            phone              TEXT    UNIQUE,
            password_hash      TEXT    NOT NULL,
            is_verified        INTEGER DEFAULT 0,
            email_verified     INTEGER DEFAULT 0,
            phone_verified     INTEGER DEFAULT 0,
            otp_code           TEXT,
            otp_expiry         INTEGER,
            email_otp          TEXT,
            email_otp_expiry   INTEGER,
            phone_otp          TEXT,
            phone_otp_expiry   INTEGER,
            failed_attempts    INTEGER DEFAULT 0,
            locked_until       INTEGER DEFAULT 0,
            session_version    INTEGER DEFAULT 0,
            created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ── ALTER TABLE MIGRATION ─────────────────────────────
    # Safely adds new security columns to existing databases.
    # 'ALTER TABLE ADD COLUMN' fails silently if column exists —
    # wrapped in try/except so it never crashes on a fresh db.
    new_columns = [
        ("failed_attempts",  "INTEGER DEFAULT 0"),
        ("locked_until",     "INTEGER DEFAULT 0"),
        ("session_version",  "INTEGER DEFAULT 0"),
        ("email_verified",   "INTEGER DEFAULT 0"),
        ("phone_verified",   "INTEGER DEFAULT 0"),
        ("email_otp",        "TEXT"),
        ("email_otp_expiry", "INTEGER"),
        ("phone_otp",        "TEXT"),
        ("phone_otp_expiry", "INTEGER"),
    ]
    for col_name, col_def in new_columns:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
            conn.commit()
        except Exception:
            pass  # Column already exists — safe to ignore

    # ── COIN WATCHLIST TABLE ──────────────────────────────
    # Each row = one coin saved by one user.
    # UNIQUE(user_id, coin_id) prevents duplicates.
    # ON DELETE CASCADE: if the user is deleted, their watchlist is too.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS coin_watchlist (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            coin_id     TEXT    NOT NULL,
            coin_name   TEXT    NOT NULL,
            coin_symbol TEXT    NOT NULL,
            coin_image  TEXT    DEFAULT '',
            added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, coin_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # ── EXCHANGE WATCHLIST TABLE ──────────────────────────
    # Each row = one exchange saved by one user.
    # Same UNIQUE + CASCADE pattern as coin_watchlist.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS exchange_watchlist (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            exchange_id   TEXT    NOT NULL,
            exchange_name TEXT    NOT NULL,
            exchange_logo TEXT    DEFAULT '',
            added_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, exchange_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # ── LOGIN LOG TABLE ───────────────────────────────────
    # Records every login attempt — success and failure.
    # Used to detect brute force attacks and audit access.
    #
    # ip         → client IP address
    # identifier → email/phone that was entered (never passwords)
    # success    → 1 = logged in, 0 = failed
    # reason     → why it failed: "wrong_password", "locked",
    #              "not_verified", "not_found", "success"
    # timestamp  → Unix time of the attempt
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS login_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ip         TEXT,
            identifier TEXT,
            success    INTEGER DEFAULT 0,
            reason     TEXT,
            timestamp  INTEGER
        )
    """)

    conn.commit()
    conn.close()


def purge_old_logs(days=90):
    """
    Delete login_log entries older than `days` days.

    Called once at app startup to keep the table lean.
    90 days of logs is plenty for security auditing.

    Args:
        days (int): Number of days to retain. Default 90.
    """
    cutoff = int(__import__('time').time()) - (days * 86400)
    conn   = get_db_connection()
    try:
        conn.execute("DELETE FROM login_log WHERE timestamp < ?", (cutoff,))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()
