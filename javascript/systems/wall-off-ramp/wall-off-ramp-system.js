//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { distance, getNeighbors, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../helper/get-closest");
const wallOffRampService = require("./wall-off-ramp-service");
const { intersectionOfPoints } = require("../../helper/utilities");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { BARRACKS, SUPPLYDEPOT, ENGINEERINGBAY } = require("@node-sc2/core/constants/unit-type");
const { getAddOnPlacement, isBuildingAndAddonPlaceable, getAddOnBuildingPlacement, getBuildingAndAddonGrids } = require("../../helper/placement/placement-utilities");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const pathService = require("../../services/path-service");

module.exports = createSystem({
  name: 'WallOffRamp',
  type: 'agent',
  async onGameStart({ resources }) {
  // async onStep({ resources }) {
    const { debug, map } = resources.get();
    debug.setDrawCells('rmps', map._ramps.map(r => ({ pos: r })), { size: 1, cube: true });
    const main = map.getMain(); if (main === undefined) return;
    const { areas } = main;
    const { pathFromMain } = map.getNatural();
    if (pathFromMain === undefined) return;
    const pathFromMainToNatural = pathService.getPathCoordinates(pathFromMain);
    wallOffRampService.adjacentToRampGrids = areas.placementGrid.filter(grid => {
      const adjacentGrids = getNeighbors(grid);
      const isAdjacent = adjacentGrids.some(adjacentGrid => map.isRamp(adjacentGrid));
      const isOnPath = pathFromMainToNatural.some(pathGrid => distance(pathGrid, grid) <= 4);
      return isAdjacent && isOnPath;
    });
    debug.setDrawCells('adToRamp', wallOffRampService.adjacentToRampGrids.map(r => ({ pos: r })), { size: 1, cube: true });
    setWallOffRampPlacements(map);
  },
});

/**
 * @param {MapResource} map 
 * @returns {void}
 */
function setTwoByTwoPlacements(map) {
  const placeableGrids = wallOffRampService.adjacentToRampGrids.filter(grid => map.isPlaceable(grid));
  const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 1), placeableGrids).length === 2);
  cornerGrids.forEach(cornerGrid => {
    const cornerGridCircle = gridsInCircle(cornerGrid, 3);
    let closestPlaceableGrids = getClosestPosition(cornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
      return map.isPlaceableAt(SUPPLYDEPOT, grid);
    });
    const [closestRamp] = getClosestPosition(cornerGrid, cornerGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
      if (closestPlaceableToRamp) {
        wallOffRampService.twoByTwoPositions.push(closestPlaceableToRamp);
      }
    }
  });
}

/**
 * @param {MapResource} map 
 * @returns {void}
 */
function setThreeByThreePlacements(map) {
  setAddOnWallOffPosition(map);
  setThreeByThreePosition(map);
}

/**
 * @param {MapResource} map
 * @returns {void}
 */
function setAddOnWallOffPosition(map) {
  const { adjacentToRampGrids, twoByTwoPositions } = wallOffRampService;
  const middleOfAdjacentGrids = avgPoints(adjacentToRampGrids);
  const footprint = getFootprint(SUPPLYDEPOT);
  if (footprint === undefined) return;
  const twoByTwoPlacements = twoByTwoPositions.map(grid => cellsInFootprint(grid, footprint)).flat();
  const middleOfAdjacentGridCircle = gridsInCircle(middleOfAdjacentGrids, 3).filter(grid => ![...twoByTwoPlacements].some(placement => placement.x === grid.x && placement.y === grid.y));
  let closestPlaceableGrids = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle, middleOfAdjacentGridCircle.length).filter(grid => {
    return intersectionOfPoints(twoByTwoPlacements, getBuildingAndAddonGrids(grid, BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, BARRACKS, grid);
  });
  const [closestRamp] = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle.filter(grid => map.isRamp(grid)));
  if (closestRamp) {
    closestPlaceableGrids = closestPlaceableGrids.map(grid => {
      if (distance(grid, closestRamp) < distance(getAddOnPlacement(grid), closestRamp)) {
        return grid;
      } else {
        return getAddOnPlacement(grid);
      }
    });
    const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
    if (closestPlaceableToRamp) {
      let position = null;
      if (intersectionOfPoints(twoByTwoPositions, getBuildingAndAddonGrids(closestPlaceableToRamp, BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, BARRACKS, closestPlaceableToRamp)) {
        position = closestPlaceableToRamp;
      } else {
        position = getAddOnBuildingPlacement(closestPlaceableToRamp);
      }
      wallOffRampService.addOnPositions = [position];
    }
  }
}

/**
 * @param {MapResource} map
 * @returns {void}
 */
function setThreeByThreePosition(map) {
  const { adjacentToRampGrids, twoByTwoPositions } = wallOffRampService;
  const middleOfAdjacentGrids = avgPoints(adjacentToRampGrids);
  const footprint = getFootprint(SUPPLYDEPOT);
  if (footprint === undefined) return;
  const twoByTwoPlacements = twoByTwoPositions.map(grid => cellsInFootprint(grid, footprint)).flat();
  const middleOfAdjacentGridCircle = gridsInCircle(middleOfAdjacentGrids, 3).filter(grid => ![...twoByTwoPlacements].some(placement => placement.x === grid.x && placement.y === grid.y));
  let closestPlaceableGrids = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle, middleOfAdjacentGridCircle.length).filter(grid => {
    const footprint = getFootprint(ENGINEERINGBAY);
    if (footprint === undefined) return false;
    return intersectionOfPoints(twoByTwoPlacements, cellsInFootprint(grid, footprint)).length === 0 && map.isPlaceableAt(ENGINEERINGBAY, grid);
  });
  const [closestRamp] = getClosestPosition(middleOfAdjacentGrids, middleOfAdjacentGridCircle.filter(grid => map.isRamp(grid)));
  if (closestRamp) {
    const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
    if (closestPlaceableToRamp) {
      wallOffRampService.threeByThreePositions = [closestPlaceableToRamp];
    }
  }
}
/**
 * @param {MapResource} map
 * @returns {void}
 */
function setWallOffRampPlacements(map) {
  setTwoByTwoPlacements(map);
  setThreeByThreePlacements(map);
}

