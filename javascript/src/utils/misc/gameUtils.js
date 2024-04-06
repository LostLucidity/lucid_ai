// gameUtils.js
"use strict";

const GameState = require("../../core/gameState");
const { isCurrent } = require("../construction/resourceUtils");

/**
 * @param {ResourceManager} resources
 * @param {UnitTypeId[]} unitTypes
 * @returns {Unit[]}
 */
function getById(resources, unitTypes) {
  const { frame, units } = resources.get();
  const currentFrame = frame.getGameLoop();
  const gameState = GameState.getInstance();
  return unitTypes.reduce((/** @type {Unit[]} */ unitsById, unitType) => {
    if (!isCurrent(unitType, frame.getGameLoop())) {
      const newUnits = units.getById(unitType);
      gameState.unitsById.set(unitType, { units: newUnits, frame: currentFrame });
    }
    const entry = gameState.unitsById.get(unitType);
    return [...unitsById, ...(entry ? entry.units : [])];
  }, []);
}

// Export the shared functions
module.exports = {
  getById,
};
