"""SQLite database initialization, migrations, and initial campus seed data."""

from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.auth import hash_password

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "campus_side_quest.db"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def get_db_path() -> Path:
    env_path = os.environ.get("CSQ_DB_PATH")
    return Path(env_path) if env_path else DEFAULT_DB_PATH


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db(db_path: Path | None = None, seed: bool = True) -> Path:
    """Create tables if needed and optionally seed demo accounts and quests."""
    path = db_path or get_db_path()
    conn = get_connection(path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                department TEXT NOT NULL,
                hostel TEXT NOT NULL,
                avatar TEXT NOT NULL DEFAULT 'CM',
                hero_class TEXT NOT NULL DEFAULT 'Code Mage',
                xp INTEGER NOT NULL DEFAULT 0,
                reliability INTEGER NOT NULL DEFAULT 100,
                quests_completed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_badges (
                user_id INTEGER NOT NULL,
                badge_id TEXT NOT NULL,
                earned_at TEXT NOT NULL,
                PRIMARY KEY (user_id, badge_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS quests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_id INTEGER NOT NULL,
                claimer_id INTEGER,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                location TEXT NOT NULL,
                reward_text TEXT NOT NULL,
                xp_value INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                completion_code TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                claimed_at TEXT,
                completed_at TEXT,
                FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (claimer_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quest_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
            CREATE INDEX IF NOT EXISTS idx_messages_quest ON messages(quest_id);
            """
        )

        # Ensure persistent HMAC secret exists for session signing.
        cur = conn.execute("SELECT value FROM meta WHERE key = 'session_secret'")
        if cur.fetchone() is None:
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('session_secret', ?)",
                (secrets.token_hex(32),),
            )

        if seed:
            user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if user_count == 0:
                _seed_demo_data(conn)

        conn.commit()
    finally:
        conn.close()
    return path


def _seed_demo_data(conn: sqlite3.Connection) -> None:
    now = utc_now()
    demo_pw = hash_password("quest123")

    users = [
        ("Maya Lin", "maya@campus.edu", "CS", "North Hall", "CM", "Code Mage", 340, 100, 4),
        ("Arjun Verma", "arjun@campus.edu", "ECE", "Cedar Block", "TR", "Tech Ranger", 210, 98, 3),
        ("Zoya Khan", "zoya@campus.edu", "Design", "Artisan Wing", "PB", "Pixel Bard", 165, 100, 2),
        ("Kabir Rao", "kabir@campus.edu", "Mech", "North Hall", "ST", "Squad Tank", 95, 95, 1),
    ]

    user_ids: list[int] = []
    for name, email, dept, hostel, avatar, hero_class, xp, rel, done in users:
        cur = conn.execute(
            """
            INSERT INTO users
                (name, email, password_hash, department, hostel, avatar, hero_class, xp, reliability, quests_completed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, email, demo_pw, dept, hostel, avatar, hero_class, xp, rel, done, iso_utc(now)),
        )
        user_ids.append(int(cur.lastrowid))

    # Starter badges for demo heroes
    starter_badges = [
        (user_ids[0], "first_quest"),
        (user_ids[0], "debug_wizard"),
        (user_ids[1], "first_quest"),
        (user_ids[1], "lifesaver"),
        (user_ids[2], "first_quest"),
    ]
    for uid, bid in starter_badges:
        conn.execute(
            "INSERT INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)",
            (uid, bid, iso_utc(now)),
        )

    quests = [
        (
            user_ids[1],
            None,
            "Need a USB-C Mac charger for 1 hour",
            "Battery is at 6% before my project presentation. Sitting near the window desks!",
            "rescue",
            "Central Library 2F",
            "1 Iced Coffee",
            75,
            "open",
            "4821",
            iso_utc(now + timedelta(hours=2)),
            iso_utc(now - timedelta(minutes=12)),
            None,
            None,
        ),
        (
            user_ids[2],
            None,
            "Help fix a Python Flask CORS bug (20 mins)",
            "My frontend can't hit my local API route. Will trade a Figma crash-course or canteen chai!",
            "skill",
            "CS Innovation Lab",
            "Figma tips + Chai",
            100,
            "open",
            "7390",
            iso_utc(now + timedelta(hours=5)),
            iso_utc(now - timedelta(minutes=25)),
            None,
            None,
        ),
        (
            user_ids[3],
            None,
            "Need 1 goalkeeper for 5v5 football at 5:30 PM",
            "Friendly hostel match, gloves provided. Just show up and have fun!",
            "squad",
            "Main Turf Ground",
            "Post-match Gatorade",
            80,
            "open",
            "1549",
            iso_utc(now + timedelta(hours=4)),
            iso_utc(now - timedelta(minutes=40)),
            None,
            None,
        ),
        (
            user_ids[0],
            None,
            "Grab 20-page spiral print from Main Gate shop",
            "Stuck in studio review. Will pay exact print bill + extra samosa for the trouble.",
            "errand",
            "Design Block Atrium",
            "Samosa + Print cost",
            60,
            "open",
            "6024",
            iso_utc(now + timedelta(hours=3)),
            iso_utc(now - timedelta(minutes=5)),
            None,
            None,
        ),
    ]

    for row in quests:
        conn.execute(
            """
            INSERT INTO quests
                (creator_id, claimer_id, title, description, category, location, reward_text, xp_value,
                 status, completion_code, expires_at, created_at, claimed_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )
