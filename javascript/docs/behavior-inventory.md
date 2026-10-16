# Legacy behavior inventory for learning-bot review

## Evidence scale

- **Offline verified:** exercised by lint, 13 unit tests, or the engine-stubbed real-entrypoint smoke.
- **Static trace:** reachable or inspectable in the active source graph, but not directly exercised by a focused test.
- **Live unverified:** no SC2 match was launched in this restoration task.

The categories below intentionally separate ideas from implementation authority. No legacy code has been copied into the learning bot.

## Reference-only ideas

### R1 — Plan-aware action arbitration (priority P0)

- **Behavior:** collect strategic, worker, supply, and infrastructure actions in one place while suppressing fallback macro actions during an active plan.
- **State/trigger:** every `onStep`; `ActionCollector.collectActions()` checks `StrategyManager.isActivePlan()` and idle-worker state.
- **Proposed action:** use the pattern as a design reference for a learning-bot action arbiter that records which policy owned every issued command.
- **Safety/withholding:** return no strategic actions when no active plan; withhold fallback supply/worker actions while the plan owns the frame; do not emit an empty batch.
- **Legacy evidence:** `src/features/actions/actionCollector.js` — `collectActions`, `collectAdditionalActions`, `handleStrategicActions`; `src/starcraftBot.js` — `collectActions`, `executeActions`.
- **Validation and limitations:** active graph loads in the entrypoint smoke; action arbitration itself is static-trace only. `executeActions` logs rejected SC2 actions and clears pending orders, but has no focused regression.
- **Learning-bot opportunity:** a single provenance-aware action queue could reduce competing commands and make reward attribution clearer.

### R2 — Local force-ratio safety filter (priority P1)

- **Behavior:** estimate time-to-kill versus time-to-be-killed near a position and withhold production from threatened trainers when the local force is weaker.
- **State/trigger:** candidate production structure has a position; enemy combatants are mapped within radius 16.
- **Proposed action:** retain as a reference heuristic for threat-aware production and construction, not as a copied combat policy.
- **Safety/withholding:** no nearby combatants defaults to safe; a position is unsafe when estimated friendly kill time exceeds enemy kill time; trainers without positions are withheld.
- **Legacy evidence:** `src/gameLogic/gameMechanics/gameStrategyUtils.js` — `filterSafeTrainers`, `isStrongerAtPosition`, `shouldEngage`, `calculateCombatTimes`; consumed by `src/units/management/training.js`.
- **Validation and limitations:** static trace only. The single-noncombatant guard is currently redundant because the list was already filtered through `potentialCombatants`; estimates also ignore terrain, cooldown timing, and reinforcement arrival.
- **Learning-bot opportunity:** expose a calibrated danger feature and compare it with learned value estimates instead of making it an absolute combat oracle.

## Original implementation candidates

### O1 — Idempotent plan reconciliation with placement gates (priority P0)

- **Behavior:** validate a build-order schema, select/cache one strategy per race, track progress, and issue construction only at placeable locations.
- **State/trigger:** game initialization selects a race strategy; each step reconciles observed units/orders against the current plan.
- **Proposed action:** implement an original learning-bot reconciler whose state is `not_started`, `reserved`, `issued`, `observed`, `complete`, or `withheld` for every plan item.
- **Safety/withholding:** reject malformed build orders; withhold when race data is missing, placement/pathing fails, tech/resources are unavailable, or a matching current/pending order already exists.
- **Legacy evidence:** `src/features/strategy/strategyManager.js` — `initializeStrategy`, `loadStrategy`, `runPlan`; `src/gameLogic/buildOrders/buildOrderProgress.js` — `trackBuildOrderProgress`; `src/features/construction/buildingPlacement.js` — `BuildingPlacement`; `src/features/construction/buildingService.js` — `build`; `src/features/construction/wallOffPlacementService.js` — `WallOffPlacementService`.
- **Validation and limitations:** strategy initialization/loading and action interpretation are covered by 10 unit tests across three suites; placement/reconciliation is static-trace and live unverified.
- **Learning-bot opportunity:** deterministic plan state can bound the learned policy to timing/selection choices while making duplicate-build failures directly measurable.

### O2 — Worker reservation plus rally handoff (priority P0)

- **Behavior:** reserve a selected builder by tag and position, exclude it from mineral rebalancing, optionally rally a worker still in production, and release the reservation on completion/idle/destruction events.
- **State/trigger:** construction intent acquires a worker; worker assignment runs; a structure finishes or the worker becomes idle/destroyed.
- **Proposed action:** build a fresh lease-based worker allocator in the learning bot with owner, target, expiry, and release reason.
- **Safety/withholding:** never reassign an active reservation; withhold rally/build commands when worker tag, position, ability, path, or production source is missing; expire leases that no longer match observed orders.
- **Legacy evidence:** `src/gameLogic/economy/workerService.js` — `reserveWorkerForBuilding`, `releaseWorkerFromBuilding`, `handleRallyBase`, `rallyWorkerToTarget`; `src/gameLogic/economy/workerAssignment.js` — `assignWorkersToMinerals`; `src/features/construction/buildingWorkerInteractions.js` — `assignWorkersToMineralsToBuild`; `src/starcraftBot.js` — `onUnitFinished`, `onUnitIdle`, `onUnitDestroyed` handlers.
- **Validation and limitations:** reachable in the active entrypoint and linted; no focused reservation lifecycle test and no live validation. In-memory sets/maps have no explicit timeout recovery.
- **Learning-bot opportunity:** lease events provide clean features and failure labels for builder theft, duplicate assignment, and late construction.

### O3 — Production-slot continuity guard (priority P1)

- **Behavior:** select only completed, available producers; account for current and pending orders; respect reactor capacity; train workers first when policy says so, otherwise combat units.
- **State/trigger:** an active plan has food headroom or the post-plan macro collector needs more workers/army.
- **Proposed action:** implement a producer-slot ledger that predicts when each slot becomes available and arbitrates worker, army, upgrade, and supply demand.
- **Safety/withholding:** withhold if the ability is unavailable, producer is unfinished/repositioning, pending orders exist, queue capacity is exceeded, food is unavailable, or the local trainer safety filter rejects the structure.
- **Legacy evidence:** `src/units/management/training.js` — `canPerformAbility`, `canTrainUnitType`, `train`, `trainWorkers`, `trainCombatUnits`; `src/gameLogic/economy/trainingManagement.js` — `handleUnitTraining`; `src/units/management/unitOrders.js` — pending-order tracking.
- **Validation and limitations:** Viking/action mapping has a focused unit regression, and the active graph passes lint/load; producer-slot behavior is not simulated and remains live unverified.
- **Learning-bot opportunity:** compare planned versus observed slot occupancy to prevent production gaps without issuing duplicate commands.

## Named legacy adaptations requiring Daniel's approval

### A1 — “Lucid ETA Premove” adaptation (priority P0)

- **Behavior:** earmark resources, estimate builder travel versus affordability/tech timing, path to an adjusted footprint center, and premove only when arrival timing is favorable.
- **State/trigger:** a plan wants a structure before it can yet be placed/afforded.
- **Proposed action:** adapt the named timing semantics—not the source code—into the learning bot after Daniel approves this legacy behavior as a target.
- **Safety/withholding:** withhold when no valid builder/order/position/path exists; for Protoss, also wait until the required pylon will finish before arrival; preserve queued construction intent.
- **Legacy evidence:** `src/features/actions/unitActionUtils.js` — `premoveBuilderToPosition`; `src/state/index.js` — `GameState.shouldPremoveNow`; `src/core/builderUtils.js` — `getBuilder`; `src/utils/workerManagementUtils.js` — `prepareBuildContext`.
- **Validation and limitations:** `calculateMoveTime` has three unit tests, including missing-data `Infinity` fallbacks. End-to-end premove timing and placement are static-trace/live unverified.
- **Learning-bot opportunity:** a controlled A/B feature could measure construction-start latency, mining opportunity cost, and builder loss rate.

### A2 — “Lucid Natural Wall” adaptation (priority P1)

- **Behavior:** derive a Protoss natural-wall pylon/gateway layout from map geometry while checking placement and footprint overlap.
- **State/trigger:** `onGameStart` creates `WallOffPlacementService` and calls `setUpWallOffNatural`.
- **Proposed action:** adapt the wall candidate generator only after Daniel selects race/map scope and approves a named legacy adaptation.
- **Safety/withholding:** every candidate must be placeable, avoid townhall/wall footprint overlap, and remain within pylon power geometry; withhold if no valid candidate set exists.
- **Legacy evidence:** `src/features/construction/wallOffPlacementService.js` — `WallOffPlacementService.setUpWallOffNatural`; `src/features/construction/buildingPlacement.js` — `BuildingPlacement`; `src/starcraftBot.js` — `onGameStart`.
- **Validation and limitations:** lint/load only; no map-fixture regression and no live confirmation on `AbyssalReefAIE`.
- **Learning-bot opportunity:** wall quality can become an explicit spatial score rather than a hard-coded placement choice.

### A3 — “Lucid Plan-to-Macro Handoff” adaptation (priority P2)

- **Behavior:** after build-order completion, expand up to a cap, research available upgrades, build army units, and scout.
- **State/trigger:** `buildOrderState.isBuildOrderCompleted()`; mineral and townhall thresholds gate expansion.
- **Proposed action:** adapt this named handoff only after defining the learning bot's terminal plan state and combat owner.
- **Safety/withholding:** withhold expansion without a free location/resources; withhold army/upgrade actions when costs or producers are unavailable; do not claim match completion because no active attack-order path is confirmed.
- **Legacy evidence:** `src/features/strategy/midGameTransition.js` — `midGameTransition`, `findExpansionLocation`, `buildArmy`, `researchUpgrades`, `scout`; `src/starcraftBot.js` — `handleMidGameTransition`.
- **Validation and limitations:** static trace only and live unverified. Expansion chooses the first available location, production iterates all nominal unit choices, and the active source scan found no non-`src/old` attack command.
- **Learning-bot opportunity:** make the handoff an explicit phase transition with outcome metrics; a separate approved combat policy must own attack/retreat actions.

## Recommended review order

1. **O1 plan reconciliation** — strongest existing test evidence and highest leverage for deterministic learning episodes.
2. **O2 worker lease/rally allocator** — prevents cross-system worker command conflicts.
3. **A1 Lucid ETA Premove** — promising but requires Daniel's explicit adaptation approval and live measurement.
4. **O3 production-slot continuity** — useful once plan and worker ownership are stable.
5. **R2/A3 combat and macro handoff** — keep reference-only until an active combat owner and live evidence exist.
