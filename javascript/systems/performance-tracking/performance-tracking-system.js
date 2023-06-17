//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const performanceTrackingService = require("./performance-tracking-service");

module.exports = createSystem({
  name: 'PerformanceTracking',
  type: 'agent',
  async onGameStart(world) {
    const { frame } = world.resources.get();
    performanceTrackingService.startGameLoop = frame.getGameLoop();
    performanceTrackingService.startRealTime = performance.now();
  },
  async onStep(world) {
    const { frame } = world.resources.get();
    const currentGameLoop = frame.getGameLoop();
    const elapsedGameLoops = currentGameLoop - performanceTrackingService.startGameLoop;

    const currentRealTime = performance.now();
    const elapsedRealTimeSeconds = (currentRealTime - performanceTrackingService.startRealTime) / 1000;
    const expectedElapsedGameLoops = elapsedRealTimeSeconds * performanceTrackingService.expectedGameLoopsPerSecond;

    // Only check performance after the first two minutes
    if (elapsedRealTimeSeconds > 60) {
      if (elapsedGameLoops < expectedElapsedGameLoops - performanceTrackingService.gameLoopsTolerance) {
        console.warn('Possible slowdown detected!');
      }

      // reset counters every real-time minute
      if (elapsedRealTimeSeconds >= 30) {
        performanceTrackingService.startGameLoop = currentGameLoop;
        performanceTrackingService.startRealTime = currentRealTime;
      }
    }
  }
});