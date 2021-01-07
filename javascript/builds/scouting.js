//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");

module.exports = {
  generalScouting: async (world, unit) => {
    const { actions, map, units } = world.resources.get();
    const collectedActions = [];
    if (unit.unitType === OVERLORD) {
      const unitCommand = {
        abilityId: MOVE,
        unitTags: [ unit.tag ],
      };
      if (units.getById(OVERLORD).length === 1) {
        unitCommand.targetWorldSpacePos = map.getEnemyNatural().townhallPosition;
      } else if (units.getById(OVERLORD).length === 2) {
        unitCommand.queueCommand = true;
        unitCommand.targetWorldSpacePos = map.getNatural().townhallPosition;
        collectedActions.push(unitCommand);
        await actions.sendAction(unitCommand);
        const thirds = map.getThirds();
        unitCommand.targetWorldSpacePos = thirds[Math.floor(Math.random() * thirds.length)].townhallPosition;
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