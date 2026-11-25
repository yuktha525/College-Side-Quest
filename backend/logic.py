"""Core RPG rules: levels, rank titles, badges, validation, and quest state helpers."""

from __future__ import annotations

import secrets
import sqlite3
from datetime import timedelta

from backend.db import iso_utc, utc_now

XP_PER_LEVEL = 150
CREATOR_HOST_BONUS_XP = 15

CATEGORIES = {
    "rescue": {"label": "Quick Rescue", "default_xp": 75},
    "skill": {"label": "Skill Swap", "default_xp": 100},
    "errand": {"label": "Campus Errand", "default_xp": 60},
    "squad": {"label": "Squad Up", "default_xp": 80},
}

HERO_CLASSES = [
    ("🧙", "Code Mage"),
    ("⚡", "Tech Ranger"),
    ("🎨", "Pixel Bard"),
    ("🛡️", "Squad Tank"),
    ("🦉", "Night Owl"),
    ("🚀", "Lab Alchemist"),
]

BADGES = {
    "first_quest": {
        "id": "first_quest",
        "name": "First Blood",
        "icon": "🌟",
        "description": "Completed your first campus quest",
    },
    "lifesaver": {
        "id": "lifesaver",
        "name": "Lifesaver",
        "icon": "⚡",
        "description": "Rescued a classmate on an urgent quest",
    },
    "debug_wizard": {
        "id": "debug_wizard",
        "name": "Debug Wizard",
        "icon": "🧠",
        "description": "Completed 2+ Skill Swap quests",
    },
    "squad_mvp": {
        "id": "squad_mvp",
        "name": "Clutch Player",
        "icon": "🏆",
        "description": "Completed 2+ Squad Up quests",
    },
    "trusted_five": {
        "id": "trusted_five",
        "name": "Campus Legend",
        "icon": "👑",
        "description": "Completed 5+ quests for fellow students",
    },
}


def compute_level(xp: int) -> dict:
    """Compute level, rank title, and progress bar stats from total XP."""
    safe_xp = max(0, int(xp))
    level = 1 + (safe_xp // XP_PER_LEVEL)
    xp_in_level = safe_xp % XP_PER_LEVEL
    if level >= 5:
        rank = "Campus Legend"
    elif level == 4:
        rank = "Guild Hero"
    elif level == 3:
        rank = "Sidekick"
    elif level == 2:
        rank = "Quad Runner"
    else:
        rank = "Campus Rookie"
    return {
        "level": level,
        "rank": rank,
        "xp": safe_xp,
        "xp_in_level": xp_in_level,
        "xp_next_level": XP_PER_LEVEL,
    }


def expire_stale_quests(conn: sqlite3.Connection) -> int:
    """Mark overdue open quests as expired and return count updated."""
    now_iso = iso_utc(utc_now())
    cur = conn.execute(
        "UPDATE quests SET status = 'expired' WHERE status = 'open' AND expires_at <= ?",
        (now_iso,),
    )
    return cur.rowcount


def generate_pin() -> str:
    """Generate a 4-digit completion PIN string."""
    return f"{secrets.randbelow(9000) + 1000}"


def check_and_award_badges(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    """Evaluate badge milestones for a user and return newly awarded badges."""
    existing = {
        row["badge_id"]
        for row in conn.execute("SELECT badge_id FROM user_badges WHERE user_id = ?", (user_id,))
    }

    rows = conn.execute(
        "SELECT category, COUNT(*) AS cnt FROM quests WHERE claimer_id = ? AND status = 'completed' GROUP BY category",
        (user_id,),
    ).fetchall()
    counts = {r["category"]: int(r["cnt"]) for r in rows}
    total_done = sum(counts.values())

    earned_now: list[str] = []
    if total_done >= 1 and "first_quest" not in existing:
        earned_now.append("first_quest")
    if counts.get("rescue", 0) >= 1 and "lifesaver" not in existing:
        earned_now.append("lifesaver")
    if counts.get("skill", 0) >= 2 and "debug_wizard" not in existing:
        earned_now.append("debug_wizard")
    if counts.get("squad", 0) >= 2 and "squad_mvp" not in existing:
        earned_now.append("squad_mvp")
    if total_done >= 5 and "trusted_five" not in existing:
        earned_now.append("trusted_five")

    now_iso = iso_utc(utc_now())
    for badge_id in earned_now:
        conn.execute(
            "INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)",
            (user_id, badge_id, now_iso),
        )

    return [BADGES[bid] for bid in earned_now if bid in BADGES]


def serialize_user(conn: sqlite3.Connection, row: sqlite3.Row, include_email: bool = False) -> dict:
    lvl = compute_level(row["xp"])
    badge_rows = conn.execute(
        "SELECT badge_id, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at ASC",
        (row["id"],),
    ).fetchall()
    badges = [
        {**BADGES[b["badge_id"]], "earned_at": b["earned_at"]}
        for b in badge_rows
        if b["badge_id"] in BADGES
    ]
    data = {
        "id": row["id"],
        "name": row["name"],
        "department": row["department"],
        "hostel": row["hostel"],
        "avatar": row["avatar"],
        "hero_class": row["hero_class"],
        "reliability": row["reliability"],
        "quests_completed": row["quests_completed"],
        "badges": badges,
        **lvl,
    }
    if include_email:
        data["email"] = row["email"]
    return data


def serialize_quest(row: sqlite3.Row, viewer_id: int | None) -> dict:
    """Serialize a joined quest row, keeping completion_code visible only to the creator."""
    is_creator = viewer_id is not None and row["creator_id"] == viewer_id
    is_claimer = viewer_id is not None and row["claimer_id"] == viewer_id

    data = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "category_label": CATEGORIES.get(row["category"], {}).get("label", row["category"]),
        "location": row["location"],
        "reward_text": row["reward_text"],
        "xp_value": row["xp_value"],
        "status": row["status"],
        "expires_at": row["expires_at"],
        "created_at": row["created_at"],
        "claimed_at": row["claimed_at"],
        "completed_at": row["completed_at"],
        "is_creator": is_creator,
        "is_claimer": is_claimer,
        "creator": {
            "id": row["creator_id"],
            "name": row["creator_name"],
            "avatar": row["creator_avatar"],
            "department": row["creator_dept"],
            "level": compute_level(row["creator_xp"])["level"],
            "reliability": row["creator_reliability"],
        },
        "claimer": None,
    }
    if row["claimer_id"] is not None:
        data["claimer"] = {
            "id": row["claimer_id"],
            "name": row["claimer_name"],
            "avatar": row["claimer_avatar"],
            "department": row["claimer_dept"],
            "level": compute_level(row["claimer_xp"])["level"],
            "reliability": row["claimer_reliability"],
        }
    if is_creator:
        data["completion_code"] = row["completion_code"]
    return data


def clamp_duration_minutes(raw: object) -> int:
    try:
        mins = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 120
    return max(15, min(1440, mins))


def clamp_xp(raw: object, category: str) -> int:
    default_xp = CATEGORIES.get(category, {}).get("default_xp", 75)
    if raw is None or raw == "":
        return default_xp
    try:
        val = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default_xp
    return max(25, min(200, val))


def compute_expiry(minutes: int) -> str:
    return iso_utc(utc_now() + timedelta(minutes=minutes))
