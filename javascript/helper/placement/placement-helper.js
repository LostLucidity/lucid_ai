//@ts-check
"use strict"

const { distance, avgPoints, getNeighbors, closestPoint } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { UnitType } = require('@node-sc2/core/constants');
const { flyingTypesMapping, countTypes } = require('../groups');
const { PYLON, SUPPLYDEPOT, BARRACKS, GATEWAY, CYBERNETICSCORE } = require('@node-sc2/core/constants/unit-type');
const { getOccupiedExpansions } = require('../expansions');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { getClosestPosition } = require('../get-closest');
const { findWallOffPlacement } = require('../../systems/wall-off-ramp/wall-off-ramp-service');
const getRandom = require('@node-sc2/core/utils/get-random');
const { existsInMap } = require('../location');
const wallOffNaturalService = require('../../systems/wall-off-natural/wall-off-natural-service');
const { intersectionOfPoints, pointsOverlap } = require('../utilities');
const { getThirdWallPosition } = require('../../systems/unit-resource/unit-resource-service');

const placementHelper = {
  findMineralLines: (resources) => {
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
  findPosition: async (resources, unitType, candidatePositions) => {
    const { actions, map, units } = resources.get();
    if (flyingTypesMapping.has(unitType)) { unitType = flyingTypesMapping.get(unitType); }
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    let foundPosition = await actions.canPlace(unitType, randomPositions);
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);
    if (!foundPosition) {
      const [pylon] = units.getById(PYLON);
      if (pylon && pylon.buildProgress < 1) {
        foundPosition = getRandom(candidatePositions.filter(position => map.isPlaceableAt(unitType, position)));
      }
    }
    if (foundPosition) console.log(`FoundPosition for ${unitTypeName}`, foundPosition);
    else console.log(`Could not find position for ${unitTypeName}`);
    return foundPosition;
  },
  /**
   * 
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {Promise<Point2D[]>}
   */
  findPlacements: async (world, unitType) => {
    const { agent, resources } = world;
    const { race } = agent;
    const { actions, map, units } = resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    /**
     * @type {Point2D[]}
     */
    let placements = [];
    if (race === Race.PROTOSS) {
      if (unitType === PYLON) {
        const occupiedExpansions = getOccupiedExpansions(resources);
        const occupiedExpansionsPlacementGrid = [...occupiedExpansions.map(expansion => expansion.areas.placementGrid)];
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(...grid));
        placements = placementGrids
          .filter((point) => {
            return (
              (distance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
              (natural.areas.hull.every(hp => distance(hp, point) > 3)) &&
              (units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => distance(eb, point) > 3))
            );
          });
      } else {
        let pylonsNearProduction;
        if (units.getById(PYLON).length === 1) {
          pylonsNearProduction = units.getById(PYLON);
        } else {
          pylonsNearProduction = units.getById(PYLON)
            .filter(u => u.buildProgress >= 1)
            .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);
        }
        pylonsNearProduction.forEach(pylon => {
          placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true }).filter(grid => existsInMap(map, grid)));
        });
        const wallOffUnitTypes = [...countTypes.get(GATEWAY), CYBERNETICSCORE];
        /**
         * @type {Point2D[]}
         */
        const wallOffPositions = [];
        if (wallOffUnitTypes.includes(unitType) && units.getById(wallOffUnitTypes).length < 3) {
          const placeablePositions = wallOffNaturalService.threeByThreePositions.filter(position => map.isPlaceableAt(unitType, position) && pointsOverlap([position], placements));
          if (placeablePositions.length > 0) {
            wallOffPositions.push(...placeablePositions);
          } else {
            if (wallOffNaturalService.wall.length > 0) {
              const cornerGrids = wallOffNaturalService.wall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), wallOffNaturalService.wall).length === 1);
              const wallRadius = distance(cornerGrids[0], cornerGrids[1]) / 2;
              wallOffPositions.push(...gridsInCircle(avgPoints(wallOffNaturalService.wall), wallRadius, { normalize: true }).filter(grid => {
                let existsAndPlaceable = existsInMap(map, grid) && map.isPlaceable(grid);
                if (units.getById(wallOffUnitTypes).length === 2) {
                  const foundThirdWallPosition = getThirdWallPosition(units.getById(wallOffUnitTypes), grid, unitType);
                  return existsAndPlaceable && foundThirdWallPosition;
                } else {
                  return existsAndPlaceable;
                }
              }));
            }
          }
        }
        if (wallOffPositions.length > 0 && wallOffPositions.some(position => map.isPlaceableAt(unitType, position))) {
          placements = intersectionOfPoints(wallOffPositions, placements);
        }
        placements = placements.filter((point) => {
          return (
            (distance(natural.townhallPosition, point) > 5) &&
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (wallOffPositions.length > 0 || (natural.areas.hull.every(hp => distance(hp, point) > 2))) &&
            map.isPlaceableAt(unitType, point)
          );
        });
      }
    } else if (race === Race.TERRAN) {
      const placementGrids = [];
      const wallOffUnitTypes = [SUPPLYDEPOT, BARRACKS];
      if (wallOffUnitTypes.includes(unitType)) {
        const wallOffPositions = findWallOffPlacement(unitType);
        if (wallOffPositions.length > 0 && await actions.canPlace(unitType, wallOffPositions)) {
          return wallOffPositions;
        }
      }
      getOccupiedExpansions(world.resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      placements = placementGrids
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements = map.getCreep()
        .filter((point) => {
          const [closestMineralLine] = getClosestPosition(point, mainMineralLine);
          const [closestStructure] = units.getClosest(point, units.getStructures());
          const [closestTownhallPosition] = getClosestPosition(point, map.getExpansions().map(expansion => expansion.townhallPosition));
          return (
            distance(point, closestMineralLine) > 1.5 &&
            distance(point, closestStructure.pos) > 3 &&
            distance(point, closestStructure.pos) <= 12.5 &&
            distance(point, closestTownhallPosition) > 3
          );
        });
    }
    return placements;
  },
  /**
   * @param {ResourceManager} resources 
   * @returns {Point2D[]}
   */
  findSupplyPositions: (resources) => {
    const { map } = resources.get();
    // front of natural pylon for great justice
    let possiblePlacements = [];
    const naturalWall = wallOffNaturalService.wall.length > 0 ? wallOffNaturalService.wall : map.getNatural().getWall();
    if (naturalWall) {
      const naturalTownhallPosition = map.getNatural().townhallPosition;
      possiblePlacements = frontOfGrid(resources, map.getNatural().areas.areaFill)
        .filter(point => naturalWall.every(wallCell => (
          (distance(naturalTownhallPosition, point) > 4.5) &&
          (distance(wallCell, point) <= 6.5) &&
          (distance(wallCell, point) >= 3) &&
          distance(wallCell, naturalTownhallPosition) > distance(point, naturalTownhallPosition)
        )));

      if (possiblePlacements.length <= 0) {
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
          .filter((cell, i, arr) => cell['coverage'] === arr[0]['coverage']);
      }
    }
    return possiblePlacements;
  },
  getCandidatePositions: async (resources, positions, unitType) => {
    return typeof positions === 'string' ? await placementHelper[positions](resources, unitType) : positions
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
      return placementHelper.getPlaceableAtPositions(expandedCandidates, map, unitType);
    } else {
      return filteredCandidates;
    }
  },
  inTheMain: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const candidatePositions = map.getMain().areas.areaFill
    return [await actions.canPlace(unitType, candidatePositions)];
  }
}

module.exports = placementHelper;