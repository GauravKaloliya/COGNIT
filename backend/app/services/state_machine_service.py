"""State machine helpers for workflow transitions."""


class StateTransitionError(ValueError):
    """Raised when a workflow transition is not allowed."""

    pass
