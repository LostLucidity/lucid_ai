//@ts-check
"use strict"

const performanceTrackingService = {
  expectedGameLoopsPerSecond: 22.4,
  gameLoopsTolerance: 22.4, // tolerance of 1 second
  startGameLoop: 0,
  startRealTime: 0,
}

module.exports = performanceTrackingService;