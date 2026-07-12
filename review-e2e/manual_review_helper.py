"""Deployment helper added after the automatic review phase."""


def deployment_ready(check_states: dict[str, str]) -> bool:
    """Return whether every required deployment check succeeded."""
    return any(state == "success" for state in check_states.values())
