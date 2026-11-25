"""HTTP server, REST API, SSE live event broadcaster, and static file serving."""

from __future__ import annotations

import json
import mimetypes
import os
import queue
import re
import sqlite3
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from backend.auth import (
    create_token,
    get_session_secret,
    hash_password,
    verify_password,
    verify_token,
)
from backend.db import get_connection, init_db, iso_utc, utc_now
from backend.logic import (
    BADGES,
    CATEGORIES,
    CREATOR_HOST_BONUS_XP,
    HERO_CLASSES,
    check_and_award_badges,
    clamp_duration_minutes,
    clamp_xp,
    compute_expiry,
    expire_stale_quests,
    generate_pin,
    serialize_quest,
    serialize_user,
)

STATIC_DIR = Path(__file__).resolve().parent.parent
PUBLIC_STATIC_FILES = {"index.html", "styles.css", "app.js"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

QUEST_SELECT_SQL = """
    SELECT
        q.*,
        c.name AS creator_name,
        c.avatar AS creator_avatar,
        c.department AS creator_dept,
        c.xp AS creator_xp,
        c.reliability AS creator_reliability,
        cl.name AS claimer_name,
        cl.avatar AS claimer_avatar,
        cl.department AS claimer_dept,
        cl.xp AS claimer_xp,
        cl.reliability AS claimer_reliability
    FROM quests q
    JOIN users c ON c.id = q.creator_id
    LEFT JOIN users cl ON cl.id = q.claimer_id
"""


class EventHub:
    """Thread-safe Server-Sent Events pub/sub hub for real-time quest board updates."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue[str]] = set()

    def subscribe(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue(maxsize=32)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue[str]) -> None:
        with self._lock:
            self._subscribers.discard(q)

    def publish(self, event_type: str, payload: dict) -> None:
        message = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
        with self._lock:
            dead: list[queue.Queue[str]] = []
            for q in self._subscribers:
                try:
                    q.put_nowait(message)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self._subscribers.discard(q)


class SideQuestServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], db_path: Path | None = None) -> None:
        self.db_path = init_db(db_path=db_path, seed=True)
        self.hub = EventHub()
        super().__init__(server_address, SideQuestHandler)


class SideQuestHandler(BaseHTTPRequestHandler):
    server: SideQuestServer

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        if os.environ.get("CSQ_QUIET") == "1":
            return
        super().log_message(format, *args)

    # ---- Helpers ----

    def _conn(self) -> sqlite3.Connection:
        return get_connection(self.server.db_path)

    def _send_json(self, status: int, data: dict | list) -> None:
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid Content-Length"})
            return None
        if length <= 0 or length > 64 * 1024:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body missing or too large"})
            return None
        try:
            body = self.rfile.read(length).decode("utf-8")
            parsed = json.loads(body)
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Malformed JSON payload"})
            return None
        if not isinstance(parsed, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON object expected"})
            return None
        return parsed

    def _current_user(self, conn: sqlite3.Connection) -> sqlite3.Row | None:
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        token = auth[7:].strip()
        secret = get_session_secret(conn)
        uid = verify_token(token, secret)
        if uid is None:
            return None
        return conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()

    def _require_user(self, conn: sqlite3.Connection) -> sqlite3.Row | None:
        user = self._current_user(conn)
        if user is None:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in first"})
        return user

    def _fetch_quest_row(self, conn: sqlite3.Connection, quest_id: int) -> sqlite3.Row | None:
        return conn.execute(f"{QUEST_SELECT_SQL} WHERE q.id = ?", (quest_id,)).fetchone()

    # ---- HTTP Dispatch ----

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if path == "/api/meta":
            self._send_json(
                HTTPStatus.OK,
                {
                    "categories": CATEGORIES,
                    "hero_classes": [{"avatar": a, "label": l} for a, l in HERO_CLASSES],
                    "badges": list(BADGES.values()),
                },
            )
            return
        if path == "/api/events":
            self._handle_sse()
            return
        if path == "/api/me":
            self._handle_me()
            return
        if path == "/api/quests":
            self._handle_list_quests(query)
            return
        if path.startswith("/api/quests/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) == 3 and parts[2].isdigit():
                self._handle_get_quest(int(parts[2]))
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest endpoint not found"})
            return
        if path == "/api/leaderboard":
            self._handle_leaderboard()
            return
        if path.startswith("/api/"):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "API endpoint not found"})
            return

        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/auth/register":
            self._handle_register()
            return
        if path == "/api/auth/login":
            self._handle_login()
            return
        if path == "/api/auth/demo":
            self._handle_demo_login()
            return
        if path == "/api/quests":
            self._handle_create_quest()
            return

        parts = [p for p in path.split("/") if p]
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "quests" and parts[2].isdigit():
            quest_id = int(parts[2])
            action = parts[3]
            if action == "claim":
                self._handle_claim_quest(quest_id)
                return
            if action == "unclaim":
                self._handle_unclaim_quest(quest_id)
                return
            if action == "complete":
                self._handle_complete_quest(quest_id)
                return
            if action == "cancel":
                self._handle_cancel_quest(quest_id)
                return
            if action == "messages":
                self._handle_post_message(quest_id)
                return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found"})

    # ---- Auth Handlers ----

    def _handle_register(self) -> None:
        data = self._read_json()
        if data is None:
            return
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        department = str(data.get("department", "CS")).strip() or "CS"
        hostel = str(data.get("hostel", "Main Campus")).strip() or "Main Campus"
        avatar = str(data.get("avatar", "CM")).strip() or "CM"
        hero_class = str(data.get("hero_class", "Code Mage")).strip() or "Code Mage"

        if len(name) < 2 or len(name) > 40:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Name must be 2–40 characters"})
            return
        if not EMAIL_RE.match(email):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Enter a valid college email address"})
            return

        allowed_domains = os.environ.get("CSQ_ALLOWED_DOMAINS", "").strip()
        if allowed_domains:
            domains = [d.strip().lower() for d in allowed_domains.split(",") if d.strip()]
            if not any(email.endswith(f"@{d}") or email.endswith(f".{d}") for d in domains):
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": f"Email must belong to an allowed campus domain ({allowed_domains})"},
                )
                return

        if len(password) < 6:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Password must be at least 6 characters"})
            return

        valid_pairs = {a: l for a, l in HERO_CLASSES}
        if avatar not in valid_pairs:
            avatar, hero_class = "CM", "Code Mage"
        else:
            hero_class = valid_pairs[avatar]

        conn = self._conn()
        try:
            existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing is not None:
                self._send_json(HTTPStatus.CONFLICT, {"error": "An account with this email already exists"})
                return

            cur = conn.execute(
                """
                INSERT INTO users
                    (name, email, password_hash, department, hostel, avatar, hero_class, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    name,
                    email,
                    hash_password(password),
                    department[:24],
                    hostel[:30],
                    avatar,
                    hero_class,
                    iso_utc(utc_now()),
                ),
            )
            uid = int(cur.lastrowid)
            secret = get_session_secret(conn)
            conn.commit()
            user_row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
            token = create_token(uid, secret)
            self._send_json(
                HTTPStatus.CREATED,
                {"token": token, "user": serialize_user(conn, user_row, include_email=True)},
            )
        finally:
            conn.close()

    def _handle_login(self) -> None:
        data = self._read_json()
        if data is None:
            return
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if row is None or not verify_password(password, row["password_hash"]):
                self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid email or password"})
                return
            secret = get_session_secret(conn)
            token = create_token(int(row["id"]), secret)
            self._send_json(
                HTTPStatus.OK,
                {"token": token, "user": serialize_user(conn, row, include_email=True)},
            )
        finally:
            conn.close()

    def _handle_demo_login(self) -> None:
        data = self._read_json()
        if data is None:
            return
        email = str(data.get("email", "maya@campus.edu")).strip().lower()
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Demo hero not found"})
                return
            secret = get_session_secret(conn)
            token = create_token(int(row["id"]), secret)
            self._send_json(
                HTTPStatus.OK,
                {"token": token, "user": serialize_user(conn, row, include_email=True)},
            )
        finally:
            conn.close()

    def _handle_me(self) -> None:
        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return
            self._send_json(HTTPStatus.OK, {"user": serialize_user(conn, user, include_email=True)})
        finally:
            conn.close()

    # ---- Quest Handlers ----

    def _handle_list_quests(self, query: dict[str, list[str]]) -> None:
        category = query.get("category", ["all"])[0]
        scope = query.get("scope", ["board"])[0]
        search = query.get("q", [""])[0].strip().lower()

        conn = self._conn()
        try:
            expired_count = expire_stale_quests(conn)
            if expired_count:
                conn.commit()
            viewer = self._current_user(conn)
            viewer_id = int(viewer["id"]) if viewer else None

            clauses: list[str] = []
            params: list[object] = []

            if scope == "mine":
                if viewer_id is None:
                    self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Sign in to view your quests"})
                    return
                clauses.append("(q.creator_id = ? OR q.claimer_id = ?)")
                params.extend([viewer_id, viewer_id])
            else:
                clauses.append("q.status IN ('open', 'claimed')")

            if category in CATEGORIES:
                clauses.append("q.category = ?")
                params.append(category)

            if search:
                clauses.append("(LOWER(q.title) LIKE ? OR LOWER(q.location) LIKE ? OR LOWER(q.reward_text) LIKE ?)")
                like = f"%{search}%"
                params.extend([like, like, like])

            where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            order_sql = "ORDER BY CASE q.status WHEN 'claimed' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, q.created_at DESC"
            rows = conn.execute(f"{QUEST_SELECT_SQL} {where_sql} {order_sql}", params).fetchall()
            quests = [serialize_quest(r, viewer_id) for r in rows]
            self._send_json(HTTPStatus.OK, {"quests": quests})
        finally:
            conn.close()

    def _handle_get_quest(self, quest_id: int) -> None:
        conn = self._conn()
        try:
            if expire_stale_quests(conn):
                conn.commit()
            viewer = self._current_user(conn)
            viewer_id = int(viewer["id"]) if viewer else None
            row = self._fetch_quest_row(conn, quest_id)
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest not found"})
                return

            msgs = conn.execute(
                """
                SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name, u.avatar AS sender_avatar
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.quest_id = ?
                ORDER BY m.created_at ASC
                """,
                (quest_id,),
            ).fetchall()

            self._send_json(
                HTTPStatus.OK,
                {
                    "quest": serialize_quest(row, viewer_id),
                    "messages": [dict(m) for m in msgs],
                },
            )
        finally:
            conn.close()

    def _handle_create_quest(self) -> None:
        data = self._read_json()
        if data is None:
            return
        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return

            title = str(data.get("title", "")).strip()
            description = str(data.get("description", "")).strip()
            category = str(data.get("category", "rescue")).strip()
            location = str(data.get("location", "")).strip()
            reward_text = str(data.get("reward_text", "")).strip() or "Campus Karma"
            duration_mins = clamp_duration_minutes(data.get("duration_minutes"))
            xp_value = clamp_xp(data.get("xp_value"), category)

            if len(title) < 4 or len(title) > 100:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Title must be 4–100 characters"})
                return
            if category not in CATEGORIES:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid quest category"})
                return
            if len(location) < 2 or len(location) > 60:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Location must be 2–60 characters"})
                return
            if len(description) > 400:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Description must be under 400 characters"})
                return

            pin = generate_pin()
            now_iso = iso_utc(utc_now())
            expires_at = compute_expiry(duration_mins)

            cur = conn.execute(
                """
                INSERT INTO quests
                    (creator_id, title, description, category, location, reward_text, xp_value,
                     status, completion_code, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
                """,
                (
                    int(user["id"]),
                    title,
                    description or "Meet at the campus spot to complete this quest!",
                    category,
                    location,
                    reward_text[:50],
                    xp_value,
                    pin,
                    expires_at,
                    now_iso,
                ),
            )
            qid = int(cur.lastrowid)
            conn.commit()
            row = self._fetch_quest_row(conn, qid)
            quest_obj = serialize_quest(row, int(user["id"]))
            self.server.hub.publish("board_update", {"action": "created", "quest_id": qid})
            self._send_json(HTTPStatus.CREATED, {"quest": quest_obj})
        finally:
            conn.close()

    def _handle_claim_quest(self, quest_id: int) -> None:
        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return
            uid = int(user["id"])

            conn.execute("BEGIN IMMEDIATE")
            expire_stale_quests(conn)
            row = conn.execute("SELECT * FROM quests WHERE id = ?", (quest_id,)).fetchone()
            if row is None:
                conn.rollback()
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest not found"})
                return
            if row["creator_id"] == uid:
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "You cannot accept your own quest"})
                return
            if row["status"] != "open":
                conn.rollback()
                self._send_json(HTTPStatus.CONFLICT, {"error": f"Quest is already {row['status']}"})
                return

            now_iso = iso_utc(utc_now())
            conn.execute(
                "UPDATE quests SET status = 'claimed', claimer_id = ?, claimed_at = ? WHERE id = ?",
                (uid, now_iso, quest_id),
            )
            conn.commit()

            updated = self._fetch_quest_row(conn, quest_id)
            self.server.hub.publish("board_update", {"action": "claimed", "quest_id": quest_id})
            self._send_json(HTTPStatus.OK, {"quest": serialize_quest(updated, uid)})
        finally:
            conn.close()

    def _handle_unclaim_quest(self, quest_id: int) -> None:
        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return
            uid = int(user["id"])

            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM quests WHERE id = ?", (quest_id,)).fetchone()
            if row is None:
                conn.rollback()
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest not found"})
                return
            if row["status"] != "claimed":
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Only claimed quests can be released"})
                return
            if uid not in (row["claimer_id"], row["creator_id"]):
                conn.rollback()
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Not allowed to release this quest"})
                return

            # Small reliability nudge if claimer backs out voluntarily
            if uid == row["claimer_id"]:
                conn.execute(
                    "UPDATE users SET reliability = MAX(50, reliability - 2) WHERE id = ?",
                    (uid,),
                )

            conn.execute(
                "UPDATE quests SET status = 'open', claimer_id = NULL, claimed_at = NULL WHERE id = ?",
                (quest_id,),
            )
            conn.commit()
            updated = self._fetch_quest_row(conn, quest_id)
            self.server.hub.publish("board_update", {"action": "unclaimed", "quest_id": quest_id})
            self._send_json(HTTPStatus.OK, {"quest": serialize_quest(updated, uid)})
        finally:
            conn.close()

    def _handle_complete_quest(self, quest_id: int) -> None:
        data = self._read_json()
        if data is None:
            return
        submitted_pin = str(data.get("pin", "")).strip()

        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return
            uid = int(user["id"])

            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM quests WHERE id = ?", (quest_id,)).fetchone()
            if row is None:
                conn.rollback()
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest not found"})
                return
            if row["status"] != "claimed":
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Quest must be claimed before completion"})
                return
            if row["claimer_id"] != uid:
                conn.rollback()
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Only the assigned hero can enter the completion PIN"})
                return
            if submitted_pin != row["completion_code"]:
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Incorrect 4-digit handshake PIN"})
                return

            now_iso = iso_utc(utc_now())
            xp_award = int(row["xp_value"])
            creator_id = int(row["creator_id"])

            conn.execute(
                "UPDATE quests SET status = 'completed', completed_at = ? WHERE id = ?",
                (now_iso, quest_id),
            )
            conn.execute(
                """
                UPDATE users
                SET xp = xp + ?,
                    quests_completed = quests_completed + 1,
                    reliability = MIN(100, reliability + 1)
                WHERE id = ?
                """,
                (xp_award, uid),
            )
            conn.execute(
                "UPDATE users SET xp = xp + ? WHERE id = ?",
                (CREATOR_HOST_BONUS_XP, creator_id),
            )

            new_badges = check_and_award_badges(conn, uid)
            conn.commit()

            updated_quest = self._fetch_quest_row(conn, quest_id)
            updated_user = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
            self.server.hub.publish("board_update", {"action": "completed", "quest_id": quest_id})
            self._send_json(
                HTTPStatus.OK,
                {
                    "quest": serialize_quest(updated_quest, uid),
                    "user": serialize_user(conn, updated_user, include_email=True),
                    "xp_awarded": xp_award,
                    "new_badges": new_badges,
                },
            )
        finally:
            conn.close()

    def _handle_cancel_quest(self, quest_id: int) -> None:
        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return
            uid = int(user["id"])

            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM quests WHERE id = ?", (quest_id,)).fetchone()
            if row is None:
                conn.rollback()
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest not found"})
                return
            if row["creator_id"] != uid:
                conn.rollback()
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Only the quest poster can cancel it"})
                return
            if row["status"] == "completed":
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Completed quests cannot be cancelled"})
                return

            conn.execute("UPDATE quests SET status = 'cancelled' WHERE id = ?", (quest_id,))
            conn.commit()
            self.server.hub.publish("board_update", {"action": "cancelled", "quest_id": quest_id})
            self._send_json(HTTPStatus.OK, {"status": "cancelled"})
        finally:
            conn.close()

    def _handle_post_message(self, quest_id: int) -> None:
        data = self._read_json()
        if data is None:
            return
        body = str(data.get("body", "")).strip()
        if not body or len(body) > 300:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Message must be 1–300 characters"})
            return

        conn = self._conn()
        try:
            user = self._require_user(conn)
            if user is None:
                return
            uid = int(user["id"])

            quest = conn.execute("SELECT * FROM quests WHERE id = ?", (quest_id,)).fetchone()
            if quest is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Quest not found"})
                return
            if quest["status"] == "claimed" and uid not in (quest["creator_id"], quest["claimer_id"]):
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Chat is private between poster and helper"})
                return

            now_iso = iso_utc(utc_now())
            cur = conn.execute(
                "INSERT INTO messages (quest_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)",
                (quest_id, uid, body, now_iso),
            )
            msg_id = int(cur.lastrowid)
            conn.commit()

            msg = {
                "id": msg_id,
                "sender_id": uid,
                "body": body,
                "created_at": now_iso,
                "sender_name": user["name"],
                "sender_avatar": user["avatar"],
            }
            self.server.hub.publish("quest_message", {"quest_id": quest_id})
            self._send_json(HTTPStatus.CREATED, {"message": msg})
        finally:
            conn.close()

    # ---- Leaderboard & Live Events ----

    def _handle_leaderboard(self) -> None:
        conn = self._conn()
        try:
            top_heroes = conn.execute(
                "SELECT * FROM users ORDER BY xp DESC, quests_completed DESC LIMIT 12"
            ).fetchall()
            dept_rows = conn.execute(
                """
                SELECT department, SUM(xp) AS total_xp, SUM(quests_completed) AS total_done, COUNT(*) AS members
                FROM users
                GROUP BY department
                ORDER BY total_xp DESC
                """
            ).fetchall()
            hostel_rows = conn.execute(
                """
                SELECT hostel, SUM(xp) AS total_xp, SUM(quests_completed) AS total_done, COUNT(*) AS members
                FROM users
                GROUP BY hostel
                ORDER BY total_xp DESC
                """
            ).fetchall()

            self._send_json(
                HTTPStatus.OK,
                {
                    "heroes": [serialize_user(conn, r) for r in top_heroes],
                    "departments": [dict(r) for r in dept_rows],
                    "hostels": [dict(r) for r in hostel_rows],
                },
            )
        finally:
            conn.close()

    def _handle_sse(self) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = self.server.hub.subscribe()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=20)
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.server.hub.unsubscribe(q)

    # ---- Static File Serving ----

    def _serve_static(self, raw_path: str) -> None:
        rel = "index.html" if raw_path in ("", "/") else raw_path.lstrip("/")
        if rel not in PUBLIC_STATIC_FILES:
            rel = "index.html"
        target = (STATIC_DIR / rel).resolve()
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Static file not found")
            return

        content_type, _ = mimetypes.guess_type(str(target))
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
