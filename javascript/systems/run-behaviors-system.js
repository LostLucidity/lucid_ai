//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { scoutEnemyMainBehavior, clearFromEnemyBehavior } = require("../helper/behavior/labelled-behavior");
const { supplyDepotBehavior } = require("../helper/behavior/unit-behavior");
const scoutService = require("./scouting/scouting-service");

module.exports = createSystem({
  name: 'RunBehaviorsSystem',
  type: 'agent',
  async onGameStart({ agent }) {
    scoutService.opponentRace = agent.opponent.race;
  },
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    scoutService.opponentRace = seenEnemyUnit.data().race;
  },
  async onStep({ resources }) {
    const collectedActions = [];
    collectedActions.push(...clearFromEnemyBehavior(resources));
    await scoutEnemyMainBehavior(resources, scoutService.opponentRace);
    collectedActions.push(...supplyDepotBehavior(resources));
    await resources.get().actions.sendAction(collectedActions);
  },
});