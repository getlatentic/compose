#!/usr/bin/env python3
"""PreToolUse guard: block destructive git-worktree removal.

Why this exists: an agent once ran `git worktree remove --force` on a
worktree that held uncommitted, *untracked* work. Plain
`git worktree remove` refuses in that case ("contains modified or
untracked files, use --force to delete it") — `--force` is exactly the
override that bypasses that safety net, and it `rm -rf`s the files
(no Trash, unrecoverable except via the session transcript).

This hook blocks ONLY the dangerous overrides, leaving the safe path
(plain `git worktree remove`, which self-protects) fully usable:

  1. `git worktree remove` combined with `-f` / `--force`
  2. `rm -rf` / `rm -fr` (any recursive+force combo) targeting a path
     under `.claude/worktrees`

Reads the PreToolUse payload on stdin, emits a `deny` decision when a
pattern matches, otherwise stays silent (allow). Narrow by design — it
must never fire on normal git/rm usage.
"""
import json
import re
import sys


def is_dangerous(command: str) -> str | None:
    """Return a human-readable reason if the command is a destructive
    worktree removal, else None."""
    # Normalise whitespace for matching (commands can span lines / use
    # `&&` chains — check each segment).
    segments = re.split(r"&&|\|\||;|\n", command)
    for seg in segments:
        s = seg.strip()
        if not s:
            continue

        # 1. git worktree remove --force / -f
        if re.search(r"\bgit\b.*\bworktree\b.*\bremove\b", s):
            if re.search(r"(?:^|\s)--force(?:\s|$)", s) or re.search(
                r"(?:^|\s)-[a-zA-Z]*f", s
            ):
                return (
                    "Refusing `git worktree remove --force`. It may hold "
                    "uncommitted/untracked work that --force destroys "
                    "permanently (rm -rf, no Trash).\n"
                    "Do instead: `git -C <worktree> status` to inspect → "
                    "commit any WIP to its branch → plain `git worktree "
                    "remove` (no --force), which safely refuses if work "
                    "remains."
                )

        # 2. rm -rf targeting a worktree mirror
        if ".claude/worktrees" in s and re.search(r"\brm\b", s):
            # recursive + force in any flag arrangement: -rf, -fr, -r -f,
            # -Rf, --recursive --force, etc.
            has_recursive = bool(
                re.search(r"(?:^|\s)-[a-zA-Z]*r", s, re.IGNORECASE)
                or "--recursive" in s
            )
            has_force = bool(
                re.search(r"(?:^|\s)-[a-zA-Z]*f", s) or "--force" in s
            )
            if has_recursive and has_force:
                return (
                    "Refusing `rm -rf` on a path under .claude/worktrees. "
                    "Agent worktrees can hold uncommitted/untracked work; "
                    "rm -rf destroys it permanently.\n"
                    "Do instead: inspect with `git -C <worktree> status`, "
                    "commit any WIP, then `git worktree remove` (no --force) "
                    "so git's own safety check applies."
                )
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Can't parse → don't interfere.
        return 0

    command = (payload.get("tool_input") or {}).get("command", "")
    if not isinstance(command, str) or not command:
        return 0

    reason = is_dangerous(command)
    if reason is None:
        return 0  # allow (silent)

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
