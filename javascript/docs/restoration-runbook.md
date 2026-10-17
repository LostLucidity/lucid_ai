# LucidAI JavaScript restoration runbook

## Provenance and entrypoint

- Source repository: `C:\Users\STARD\Documents\Projects\lucid_ai`
- Source branch: `dev`
- Restored from commit: `b3da7f78201f19318a202e84347ae9442d9bf171`
- Isolated checkout: detached worktree; the source checkout remains unchanged.
- Package and ladder contract: `main.js`
- Active implementation: `main.js` -> `src/starcraftBot.js` -> exported `run()`
- Preserved inactive launcher provenance: source commit/history at `javascript/main.js`; no duplicate runtime file is kept in the restored tree.

The pre-refactor launcher was not the runnable implementation at the source commit. It failed during module loading because its abandoned system graph referenced unbound services. The latest `dev` commits instead modify `src/starcraftBot.js`; that module is now reached through the stable `main.js` package and ladder path.

The first authorized local launch attempt on 2026-10-10 stopped before SC2 opened because the transitive `find-process` dependency requires the retired Windows `WMIC` utility. The restored entrypoint now installs a repository-owned Windows process-discovery adapter before loading `@node-sc2/core`. It uses `netstat` for listener discovery and `tasklist` for process-name discovery, with offline regressions proving that neither path invokes `WMIC`. A later authorized one-shot confirmed that the adapter launches SC2 and reaches `Game Started`, then failed during initialization because `data/buildOrders/protoss` did not exist. No retry was made.

After the runtime asset contract was repaired and validated offline, the next authorized one-shot on 2026-10-10 reached `Game Started` on `AbyssalReefAIE`, loaded all Protoss build orders, and selected `2_base_chargelot_all_in_with_fake_3rd_v2`. Its first game-step error was `TypeError: Cannot read properties of undefined (reading 'find')` at `src/gameLogic/economy/workerService.js:318`, where `groupTypes.rallyWorkersAbilities` was undefined. The smoke was stopped, its verified `SC2_x64` process was terminated, and the post-run preflight confirmed zero SC2 processes and no listener on port 5000. The one-shot authorization is consumed; no retry was made.

The worker-rally compatibility failure is repaired offline by a repository-owned `RALLY_WORKER_ABILITIES` list derived from the installed package's individual `Ability` constants. Focused coverage exercises the real `rallyWorkerToTarget` path with a Nexus advertising `RALLY_WORKERS`; the full offline suite passes. This is static acceptance only and does not authorize or establish another live run.

The next authorized one-shot on 2026-10-10 confirmed the worker-rally repair in live play and progressed past the prior failure. On `AbyssalReefAIE`, the bot selected `2_bases_chargelot_sentry_and_immortal`, executed worker production plus multiple non-worker build-order actions, and reached the first new failure at about 2:42 game time: SC2 rejected `MORPH_WARPGATE` commands issued through a `PROBE` toward position `(42, 106)`. A bounded readback identified source-to-runtime semantic drift: the canonical `scrapedBuildOrders.json` row represents `Warp Gate` as upgrade `84`, while this generated runtime build-order file stores it as unit type `133` (`WARPGATE`). The runtime therefore enters structure-placement handling, selects a Probe, and emits the invalid morph command. The same failure repeated rapidly while the bounded output poll was in flight; the process was interrupted after the poll returned, with the last observed game-time line at 5:10. The verified child `SC2_x64` process (PID 73476) was terminated, and the post-run preflight confirmed zero SC2 processes and no listener on port 5000. The one-shot authorization is consumed; no retry was made.

The source-to-runtime semantic drift is now repaired offline. Generation preserves an explicit canonical `interpretedAction` verbatim and only invokes fallback interpretation when a source row omits that field; unresolved fallback actions still fail closed. The runtime-asset verifier now compares every generated step with the canonical source instead of checking file presence alone. One bounded regeneration produced 23 Protoss, 19 Terran, and 18 Zerg assets, and the verifier matched all 60 canonical build orders with zero missing assets, semantic mismatches, or load errors. Full offline validation passes. This is static acceptance only and does not authorize or establish another live run.

The next authorized one-shot on 2026-10-10 pinned `2_bases_chargelot_sentry_and_immortal` on `AbyssalReefAIE`. The repaired `Warp Gate` step completed at 2:40 game time without the prior Probe-issued `MORPH_WARPGATE` rejection, establishing live acceptance of that semantic repair. The run did not pass the broader five-minute smoke: the first new failure appeared at 3:05 when SC2 repeatedly rejected `SMART` commands from Probes targeting units `8836415542` and `8837595162`. Because one output poll returned a large buffered batch, it also contained later game-time lines through 5:00 before the failure was observed; interruption completed with the last observed line at 5:25. No retry was made. The verified child `SC2_x64` process (PID 83124) was terminated, and the post-run preflight confirmed zero SC2 processes and no listener on port 5000. The run itself did not establish the cause of the invalid Probe `SMART` target commands.

The repeated Probe `SMART` failure is now diagnosed and repaired offline. `queueGatherOrdersForProbes` called the shared `gather` helper on every game step while a Probe retained its `BUILD_ASSIMILATOR` order, and `gather` appended another queued command without checking the worker's current or same-frame pending orders. This explains the two fixed Probe/target pairs rejected repeatedly once both gas builders were active. `gather` now suppresses only a gather command for the same target when either `SMART` or a normalized node-sc2 gathering ability already represents it; a different resource target remains eligible. Focused regressions cover same-frame pending `SMART` duplication and an existing `HARVEST_GATHER` order behind the build command. Full offline validation passes. This is static acceptance only and does not authorize or establish another live run.

The following authorized one-shot on 2026-10-10 first confirmed a clean runtime preflight and all 60 runtime build-order assets. It started `2_bases_chargelot_sentry_and_immortal` on `AbyssalReefAIE`, but the first new rejection appeared at 1:05: repeated build commands failed with `CantBuildTooFarFromBuildPowerSource`. The filtered runtime monitor surfaced the first result promptly, but its buffered output still contained later game-time lines through 2:35 before the interruption completed. No retry was made. The launcher closed SC2 without forced termination, and an immediate process/listener inspection found zero `SC2_x64` processes and no listener on port 5000. This run does not establish live acceptance of the Probe gather-order repair.

The rejected action is now attributed offline to the opening `Gateway`, the first power-dependent step in the pinned build order and the step still active before the later `Cybernetics Core`. The placement path accepted a candidate when its center was within 6.5 units of a Pylon even when part of the Gateway's 3-by-3 footprint extended beyond that field. The shared Protoss coverage check now requires every footprint cell to be covered; the placement selector applies it to known and planned Pylon fields, cached-position reuse applies the same rule, and the final command guard checks live `agent.powerSources`. A focused regression proves that an edge-only Gateway candidate is rejected while an inner candidate remains selectable. Full offline validation passes. This attribution is source-backed but the interrupted live output did not retain the rejected target position, and no additional live run was authorized or made.

The next authorized one-shot on 2026-10-10 reran the same pinned map, race, and build order after 30 suites/120 tests passed, all 60 runtime assets matched canonical semantics, and the readiness preflight found zero SC2 processes and zero port-5000 listeners. The opening `Gateway` completed at 1:10 game time without `CantBuildTooFarFromBuildPowerSource`, followed by both Assimilators, the Nexus, Cybernetics Core, second Pylon, Warp Gate, and Robotics Facility; this establishes live acceptance of the full-footprint power repair. The first new rejection appeared at 3:00: Probes `4352901121` and `4361814017` repeatedly issued `SMART` toward the same target unit `8833466395`, which SC2 rejected with `Error`. The output poll had already buffered later lines through 3:45, and interruption output continued through 4:00 before the process closed. No retry was made. SC2 exited without forced termination, and the post-run preflight again confirmed zero SC2 processes and zero port-5000 listeners. The Probe gather-order recurrence class therefore remains open; this run does not identify whether the surviving commands came from the repaired `gather` path or another producer.

An offline producer trace then isolated that live signature to `queueGatherOrdersForProbes -> workerAssignment.gather`. The only other active literal `SMART` producer, `workerService.rallyWorkerToTarget`, places a completed base or worker egg in `unitTags`; it cannot produce the observed Probe-tagged action. Among the `gather` callers, `queueGatherOrdersForProbes` is the path that selects Probes retaining `BUILD_ASSIMILATOR`, independently chooses the nearest mineral for each, and queues `SMART`; it therefore accounts for the two Probe tags sharing target `8833466395`. Its predicate did not verify that either stale build order still corresponded to an incomplete Assimilator. The path now requires a nearby, positioned Assimilator with `buildProgress < 1` before queueing the mineral command. A focused regression reproduces two Probes whose Assimilator orders outlive completed construction and confirms that they emit no `SMART` actions; a companion case preserves the intended command beside an active warpin. This is static acceptance only: SC2 was not launched, the one-shot remains consumed, and live acceptance is still open.

The next authorized one-shot on 2026-10-10 started only after the native readiness preflight reported zero SC2 processes and zero port-5000 listeners and `npm run validate:offline` passed 31 suites/122 tests. It used the same pinned map, race, and build order. The retained failure output was already active by 3:10 game time: Probes `4347920385`, `4351590401`, and `4360503297` repeatedly issued `SMART` toward three distinct targets, `8841461761`, `8840871937`, and `8839954435`, and SC2 returned `Error`. The first output poll was transport-truncated after buffering thousands of lines, so the exact first rejection time and absence of the prior target tag cannot be established; interruption output continued through 3:45. No retry was made. The surviving `SC2_x64` child was re-identified as PID `47420`, start time 11:14:48 PM, at the installed StarCraft II executable and then terminated. The final preflight confirmed zero SC2 processes and zero port-5000 listeners. The active-Assimilator guard therefore does not establish live acceptance of the broader Probe `SMART` recurrence, and the one-shot authorization is consumed.

Offline diagnostic provenance is now attached to every active `gather` caller. A WeakMap associates the action object with one of seven source labels without adding any enumerable or JSON-serializable field to the SC2 protocol action. Failed-action output now includes a `Source:` line, while unattributed actions fail closed to the label `unattributed`. Focused tests cover side-channel serialization safety, gather attachment, failed-action logging, and all seven call sites. `npm run validate:offline` passes 32 suites/126 tests plus lint and the entrypoint smoke. SC2 was not launched for this instrumentation slice, so the surviving live caller is not yet identified and any new one-shot still requires fresh authorization.

The authorized fail-fast provenance run on 2026-10-10 began only after a clean native readiness preflight and a fresh `npm run validate:offline` pass (32 suites/126 tests, lint, and entrypoint smoke). It launched `2_bases_chargelot_sentry_and_immortal` once on `AbyssalReefAIE`. The first retained rejected-action block appeared immediately after the 3:05 game-time line: Probe `4354211841` issued `SMART` toward unit `8837857293`, and Probes `4357095425` and `4358930433` issued `SMART` toward unit `8839692302`; every rejection returned `Error` and reported `Source: workerAssignment.assignWorkerToField.currentAssignment`. The stop signal was sent immediately when that buffered readback returned. Interruption output was transport-truncated, so no later game-time bound can be established from the retained output. No retry was made. The remaining child was verified as the SC2 executable launched for this run (PID `43252`, start time 11:40:57 PM), terminated, and followed by a clean preflight with zero SC2 processes and zero port-5000 listeners. The one-shot authorization is consumed; the surviving producer is now identified and the next repair must be bounded to `assignWorkerToField` plus offline regression.

The confirmed `assignWorkerToField.currentAssignment` producer exposed a concrete stale-target path consistent with the live rejection and that path is now repaired offline. The node-sc2 unit resource keeps dead units addressable through `getByTag`, while `getMineralFields` returns only current/alive mineral nodes. The assignment path previously accepted a dead cached mineral when it still had a position and remained visible, allowing a `SMART` command to target its stale tag. It now resolves an assigned field only from the already filtered alive, visible, nearby mineral collection; a missing assignment is cleared without emitting an action that frame. A focused regression reproduces the stale-label command and proves that it is suppressed and cleared. `npm run validate:offline` passes lint, 32 suites/127 tests, and the entrypoint smoke. The retained live output did not include target-unit liveness or type, so this is the strongest source-backed candidate rather than a live-confirmed cause. This is static acceptance only; SC2 was not launched and live acceptance remains open.

The next authorized one-shot on 2026-10-10 established bounded live acceptance of that repair. A clean readiness preflight and a fresh `npm run validate:offline` pass preceded one pinned `2_bases_chargelot_sentry_and_immortal` launch on `AbyssalReefAIE`. Filtered output retained every five-second game-time marker plus rejected-action and error signals. No rejected action or game-step error appeared through the 3:30 acceptance threshold, past the prior 3:05 recurrence point, and the second base completed by 3:10. The polling transport returned buffered markers through 4:30 before the stop request could be sent, and interruption output continued through 5:05; this is a stop-boundary defect, not authorization for the extended observation. No retry was made. The surviving child was verified as the SC2 executable launched for this run (PID `67928`, start time 11:55:29 PM), terminated, and followed by a clean preflight with zero SC2 processes and zero port-5000 listeners. The one-shot authorization is consumed.

The next authorized one-shot on 2026-10-13 verified the controller-owned stop boundary. After `npm run validate:offline` passed 34 suites/145 tests, the runtime-asset verifier matched all 60 canonical build orders, and the native readiness preflight reported no SC2 process or port-5000 listener, the pinned `2_bases_chargelot_sentry_and_immortal` game ran once on `AbyssalReefAIE`. It completed 11 build-order steps, including Warp Gate and Robotics Facility, and the second base completed by 3:10. No error or rejected-action signal was retained. The controller emitted exactly one `bounded_smoke` receipt with `reason: game_time_limit`, `gameLoop: 4704`, and `limit: 4704` (3:30). The launcher exited normally, but SC2 PID `30012` remained; its executable path, parent chain, and start time were verified against this launch before it was terminated. The final native preflight again reported zero SC2 processes and zero port-5000 listeners. This establishes the in-process cutoff and identifies verified post-run child cleanup as still required. No retry was made.

The follow-up shutdown-hardening slice retains the local SC2 `ChildProcess` returned by node-sc2's launcher for smoke runs only. It waits for normal child exit after protocol shutdown, then signals only that retained child if it remains alive; managed/ladder arguments fail closed rather than using the local launcher. Focused lifecycle coverage exercises managed refusal, normal exit, and bounded termination.

An attempted owned-child smoke on 2026-10-14 is excluded from acceptance. Its immediate native preflight reported two pre-existing `SC2_x64` processes on the learning-bot ports 5500 and 5501, but the preflight CLI returned exit code zero after emitting `status: blocked`; the shell gate incorrectly treated that as launch permission. The run nevertheless created the local port-5000 child, reached the 3:30 receipt at game loop 4704, and logged `Smoke SC2 child 16680 terminated.` The child was gone before manual cleanup could run, while the two learning-bot processes remained. This proves the owned-child path observed in that run, but not a valid isolated smoke acceptance. A future launch must parse the JSON report and require `summary.ready === true`, not rely on the preflight exit code.

The subsequent gated smoke on 2026-10-14 establishes live acceptance of the smoke-only owned-child cleanup path. After `npm run validate:offline` passed 35 suites/152 tests and the runtime-asset verifier matched all 60 assets, `npm run preflight:sc2-runtime:require-ready` reported ready immediately before one pinned `AbyssalReefAIE` launch of `2_bases_chargelot_sentry_and_immortal`. The run completed 11 build-order steps with no retained rejected-action or game-step error, then emitted exactly one `bounded_smoke` receipt with `reason: game_time_limit`, `gameLoop: 4704`, and `limit: 4704`. The retained local SC2 child (PID `41240`) was automatically terminated by the smoke cleanup, `npm start` exited zero, and the post-run `require-ready` check confirmed zero SC2 processes and no port-5000 listener. This one-shot is consumed; no retry is authorized.

## Reproducible offline setup

Tested with Node.js 22.18.0 and npm 10.9.3.

From `javascript`:

```powershell
npm ci
npm run validate:offline
```

`npm ci` runs the package `prepare` lifecycle, which reconstructs the ignored
Protoss, Terran, and Zerg runtime asset directories from the tracked canonical
source before offline validation. Run `npm run prepare:runtime-assets` to
reconstruct and verify those assets without reinstalling dependencies.

`validate:offline` performs:

1. JavaScript lint over the launcher, active `src` tree, and validation scripts.
2. All Jest unit tests in a single process.
3. A launcher smoke that loads `main.js`, proves import does not contact SC2, then invokes `run()` against an in-memory engine stub and verifies one map/two players.

This is offline readiness only. It does not prove map loading, SC2 protocol compatibility, build-order execution in a live frame, combat behavior, or game completion.

## Local configuration

- Local default map: `AbyssalReefAIE`, verified present in this host's SC2 `Maps` directory.
- Default engine port: 5000, verified from the installed `@node-sc2/core` launcher.
- Optional environment overrides: `DEFAULT_MAP`, `DEFAULT_RACE`, `DEFAULT_DIFFICULTY`, and `DEBUG_BUILD_ORDER_KEY`.
- `DEFAULT_RACE` is parsed from `TERRAN`, `ZERG`, or `PROTOSS`; omit unknown values.
- Leave `DEFAULT_DIFFICULTY` unset for the first smoke because the current parser does not normalize an environment string to the node-sc2 numeric enum.

## Bounded live validation plan

Status: the `groupTypes.rallyWorkersAbilities` repair, generated `Warp Gate` build-order semantic repair, opening-Gateway full-footprint power repair, stale assigned-mineral repair, in-process smoke cutoff, and smoke-only owned-child cleanup are verified in bounded live play. The latest accepted gated run reached the exact 3:30 cutoff at game loop 4704 without a logged rejected action or game-step error, automatically terminated its retained child, and left a clean post-run readiness report. The one-shot authorization is consumed and no retry is authorized.

### Authorization contract

When a selected next action already specifies its exact command, map/race, at-most-one launch limit, no-retry rule, stop conditions, and cleanup boundary, Daniel's following `Let's implement` is explicit authorization for that one selected live-validation slice. Do not reclassify that bounded action as a separate decision solely because it starts SC2.

That authorization is consumed by the first invocation. A retry, changed command, changed map/race, expanded duration, or altered stop condition requires a newly selected slice followed by a new `Let's implement`.

### Preconditions

1. Daniel selects a runtime window after the learning-bot B1 batch is no longer using SC2.
2. Read-only process and port checks show no `SC2_x64` process and port 5000 is free.
3. Ports 5500/5501 and 5600-5604 remain reserved for the learning-bot workflow; this bot uses the node-sc2 default port 5000 only.
4. `npm run validate:offline` passes immediately before launch.
5. `npm run preflight:sc2-runtime:require-ready` passes. It emits the native JSON report and exits nonzero unless `summary.ready === true`.
   Run this preflight from the user-owned host boundary that can execute `tasklist`; a sandboxed process view may return `Access denied` and must be treated as `indeterminate`, not as a clean readiness result.

### One-run command

From `javascript` in a fresh PowerShell process:

```powershell
$env:DEFAULT_MAP = 'AbyssalReefAIE'
$env:DEFAULT_RACE = 'PROTOSS'
$env:DEBUG_BUILD_ORDER_KEY = '2_bases_chargelot_sentry_and_immortal'
$env:SC2_SMOKE_SECONDS = '210'
npm run preflight:sc2-runtime:require-ready
if ($LASTEXITCODE -ne 0) { throw 'SC2 runtime readiness preflight did not pass; smoke launch is blocked.' }
npm start
```

This is one local game against the built-in Easy AI. The pinned build-order key makes the next acceptance run exercise the repaired canonical `Warp Gate` step rather than relying on random selection. `SC2_SMOKE_SECONDS=210` caps the smoke at 3:30 game time (game loop 4704). It is not ladder participation and requires no account or authentication change.

### Evidence to capture

- SC2 starts once on `AbyssalReefAIE` through port 5000.
- `onGameStart` completes and logs a selected build-order key.
- The controller emits exactly one `bounded_smoke` receipt with `reason: game_time_limit`, `gameLoop: 4704`, and `limit: 4704`, without `shutdownError`.
- No `Error during onGameStart`, `Error during game step`, `Error sending actions in onStep`, or rejected-action signal appears before that receipt.
- At least one non-worker build-order action is visibly executed.
- Record the first failing action/result if any; do not start a second match in the same validation slice.

### Stop conditions

- Stop before launch unless `npm run preflight:sc2-runtime:require-ready` succeeds. This rejects any active SC2 process, occupied port 5000, or preflight inspection error.
- Stop after the first startup/protocol/map error; preserve the exact error and do not retry automatically.
- End the smoke at the controller's 3:30 game-time cutoff (game loop 4704) or immediately after the bot exits or fails. Cleanup authority is included in each explicitly authorized smoke: after re-reading the process identity, executable path, PID, parent chain, and start time, Codex may terminate only the exact `SC2_x64` process launched by that smoke. Never terminate a pre-existing, unrelated, or ambiguous SC2 process; if identity cannot be proven, stop and ask Daniel to close it manually. Always follow cleanup with the native process/port preflight.
- Do not treat match victory or completion as an acceptance condition yet. The active implementation has macro/scouting logic but no confirmed active attack-order path; combat completion is a separate approval-gated restoration decision.

## Known limitations

- The dependency lock includes `pathfinding` at Git commit `e5bc6588fff6f477327432030d3fdc1ecdf1f033` through a GitHub SSH-style resolution. A first install needs Git/network access even though later validation is offline.
- Existing tests cover build-order loading/interpretation, strategy initialization, and move-time calculation. They do not simulate a live SC2 world.
- The Windows compatibility adapter depends on the built-in `netstat` and `tasklist` commands. Its parsers are regression-tested offline, live startup and build-order loading are confirmed, and the `groupTypes.rallyWorkersAbilities` repair is verified live. Generated build-order semantics match all 60 canonical build orders offline; the pinned Warp Gate path is also verified live.
- The active bot catches and logs errors inside `onGameStart` and `onStep`; live acceptance must inspect the log, not merely the process exit code.
- Combat and threat code exists in the repository, but source presence is not proof that the active launcher emits attack or retreat orders.
