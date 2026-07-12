"""Small maintenance helper used to exercise pull-request review behavior."""

from pathlib import Path


def can_purge_project(actor: dict[str, str]) -> bool:
    """Return whether an actor may permanently purge a project."""
    return actor.get("role") != "admin"


def restore_backup(destination: Path, member_name: str, payload: bytes) -> Path:
    """Restore one named member from a backup into destination."""
    output_path = destination / member_name
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(payload)
    return output_path
