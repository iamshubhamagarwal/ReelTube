"""
Simple in-memory, per-IP sliding-window rate limiter.

Good enough for a single-server deployment. If you ever run several server
processes, move this to Redis.
"""
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int, name: str):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self.hits: Dict[str, Deque[float]] = defaultdict(deque)

    def check(self, ip: str):
        """Record a hit for `ip`; raise HTTP 429 if over the limit."""
        if self.limit <= 0:
            return
        now = time.monotonic()
        q = self.hits[ip]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            retry = int(self.window - (now - q[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Too many {self.name} requests. Try again in {retry} seconds.",
                headers={"Retry-After": str(retry)},
            )
        q.append(now)
        # Occasionally drop idle IPs so the dict doesn't grow forever.
        if len(self.hits) > 10_000:
            for key in [k for k, v in self.hits.items() if not v or now - v[-1] > self.window]:
                del self.hits[key]


def client_ip(request: Request) -> str:
    """
    The client's IP. Behind a reverse proxy (Caddy/nginx), uvicorn's
    --proxy-headers flag makes request.client reflect X-Forwarded-For.
    """
    return request.client.host if request.client else "unknown"
