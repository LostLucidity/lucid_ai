//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");

/**
 * @param {ResourceManager} resources
 * @param {any} state
 * @returns {Unit[]}
 * @description Collects all enemy units within 16 range of structures.
 */
function threats(resources, state) {
  const { units } = resources.get();
  const positionsOfStructures = units.getStructures().map(structure => structure.pos);
  const enemyPush = [];
  const threats = new Set();
  // check if structure in natural
  positionsOfStructures.forEach(position => {
    if (position === undefined) { return; }
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const inRange = enemyUnits.filter(unit => unit.pos &&  distance(unit.pos, position) < 16);
    const enemyCount = inRange.length;
    if (enemyCount > 0) {
      enemyPush.push(true);
    } else {
      enemyPush.push(false);
    }
    inRange.forEach(unit => threats.add(unit));
  });
  if (enemyPush.some(c => c)) {
    state.defenseMode = true;
  } else {
    state.defenseMode = false;
  }
  return Array.from(threats);
}

module.exports = threats;