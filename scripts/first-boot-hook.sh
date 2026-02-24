#!/bin/bash
#
# OPNet Engine first-boot hook
#
# Called by first-boot.sh after the engine package is installed.
# OPNet has no external host dependencies — all tools are bundled as JS.
#

set -e

LOG_FILE="${LOG_FILE:-/var/log/blockhost-firstboot.log}"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [engine-hook] $1"
    echo "$msg" >> "$LOG_FILE"
    echo "$msg"
}

log "OPNet engine: no additional host dependencies needed"
exit 0
