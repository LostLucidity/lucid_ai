//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");

function threats(resources, state) {
  const { units } = resources.get();
  const positionsOfStructures = units.getStructures().map(structure => structure.pos);
  const enemyPush = [];
  const threats = [];
  // check if structure in natural
  positionsOfStructures.forEach(position => {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const inRange = enemyUnits.filter(unit => distance(unit.pos, position) < 16);
    const enemyCount = inRange.length;
    if (enemyCount > 0) {
      enemyPush.push(true);
    } else {
      enemyPush.push(false);
    }
    threats.push(...inRange);
  });
  if (enemyPush.some(c => c)) {
    state.defenseMode = true;
  } else {
    state.defenseMode = false;
  }
  return threats;
}

module.exports = threats;