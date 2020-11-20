//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");

function baseThreats(resources, state) {
  const { units } = resources.get();
  // check for enemy worker near townhall.
  const townhalls = units.getBases();
  const enemyPush = [];
  townhalls.forEach(async townhall => {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const ignoreTypes = [ ...workerTypes, OVERLORD ]
    const inRange = enemyUnits.filter(unit => ignoreTypes.includes(unit.unitType) === false && distance(unit.pos, townhall.pos) < 22);
    const enemyCount = inRange.length;
    if (enemyCount > 0) {
      enemyPush.push(true);
    } else {
      enemyPush.push(false);
    }
  });
  if (enemyPush.some(c => c)) {
    state.defenseMode = true;
  } else {
    state.defenseMode = false;
  }
}

module.exports = baseThreats;