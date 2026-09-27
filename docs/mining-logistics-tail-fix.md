# Confirmed-clear logistics tails

Live evidence (2026-09-27 screenshots, read-only): TEST1 moved VI -> III and TEST2
VII -> VIII, while their haulers remained on DRAINING grids with 72% / 67% holds.

Root cause: `loot-containers` published `miningDrainGridClear` after 31 consecutive
empty reads, but the Standard hauler's 90% branch never entered `deliver-ore` with
a partial load. Only `deliver-ore` could finish the tail. Repeated looting reset
the step-local confirmation window and never emptied the hold.

The shared decider now routes a confirmed owned DRAINING tail through an existing
`ore-hold-at-least -> single deliver-ore` branch regardless of the threshold. This
is deliberately a narrow operation overlay, not a changed hold reading or a new
delivery engine. Standard Belt/Ore Anomaly/Ice profiles and custom routines using
that same idiom keep their explicit delivery station/division. Arbitrary custom
control flows are not rewritten. ACTIVE-target thresholds are unchanged.

- Nonclear old grid: collect normally; normal delivery leaves the tail assigned
  and the next travel block returns to the old target (site bookmark when needed).
- Clear old grid: wait for all miners' final dumps and bounded empty confirmation.
  Empty, readable freight completes on-grid; any freight triggers final delivery.
- Unreadable freight, refused transfer, refused containers or a failed route do
  not prove completion. Existing runner refusal/Stop handling remains in force.
- Confirmed empty freight after unloading completes only this hauler. All pending
  haulers must finish before the board tail closes. Repeated completion is a no-op.
- The next travel block reads the latest authoritative current target, or waits
  if none exists. Belt looting now yields back to travel after assignment changes,
  matching site looting; it cannot remain waiting on the completed old grid.

Existing phase/action logs identify final partial delivery and empty-hold
completion. History adds HAULER_DRAIN_COMPLETED (with catch-up target at that
instant) and one LOGISTICS_TAIL_COMPLETED per finished tail. The catch-up target
in history is diagnostic only, never a cached travel instruction.

No new observations, polling, container authority, profile copies or gameplay
APIs. The freight helper and global container leases remain unchanged.

Manual retest: two Standard BELT / HAULER_SERVICE operations on x0.1 belts. After
depletion/miner clearance/relocation, verify the old clear grid with a sub-90%
load causes final unload, the tail disappears after all its haulers finish, and
the hauler returns to the latest current target and resumes collection. Also
verify an empty tail avoids an unnecessary station trip and Stop remains scoped.
