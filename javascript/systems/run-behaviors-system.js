//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { generalScouting } = require("../builds/scouting");
const { scoutEnemyMainBehavior, clearFromEnemyBehavior } = require("../helper/behavior/labelled-behavior");
const { supplyDepotBehavior } = require("../helper/behavior/unit-behavior");
const scoutService = require("./scouting/scouting-service");

module.exports = createSystem({
  name: 'RunBehaviorsSystem',
  type: 'agent',
  async onGameStart({ agent }) {
    scoutService.opponentRace = agent.opponent.race;
  },
  async onEnemyFirstSeen(_world, seenEnemyUnit) {
    scoutService.opponentRace = seenEnemyUnit.data().race;
  },
  async onStep(world) {
    const { resources } = world;
    const { actions } = resources.get();
    const collectedActions = [];
    collectedActions.push(...clearFromEnemyBehavior(world));
    await scoutEnemyMainBehavior(world);
    collectedActions.push(...supplyDepotBehavior(resources));
    await actions.sendAction(collectedActions);
  },
  async onUnitCreated(world, createdUnit) {
    await generalScouting(world, createdUnit);
  },
});