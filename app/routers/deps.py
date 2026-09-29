from __future__ import annotations

from fastapi import Request

from ..services.jobs import JobManager


def get_manager(request: Request) -> JobManager:
    return request.app.state.jobs