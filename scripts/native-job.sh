#!/usr/bin/env bash
set -euo pipefail
# Wait on the workstation's existing mutex while retaining its resource slice.
export CMAKE_BUILD_PARALLEL_LEVEL=2
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.daemon=false"
exec flock --wait 600 "${XDG_RUNTIME_DIR:?}/build-safe.lock" \
  systemd-run --user --scope --quiet --slice=build-safe.slice \
  /usr/bin/nice -n 10 /usr/bin/choom -n 500 -- "$@"
