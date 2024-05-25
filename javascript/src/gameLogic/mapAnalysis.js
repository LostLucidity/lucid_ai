const { Race } = require('@node-sc2/core/constants/enums');

const { calculateAdjacentToRampGrids } = require('./pathfinding');
const BuildingPlacement = require('../features/construction/buildingPlacement');

/**
 * Performs initial map analysis based on the bot's race.
 * This includes calculating grid positions adjacent to ramps and determining wall-off positions.
 * 
 * @param {World} world - The game world context.
 * @param {SC2APIProtocol.Race} botRace - The race of the bot, used to determine specific actions like wall-off positions for Terran.
 */
function performInitialMapAnalysis(world, botRace) {
  // This function should only calculate data and return it if necessary
  if (botRace === Race.TERRAN) {
    const map = world.resources.get().map;
    // Possibly return calculated positions or other relevant data
    return {
      rampGrids: calculateAdjacentToRampGrids(map),
      wallOffPositions: BuildingPlacement.calculateWallOffPositions(world)
    };
  }
  return null; // Return null or appropriate value if no analysis is performed
}

module.exports = { performInitialMapAnalysis };
