//@ts-check
"use strict"

const { distance, avgPoints, getNeighbors } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { getClosestPosition } = require('../get-closest');
const wallOffNaturalService = require('../../systems/wall-off-natural/wall-off-natural-service');

const placementHelper = {
  getMineralLines: (resources) => {
    const { map, units } = resources.get();
    const occupiedExpansions = map.getOccupiedExpansions()
    const mineralLineCandidates = [];
    occupiedExpansions.forEach(expansion => {
      const [base] = units.getClosest(expansion.townhallPosition, units.getBases());
      if (base) {
        mineralLineCandidates.push(...gridsInCircle(avgPoints([...expansion.cluster.mineralFields.map(field => field.pos), base.pos, base.pos]), 0.6))
      }
    });
    return mineralLineCandidates;
  },
  /**
   *
   * @param {ResourceManager} resources
   * @param {Point2D[]|string} positions
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  getCandidatePositions: (resources, positions, unitType = null) => {
    return typeof positions === 'string' ? placementHelper[`get${positions}`](resources, unitType) : positions
  },
  /**
   * @param {ResourceManager} resources 
   */
  getByMainRamp: async (resources) => {
    const { map } = resources.get();
    // get pathable main area within 8 distance of ramp
    const getMainPositionsByRamp = map.getMain().areas.areaFill.filter(point => {
      return getNeighbors(point).some(neighbor => map.isRamp(neighbor));
    });
    const pathableMainAreas = map.getMain().areas.areaFill.filter(point => map.isPathable(point) && distance(avgPoints(getMainPositionsByRamp), point) <= 8);
    return pathableMainAreas;
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @param {UnitTypeId} unitType 
   * @returns {Promise<false[] | Point2D[]>}
   */
  getMiddleOfNaturalWall: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const naturalWall = map.getNatural().getWall() || wallOffNaturalService.wall;
    let candidates = [];
    if (naturalWall) {
      const wallPositions = placementHelper.getPlaceableAtPositions(naturalWall, map, unitType);
      const middleOfWall = getClosestPosition(avgPoints(wallPositions), wallPositions, 2);
      candidates = [await actions.canPlace(unitType, middleOfWall)];
    }
    return candidates;
  },
  /**
   * @param {ResourceManager} resources
   * @returns {Point2D[]}
   */
  getNaturalWallPylon: (resources) => {
    const { map } = resources.get();
    // front of natural pylon for great justice
    let possiblePlacements = wallOffNaturalService.pylonPlacement ? [wallOffNaturalService.pylonPlacement] : [];
    const naturalWall = wallOffNaturalService.wall.length > 0 ? wallOffNaturalService.wall : map.getNatural().getWall();
    if (naturalWall) {
      const naturalTownhallPosition = map.getNatural().townhallPosition;
      possiblePlacements = wallOffNaturalService.pylonPlacement ? [wallOffNaturalService.pylonPlacement] : [];
      if (possiblePlacements.length === 0) {
        possiblePlacements = frontOfGrid(resources, map.getNatural().areas.areaFill)
          .filter(point => naturalWall.every(wallCell => (
            (distance(naturalTownhallPosition, point) > 4.5) &&
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 3) &&
            distance(wallCell, naturalTownhallPosition) > distance(point, naturalTownhallPosition)
          )));
      }
      if (possiblePlacements.length === 0) {
        possiblePlacements = frontOfGrid(resources, map.getNatural().areas.areaFill)
          .map(point => {
            point['coverage'] = naturalWall.filter(wallCell => (
              (distance(wallCell, point) <= 6.5) &&
              (distance(wallCell, point) >= 1) &&
              distance(wallCell, naturalTownhallPosition) > distance(point, naturalTownhallPosition)
            )).length;
            return point;
          })
          .sort((a, b) => b['coverage'] - a['coverage'])
          .filter((cell, i, arr) => cell['coverage'] === arr[0]['coverage'])
      }
    }
    return possiblePlacements;
  },
  /**
   * @param {Point2D[]} candidates
   * @param {MapResource} map
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  getPlaceableAtPositions: (candidates, map, unitType) => {
    const filteredCandidates = candidates.filter(wallPosition => map.isPlaceableAt(unitType, wallPosition));
    if (filteredCandidates.length === 0) {
      /** @type {Point2D[]} */
      let expandedCandidates = [];
      candidates.forEach(candidate => {
        expandedCandidates.push(candidate, ...getNeighbors(candidate));
        expandedCandidates = expandedCandidates.filter((candidate, index, self) => {
          return self.findIndex(selfCandidate => selfCandidate.x === candidate.x && selfCandidate.y === candidate.y) === index;
        });
      });
      if (expandedCandidates.length > 0) {
        return placementHelper.getPlaceableAtPositions(expandedCandidates, map, unitType);
      } else {
        return [];
      }
    } else {
      return filteredCandidates;
    }
  },
  getInTheMain: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const candidatePositions = map.getMain().areas.placementGrid.filter(grid => map.isPlaceableAt(unitType, grid));
    return [await actions.canPlace(unitType, candidatePositions)];
  }
}

module.exports = placementHelper;