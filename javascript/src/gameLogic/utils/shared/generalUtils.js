const { GameState } = require("../../../gameState");

/**
 * Check if the frame stored in the map matches the current frame
 * @param {number} unitType 
 * @param {number} currentFrame 
 * @returns {boolean}
 */
function isCurrent(unitType, currentFrame) {
  const gameState = GameState.getInstance();
  const entry = gameState.unitsById.get(unitType);
  return entry ? entry.frame === currentFrame : false;
}


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

module.exports = {
  getById,
};