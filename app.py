"""CampusSideQuest application entry point."""

from __future__ import annotations

import os
import signal
import sys

from backend.server import SideQuestServer


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = SideQuestServer((host, port))

    def shutdown_handler(_signum, _frame) -> None:
        print("\nShutting down CampusSideQuest...")
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    print(f"CampusSideQuest running at http://localhost:{port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
