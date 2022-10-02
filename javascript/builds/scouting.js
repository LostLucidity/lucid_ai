//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");
const { getMiddleOfStructure } = require("../services/position-service");

module.exports = {
  cancelEarlyScout: (units) => {
    const earlyScouts = units.getAlive(Alliance.SELF).filter(unit => {
      return unit.labels.has('scoutEnemyMain') || unit.labels.has('scoutEnemyNatural');
    });
    if (earlyScouts.length > 0) {
      earlyScouts.forEach(earlyScout => {
        earlyScout.labels.clear();
        earlyScout.labels.set('clearFromEnemy', true);
      });
    }
  },
  /**
   * @param {World} world 
   * @param {Unit} unit 
   */
  generalScouting: async (world, unit) => {
    const { agent, resources } = world;
    const { actions, map, units } = resources.get();
    const collectedActions = [];
    if (unit.unitType === OVERLORD) {
      const unitCommand = {
        abilityId: MOVE,
        unitTags: [ unit.tag ],
      };
      const townhall = TownhallRace[agent.race][0];
      if (units.getById(OVERLORD).length === 1) {
        getMiddleOfStructure(map.getEnemyNatural().townhallPosition, TownhallRace[agent.race][0]);
        unitCommand.targetWorldSpacePos = getMiddleOfStructure(map.getEnemyNatural().townhallPosition, townhall);
      } else if (units.getById(OVERLORD).length === 2) {
        unitCommand.queueCommand = true;
        unitCommand.targetWorldSpacePos = getMiddleOfStructure(map.getNatural().townhallPosition, townhall);
        collectedActions.push(unitCommand);
        await actions.sendAction(unitCommand);
        const thirds = map.getThirds();
        unitCommand.targetWorldSpacePos = getMiddleOfStructure(thirds[Math.floor(Math.random() * thirds.length)].townhallPosition, townhall);
      } else {
        unitCommand.targetWorldSpacePos = getRandomPoint(map);
      }
      collectedActions.push(unitCommand);
      await actions.sendAction(unitCommand);
    }
  }
}

function getRandomPoint(map) {
  return {
    x: Math.floor(Math.random() * Math.floor(map._mapSize.x)),
    y: Math.floor(Math.random() * Math.floor(map._mapSize.y)),
  };
}