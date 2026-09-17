#!/bin/bash
# MEMORY / LOAD WATCHER for the overnight build.
#
# Six builder lanes each spawn Playwright workers and Vite servers. Lanes have
# already reported 40-64 Playwright processes and ~23 dev servers live at once,
# and e2e specs timing out at 300s on a machine where a probe that did NO WORK
# also timed out. That is contention, and contention turns into an OOM if
# nobody is looking.
#
# DELIBERATELY CONSERVATIVE. It does not kill lane processes. A lane killed
# mid-run loses hours of work and leaves a half-written file behind, which is
# far more expensive than a slow machine. It only ever reaps TRUE ORPHANS -
# reparented to PID 1, matching a build-tool pattern, older than the grace
# period - and never the playable build server the user is using.
#
# Escalation is a file, not a prompt (D94: never block on a human overnight).
#
#   log:   gauntlet/memwatch.log
#   alarm: gauntlet/memwatch-ALERT.txt   (only written when it matters)

cd "$(dirname "$0")/.." || exit 1
LOG=gauntlet/memwatch.log
ALERT=gauntlet/memwatch-ALERT.txt
INTERVAL=${INTERVAL:-60}

# MB. Tuned for this machine: 64G total, ~59G in use with the lanes up.
WARN_FREE=6000
CRIT_FREE=2500
WARN_SWAP=1400
CRIT_SWAP=1800
ORPHAN_GRACE_MIN=45

# Never touch these, whatever the pressure.
PROTECT='4180|dist-play'

# GROUND TRUTH, not top's "unused".
#
# The first version of this script parsed `top`'s PhysMem line and raised a
# CRITICAL at "1084MB free" while the machine actually had 32.7 GB available.
# Two errors at once, and the lesson is the project's recurring one: a
# measurement that is easy to take is not the same as the right measurement.
#
#   1. macOS "unused" is NOT available memory. Inactive pages are reclaimable
#      and on this machine they were 26 GB of the total.
#   2. The awk that read it was wrong anyway.
#
# vm_stat is the real source. Available = free + inactive + speculative.
sample() {
  local ps free inact spec avail swap_used load
  ps=$(pagesize)
  free=$(vm_stat | awk '/Pages free/           {gsub(/\./,""); print $3}')
  inact=$(vm_stat | awk '/Pages inactive/      {gsub(/\./,""); print $3}')
  spec=$(vm_stat | awk '/Pages speculative/    {gsub(/\./,""); print $3}')
  avail=$(( (free + inact + spec) * ps / 1024 / 1024 ))
  swap_used=$(sysctl -n vm.swapusage | sed -E 's/.*used = ([0-9.]+)M.*/\1/' | cut -d. -f1)
  load=$(sysctl -n vm.loadavg | awk '{print $2}')
  echo "$avail $swap_used $load"
}

# Count real servers and browsers, not every command line containing the word.
# `pgrep -f vite` matched 58 things when 8 were running.
count_vite() { ps -eo args | grep -cE 'node.*vite|vite (dev|preview)'; }
count_pw()   { ps -eo args | grep -cE 'playwright (test|run)|chrome-mac.*Chromium'; }

reap_orphans() {
  local killed=0
  while read -r pid etimes args; do
    [ -z "$pid" ] && continue
    [ "$etimes" -lt $(( ORPHAN_GRACE_MIN * 60 )) ] && continue
    echo "$args" | grep -qE "$PROTECT" && continue
    kill -TERM "$pid" 2>/dev/null && killed=$(( killed + 1 ))
  done < <(ps -eo pid,ppid,etimes,args | awk '$2==1 && ($0 ~ /playwright|vite/) {pid=$1; et=$3; $1=$2=$3=""; print pid, et, $0}')
  echo "$killed"
}

echo "memwatch started $(date '+%F %T')  interval=${INTERVAL}s" >> "$LOG"

while true; do
  read -r FREE SWAP LOAD <<< "$(sample)"
  [ -z "$FREE" ] && FREE=0
  PW=$(count_pw)
  VITE=$(count_vite)
  STATE=ok
  [ "$FREE" -lt "$WARN_FREE" ] || [ "$SWAP" -gt "$WARN_SWAP" ] && STATE=WARN
  [ "$FREE" -lt "$CRIT_FREE" ] || [ "$SWAP" -gt "$CRIT_SWAP" ] && STATE=CRITICAL

  printf '%s  avail=%sMB swap=%sMB load=%s pw=%s vite=%s  %s\n' \
    "$(date '+%F %T')" "$FREE" "$SWAP" "$LOAD" "$PW" "$VITE" "$STATE" >> "$LOG"

  if [ "$STATE" = CRITICAL ]; then
    N=$(reap_orphans)
    {
      echo "MEMORY CRITICAL at $(date '+%F %T')"
      echo "  free ${FREE}MB (floor ${CRIT_FREE}) | swap ${SWAP}MB (ceiling ${CRIT_SWAP}) | load ${LOAD}"
      echo "  playwright=${PW} vite=${VITE}"
      echo "  reaped ${N} true orphan(s); no live lane process was touched."
      echo "  If this repeats, STOP SPAWNING LANES before starting anything new."
    } >> "$ALERT"
  fi

  sleep "$INTERVAL"
done
