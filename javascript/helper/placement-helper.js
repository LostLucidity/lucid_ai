//@ts-check
"use strict"

const { distance, add } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { UnitType } = require('@node-sc2/core/constants');
const { flyingTypesMapping } = require('./groups');
const { PYLON } = require('@node-sc2/core/constants/unit-type');
const { getOccupiedExpansions } = require('./expansions');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { getClosestPosition } = require('./get-closest');
const planService = require('../services/plan-service');

module.exports = {
  findPosition: async (actions, unitType, candidatePositions) => {
    if (flyingTypesMapping.has(unitType)) { unitType = flyingTypesMapping.get(unitType); }
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    const foundPosition = await actions.canPlace(unitType, randomPositions);
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);
    if (foundPosition && unitTypeName) {
      console.log(`FoundPosition for ${unitTypeName}`, foundPosition);
    }
    return foundPosition;
  },
  findPlacements: async (world, unitType) => {
    const { agent, resources } = world;
    const { race } = agent;
    const { actions, map, units } = resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
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
          placements.push(...gridsInCircle(pylon.pos, 6.5));
        })
        placements = placements.filter((point) => {
          return (
            (distance(natural.townhallPosition, point) > 5) &&
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (natural.areas.hull.every(hp => distance(hp, point) > 2)) &&
            (units.getStructures({ alliance: Alliance.SELF })
              .map(u => u.pos)
              .every(eb => distance(eb, point) > 3))
          );
        });
      }
    } else if (race === Race.TERRAN) {
      const placementGrids = [];
      const wallOffUnitTypes = [SUPPLYDEPOT, BARRACKS];
      if (planService.wallOff && wallOffUnitTypes.includes(unitType)) {
        const wallOffPositions = findWallOffPlacement(map, unitType);
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
  findSupplyPositions: (resources) => {
    const { map } = resources.get();
    const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
    // front of natural pylon for great justice
    const naturalWall = map.getNatural().getWall();
    let possiblePlacements = frontOfGrid(resources, map.getNatural().areas.areaFill)
        .filter(point => naturalWall.every(wallCell => (
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 3)
        )));
  
    if (possiblePlacements.length <= 0) {
        possiblePlacements = frontOfGrid(resources, map.getNatural().areas.areaFill)
            .map(point => {
                point.coverage = naturalWall.filter(wallCell => (
                    (distance(wallCell, point) <= 6.5) &&
                    (distance(wallCell, point) >= 1)
                )).length;
                return point;
            })
            .sort((a, b) => b.coverage - a.coverage)
            .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
    }
  
    return possiblePlacements;
  },
  getAddOnBuildingPosition: (position) => {
    return { x: position.x - 2.5, y: position.y + 0.5 }
  },
  getAddOnPosition: (position) => {
    return { x: position.x + 2.5, y: position.y - 0.5 }
  },
  getBetweenBaseAndWall: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const pathCandidates = map.path(add(map.getNatural().townhallPosition, 3), add(map.getEnemyMain().townhallPosition, 3)).slice(0, 10).map(pathItem => ({ 'x': pathItem[0], 'y': pathItem[1] }));
    return [ await actions.canPlace(unitType, pathCandidates) ];
  },
  inTheMain: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const candidatePositions = map.getMain().areas.areaFill
    return [ await actions.canPlace(unitType, candidatePositions) ];
  }
}