"""Automated end-to-end API and game-logic tests for CampusSideQuest."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path

os.environ["CSQ_QUIET"] = "1"

from backend.db import get_connection, iso_utc, utc_now
from backend.server import SideQuestServer


class CampusSideQuestTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "test.db"
        self.server = SideQuestServer(("127.0.0.1", 0), db_path=self.db_path)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.tmp_dir.cleanup()

    def request(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        token: str | None = None,
    ) -> tuple[int, dict]:
        url = f"http://127.0.0.1:{self.port}{path}"
        headers: dict[str, str] = {}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            try:
                return err.code, json.loads(err.read().decode("utf-8"))
            finally:
                err.close()

    def register_user(self, name: str, email: str, dept: str = "CS", hostel: str = "North Hall") -> tuple[str, dict]:
        status, body = self.request(
            "POST",
            "/api/auth/register",
            {
                "name": name,
                "email": email,
                "password": "password123",
                "department": dept,
                "hostel": hostel,
                "avatar": "🧙",
            },
        )
        self.assertEqual(status, 201, body)
        return body["token"], body["user"]

    def test_static_root_and_health(self) -> None:
        status, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
            self.assertEqual(resp.status, 200)
            self.assertIn("CampusSideQuest", html)

    def test_register_login_and_duplicate_email(self) -> None:
        token, user = self.register_user("Riya Sharma", "riya@campus.edu")
        self.assertEqual(user["level"], 1)
        self.assertEqual(user["rank"], "Campus Rookie")

        status, _ = self.request(
            "POST",
            "/api/auth/register",
            {"name": "Riya 2", "email": "riya@campus.edu", "password": "password123"},
        )
        self.assertEqual(status, 409)

        status, login_body = self.request(
            "POST",
            "/api/auth/login",
            {"email": "riya@campus.edu", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(login_body["user"]["id"], user["id"])

        status, me_body = self.request("GET", "/api/me", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(me_body["user"]["email"], "riya@campus.edu")

    def test_full_quest_lifecycle_pin_xp_and_badges(self) -> None:
        poster_tok, poster = self.register_user("Poster Sam", "sam@campus.edu", dept="CS")
        helper_tok, helper = self.register_user("Helper Alex", "alex@campus.edu", dept="ECE")

        # Create quest
        status, created = self.request(
            "POST",
            "/api/quests",
            {
                "title": "Need scientific calculator before exam",
                "description": "In Hall 4, quick rescue!",
                "category": "rescue",
                "location": "Exam Hall 4",
                "reward_text": "1 Cold Coffee",
                "duration_minutes": 120,
            },
            token=poster_tok,
        )
        self.assertEqual(status, 201)
        quest = created["quest"]
        qid = quest["id"]
        pin = quest["completion_code"]
        self.assertEqual(len(pin), 4)

        # Creator cannot claim own quest
        status, _ = self.request("POST", f"/api/quests/{qid}/claim", {}, token=poster_tok)
        self.assertEqual(status, 400)

        # Helper cannot see PIN before completion
        status, helper_view = self.request("GET", f"/api/quests/{qid}", token=helper_tok)
        self.assertEqual(status, 200)
        self.assertNotIn("completion_code", helper_view["quest"])

        # Helper claims quest
        status, claimed = self.request("POST", f"/api/quests/{qid}/claim", {}, token=helper_tok)
        self.assertEqual(status, 200)
        self.assertEqual(claimed["quest"]["status"], "claimed")

        # Third user cannot double-claim
        other_tok, _ = self.register_user("Other Pat", "pat@campus.edu")
        status, _ = self.request("POST", f"/api/quests/{qid}/claim", {}, token=other_tok)
        self.assertEqual(status, 409)

        # Party chat works for claimer, blocked for outsider
        status, _ = self.request(
            "POST", f"/api/quests/{qid}/messages", {"body": "On my way!"}, token=helper_tok
        )
        self.assertEqual(status, 201)
        status, _ = self.request(
            "POST", f"/api/quests/{qid}/messages", {"body": "Intruder"}, token=other_tok
        )
        self.assertEqual(status, 403)

        # Wrong PIN rejected
        status, _ = self.request(
            "POST", f"/api/quests/{qid}/complete", {"pin": "0000"}, token=helper_tok
        )
        self.assertEqual(status, 400)

        # Correct PIN completes quest, awards XP and badges
        status, completed = self.request(
            "POST", f"/api/quests/{qid}/complete", {"pin": pin}, token=helper_tok
        )
        self.assertEqual(status, 200)
        self.assertEqual(completed["quest"]["status"], "completed")
        self.assertEqual(completed["xp_awarded"], 75)
        self.assertEqual(completed["user"]["xp"], 75)
        badge_ids = {b["id"] for b in completed["new_badges"]}
        self.assertIn("first_quest", badge_ids)
        self.assertIn("lifesaver", badge_ids)

        # Poster also received host bonus (+15 XP)
        _, poster_after = self.request("GET", "/api/me", token=poster_tok)
        self.assertEqual(poster_after["user"]["xp"], poster["xp"] + 15)

    def test_unclaim_cancel_and_auto_expiry(self) -> None:
        poster_tok, _ = self.register_user("Neha", "neha@campus.edu")
        helper_tok, _ = self.register_user("Dev", "dev@campus.edu")

        _, created = self.request(
            "POST",
            "/api/quests",
            {"title": "Grab lab manual", "category": "errand", "location": "Main Gate"},
            token=poster_tok,
        )
        qid = created["quest"]["id"]

        self.request("POST", f"/api/quests/{qid}/claim", {}, token=helper_tok)
        status, unclaimed = self.request("POST", f"/api/quests/{qid}/unclaim", {}, token=helper_tok)
        self.assertEqual(status, 200)
        self.assertEqual(unclaimed["quest"]["status"], "open")

        # Cancel by creator works
        status, cancelled = self.request("POST", f"/api/quests/{qid}/cancel", {}, token=poster_tok)
        self.assertEqual(status, 200)
        self.assertEqual(cancelled["status"], "cancelled")

        # Create another quest and force expiry in DB
        _, created2 = self.request(
            "POST",
            "/api/quests",
            {"title": "Quick expired quest", "category": "squad", "location": "Turf"},
            token=poster_tok,
        )
        qid2 = created2["quest"]["id"]
        conn = get_connection(self.db_path)
        try:
            conn.execute(
                "UPDATE quests SET expires_at = ? WHERE id = ?",
                (iso_utc(utc_now() - timedelta(minutes=5)), qid2),
            )
            conn.commit()
        finally:
            conn.close()

        status, _ = self.request("POST", f"/api/quests/{qid2}/claim", {}, token=helper_tok)
        self.assertEqual(status, 409)

    def test_leaderboard_and_demo_login(self) -> None:
        status, demo = self.request("POST", "/api/auth/demo", {"email": "maya@campus.edu"})
        self.assertEqual(status, 200)
        self.assertEqual(demo["user"]["name"], "Maya Lin")

        status, lb = self.request("GET", "/api/leaderboard")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(lb["heroes"]), 4)
        self.assertGreaterEqual(len(lb["departments"]), 3)
        self.assertGreaterEqual(len(lb["hostels"]), 2)


if __name__ == "__main__":
    unittest.main()
