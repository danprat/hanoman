#!/usr/bin/env python3
"""Claude Code Stop hook: remind agent to sync docs after implementation changes.

Kalau ada perubahan di `src/` tapi tak ada perubahan doc/kontrak (internal/docs,
internal/skills, AGENTS.md, CLAUDE.md, README.md), blokir Stop dengan pengingat.
Guardrail, bukan pengganti judgment — kalau memang tak butuh update doc, sebut
alasannya di jawaban akhir.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


IMPLEMENTATION_PREFIXES = ("src/",)
DOC_PREFIXES = (
    "internal/docs/",
    "internal/skills/",
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
)


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, check=False)


def normalize_status_paths(output: str) -> list[str]:
    paths: list[str] = []
    for raw in output.splitlines():
        line = raw.strip()
        if not line:
            continue
        # Porcelain v1 shape: "XY path" or "XY old -> new".
        path = line[3:] if len(line) > 3 else line
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.append(path)
    return paths


def changed_paths(cwd: Path) -> list[str]:
    git_root_result = run(["git", "rev-parse", "--show-toplevel"], cwd)
    if git_root_result.returncode != 0:
        return []

    git_root = Path(git_root_result.stdout.strip())
    try:
        rel_cwd = cwd.resolve().relative_to(git_root.resolve())
    except ValueError:
        return []

    status = run(["git", "status", "--short", "--untracked-files=all", "--", "."], cwd)
    if status.returncode != 0:
        return []

    paths = normalize_status_paths(status.stdout)
    if str(rel_cwd) in ("", "."):
        return paths

    prefix = str(rel_cwd).rstrip("/") + "/"
    scoped: list[str] = []
    for path in paths:
        if path.startswith(prefix):
            scoped.append(path[len(prefix) :])
    return scoped


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    if payload.get("stop_hook_active") is True:
        return 0

    cwd = Path(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    paths = changed_paths(cwd)
    if not paths:
        return 0

    implementation_changed = any(path.startswith(IMPLEMENTATION_PREFIXES) for path in paths)
    docs_changed = any(path.startswith(DOC_PREFIXES) for path in paths)

    if implementation_changed and not docs_changed:
        reason = (
            "Ada perubahan di src/ tanpa perubahan dokumentasi. "
            "Update doc terkait di internal/docs/** (atau AGENTS.md/CLAUDE.md/"
            "internal/skills/README.md), lalu selesai. Kalau memang tak butuh "
            "update doc, tambahkan alasannya di jawaban akhirmu."
        )
        print(json.dumps({"decision": "block", "reason": reason}))
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
