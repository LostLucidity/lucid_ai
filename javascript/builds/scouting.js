//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");

module.exports = {
  generalScouting: (world, unit) => {
    const collectedActions = [];
    if (unit.unitType === OVERLORD) {
      const unitCommand = {
        abilityId: MOVE,
        targetWorldSpacePos: getRandomPoint(world.resources.get().map),
        unitTags: [ unit.tag ],
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }
}

function getRandomPoint(map) {
  return {
    x: Math.floor(Math.random() * Math.floor(map._mapSize.x)),
    y: Math.floor(Math.random() * Math.floor(map._mapSize.y)),
  };
}