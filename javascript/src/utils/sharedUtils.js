// src/utils/sharedUtils.js

const { GATEWAY, PYLON } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const BuildingPlacement = require("../features/construction/buildingPlacement");

/**
 * @param {Point2D[]} threeByThreePositions
 * @param {Point2D} point
 * @param {Debugger | undefined} [debug] - Optional debugger instance
 */
function setFoundPositions(threeByThreePositions, point, debug = undefined) {
  const threeByThreeGrid = getFootprint(GATEWAY);

  // Ensure threeByThreeGrid is defined before proceeding
  if (!threeByThreeGrid) {
    console.error('Failed to retrieve the footprint for GATEWAY.');
    return;
  }

  BuildingPlacement.threeByThreePositions = threeByThreePositions;
  BuildingPlacement.pylonPlacement = point;

  // Ensure debug is defined before using it
  if (debug) {
    const pylonFootprint = getFootprint(PYLON);
    if (pylonFootprint) {
      debug.setDrawCells('pylon', cellsInFootprint(point, pylonFootprint).map(r => ({ pos: r })), { size: 1, cube: false });
      console.log('pylon placement', point);
      BuildingPlacement.threeByThreePositions.forEach((position, index) => {
        debug.setDrawCells(`wlOfPs${index}`, cellsInFootprint(position, threeByThreeGrid).map(r => ({ pos: r })), { size: 1, cube: false });
      });
    } else {
      console.error('Failed to retrieve the footprint for PYLON.');
    }
  }
}

module.exports = {
  setFoundPositions
};
