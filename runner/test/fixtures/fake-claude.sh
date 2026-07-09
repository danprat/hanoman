#!/bin/sh
# Berdiri sebagai binary `claude` di test ClaudeSession. Argv-nya sengaja diabaikan:
# `node` akan menafsirkan `-p` milik claude sebagai `--print` miliknya sendiri.
exec node "$(dirname "$0")/fake-claude-stream.mjs"
