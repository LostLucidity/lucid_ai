//@ts-check
"use strict"

/**
 * Placement Service
 * Contains functions related to unit and building placements, 
 * map interactions, and related utilities.
 */

const groupTypes = require("@node-sc2/core/constants/groups");
const { flyingTypesMapping, addOnTypesMapping } = require("../../../helper/groups");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { isPlaceableAtGasGeyser } = require("../../../systems/map-resource-system/map-resource-service");
const { Race } = require("@node-sc2/core/constants/enums");
const { UnitType } = require("@node-sc2/core/constants");
const getRandom = require("@node-sc2/core/utils/get-random");
const planService = require("../../../services/plan-service");
const { keepPosition, getBuildingFootprintOfOrphanAddons } = require("../../../services/placement-service");
const unitService = require("../../../services/unit-service");
const MapResourceService = require("../../../systems/map-resource-system/map-resource-service");
const { getTimeInSeconds } = require("../../../services/frames-service");
const { getCandidatePositions } = require("../../../helper/placement/placement-helper");
const { getOccupiedExpansions, getAvailableExpansions, getNextSafeExpansions } = require("../../../helper/expansions");
const { getDistance, dbscan } = require("../../../services/position-service");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { existsInMap } = require("../../../helper/location");
const wallOffNaturalService = require("../../../systems/wall-off-natural/wall-off-natural-service");
const { pointsOverlap } = require("../../../helper/utilities");
const { getAddOnPlacement, getAddOnBuildingPlacement } = require("../../../helper/placement/placement-utilities");
const { findWallOffPlacement } = require("../../../systems/wall-off-ramp/wall-off-ramp-service");
const wallOffRampService = require("../../../systems/wall-off-ramp/wall-off-ramp-service");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const expansionManagementService = require("../expansion-management/expansion-management-service");
const { getClosestPosition } = require("../../../helper/get-closest");
const { canUnitBuildAddOn } = require("../utility-service");
const { getCurrentlyEnrouteConstructionGrids } = require("../../shared-utilities/construction-utils");
const unitRetrievalService = require("../unit-retrieval");

class PlacementService {
  /**
   * Determines a valid position for placing a building.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @returns {false | Point2D}
   */
  static determineBuildingPosition(world, unitType, candidatePositions) {
    let position = planService.buildingPosition;
    const validPosition = position && keepPosition(world, unitType, position);

    if (!validPosition) {
      if (candidatePositions.length === 0) {
        candidatePositions = this.findPlacements(world, unitType);
      }
      position = PlacementService.findPosition(world, unitType, candidatePositions);
      if (!position) {
        candidatePositions = this.findPlacements(world, unitType);
        position = PlacementService.findPosition(world, unitType, candidatePositions);
      }
      planService.setBuildingPosition(unitType, position);
    }

    return position || false;
  }

  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  static findPlacements(world, unitType) {
    const { getBuildTimeLeft } = unitService;
    const { BARRACKS, ENGINEERINGBAY, FORGE, PYLON, REACTOR, STARPORT, SUPPLYDEPOT, TECHLAB } = UnitType;
    const { gasMineTypes } = groupTypes;
    const { agent, data, resources } = world;
    const { race } = agent;
    const { map, units } = resources.get();
    const [main, natural] = map.getExpansions(); if (main === undefined || natural === undefined) { return []; }
    const mainMineralLine = main.areas.mineralLine;
    if (gasMineTypes.includes(unitType)) {
      const geyserPositions = MapResourceService.getFreeGasGeysers(map).map(geyser => {
        const { pos } = geyser;
        if (pos === undefined) return { pos, buildProgress: 0 };
        const [closestBase] = units.getClosest(pos, units.getBases());
        return { pos, buildProgress: closestBase.buildProgress };
      });
      const sortedGeyserPositions = geyserPositions
        .filter(geyser => {
          const { pos, buildProgress } = geyser; if (pos === undefined || buildProgress === undefined) return false;
          const [closestBase] = units.getClosest(pos, units.getBases()); if (closestBase === undefined) return false;
          const { unitType: baseType } = closestBase; if (baseType === undefined) return false;
          const { buildTime } = data.getUnitTypeData(baseType); if (buildTime === undefined) return false;
          const timeLeft = getBuildTimeLeft(closestBase, buildTime, buildProgress);
          const { buildTime: geyserBuildTime } = data.getUnitTypeData(unitType); if (geyserBuildTime === undefined) return false;
          return getTimeInSeconds(timeLeft) <= getTimeInSeconds(geyserBuildTime);
        }).sort((a, b) => {
          const { buildProgress: aBuildProgress, pos: aPos } = a;
          const { buildProgress: bBuildProgress, pos: bPos } = b;
          if (aBuildProgress === undefined || bBuildProgress === undefined || aPos === undefined || bPos === undefined) return 0;
          // @ts-ignore
          const [baseA] = units.getClosest(a, units.getBases());
          // @ts-ignore
          const [baseB] = units.getClosest(b, units.getBases());
          const { buildProgress: buildProgressA } = baseA;
          const { buildProgress: buildProgressB } = baseB;
          if (buildProgressA === undefined || buildProgressB === undefined) { return 0; }
          return buildProgressA - buildProgressB;
        });
      const [topGeyserPosition] = sortedGeyserPositions;
      if (topGeyserPosition) {
        const { buildProgress } = topGeyserPosition;
        if (buildProgress === undefined) { return []; }
        const sortedGeyserPositionsWithSameBuildProgress = sortedGeyserPositions.filter(geyserPosition => geyserPosition.buildProgress === buildProgress);
        // @ts-ignore
        return sortedGeyserPositionsWithSameBuildProgress.map(geyserPosition => geyserPosition.pos);
      } else {
        return [];
      }
    }
    /**
     * @type {Point2D[]}
     */
    let placements = [];
    if (race === Race.PROTOSS) {
      if (unitType === PYLON) {
        if (unitRetrievalService.getUnitTypeCount(world, unitType) === 0) {
          if (planService.naturalWallPylon) {
            return getCandidatePositions(resources, 'NaturalWallPylon', unitType);
          }
        }
        const occupiedExpansions = getOccupiedExpansions(resources);
        const occupiedExpansionsPlacementGrid = [...occupiedExpansions.map(expansion => expansion.areas.placementGrid)];
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(...grid));
        placements = placementGrids
          .filter((point) => {
            return (
              (getDistance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => getDistance(mlp, point) > 1.5)) &&
              (natural.areas.hull.every(hp => getDistance(hp, point) > 3)) &&
              (units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => getDistance(eb, point) > 3))
            );
          });
      } else {
        let pylonsNearProduction;
        if (units.getById(PYLON).length === 1) {
          pylonsNearProduction = units.getById(PYLON);
        } else {
          pylonsNearProduction = units.getById(PYLON)
            .filter(u => u.buildProgress >= 1)
            .filter(pylon => getDistance(pylon.pos, main.townhallPosition) < 50);
        }
        pylonsNearProduction.forEach(pylon => {
          placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true }).filter(grid => existsInMap(map, grid) && getDistance(grid, pylon.pos) < 6.5));
        });
        const wallOffPositions = [];
        let { threeByThreePositions } = wallOffNaturalService;
        const currentlyEnrouteConstructionGrids = getCurrentlyEnrouteConstructionGrids(world);
        // from the Map object planService.buildingPositions, get buildingPositions values
        /** @type {Point2D[]} */ // @ts-ignore
        const buildingPositions = Array.from(planService.buildingPositions.values()).filter(position => position !== false);
        const threeByThreeFootprint = getFootprint(FORGE); if (threeByThreeFootprint === undefined) return [];
        threeByThreePositions = threeByThreePositions.filter(position => !pointsOverlap([...currentlyEnrouteConstructionGrids, ...buildingPositions], cellsInFootprint(position, threeByThreeFootprint)));
        if (threeByThreePositions.length > 0) {
          const threeByThreeCellsInFootprints = threeByThreePositions.map(position => cellsInFootprint(position, threeByThreeFootprint));
          wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, cellsInFootprint(position, threeByThreeFootprint))));
          const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
          if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
            const canPlace = getRandom(threeByThreePositions.filter(pos => map.isPlaceableAt(unitType, pos)));
            if (canPlace) {
              return [canPlace];
            }
          }
        }
        const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
        placements = placements.filter(grid => {
          const cells = [...cellsInFootprint(grid, unitTypeFootprint)];
          return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions]);
        }).map(pos => ({ pos, rand: Math.random() }))
          .sort((a, b) => a.rand - b.rand)
          .map(a => a.pos)
          .slice(0, 20);
        return placements;

      }
    } else if (race === Race.TERRAN) {
      const placementGrids = [];
      const orphanAddons = units.getById([REACTOR, TECHLAB]);

      const buildingFootprints = Array.from(planService.buildingPositions.entries()).reduce((/** @type {Point2D[]} */positions, [step, buildingPos]) => {
        if (buildingPos === false) return positions;
        const stepData = planService.plan[step] ?
          planService.plan[step] :
          planService.convertLegacyPlan(planService.legacyPlan)[step];

        const stepUnitType = (stepData && stepData[2]) ? stepData[2] : undefined;

        if (unitType === undefined) return positions;

        const footprint = getFootprint(stepUnitType); if (footprint === undefined) return positions;
        const newPositions = cellsInFootprint(buildingPos, footprint);
        if (canUnitBuildAddOn(stepUnitType)) {
          const addonFootprint = getFootprint(REACTOR); if (addonFootprint === undefined) return positions;
          const addonPositions = cellsInFootprint(getAddOnPlacement(buildingPos), addonFootprint);
          return [...positions, ...newPositions, ...addonPositions];
        }
        return [...positions, ...newPositions];
      }, []);

      const orphanAddonPositions = orphanAddons.reduce((/** @type {Point2D[]} */positions, addon) => {
        const { pos } = addon; if (pos === undefined) return positions;
        const newPositions = getAddOnBuildingPlacement(pos);
        const footprint = getFootprint(addon.unitType); if (footprint === undefined) return positions;
        const cells = cellsInFootprint(newPositions, footprint);
        if (cells.length === 0) return positions;
        return [...positions, ...cells];
      }, []);

      const wallOffPositions = findWallOffPlacement(unitType).slice();
      if (wallOffPositions.filter(position => map.isPlaceableAt(unitType, position)).length > 0) {
        // Check if the structure is one that cannot use an orphan add-on
        if (!canUnitBuildAddOn(unitType)) {
          // Exclude positions that are suitable for orphan add-ons and inside existing footprints
          const filteredWallOffPositions = wallOffPositions.filter(position =>
            !orphanAddonPositions.some(orphanPosition => getDistance(orphanPosition, position) < 1) &&
            !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
          );
          // If there are any positions left, use them
          if (filteredWallOffPositions.length > 0) {
            return filteredWallOffPositions;
          }
        }
        // If the structure can use an orphan add-on, use all wall-off positions
        if (wallOffPositions.length > 0) {
          // Filter out positions already taken by buildings
          const newWallOffPositions = wallOffPositions.filter(position =>
            !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
          );
          if (newWallOffPositions.length > 0) {
            return newWallOffPositions;
          }
        }
      }

      getOccupiedExpansions(world.resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      const { addOnPositions, twoByTwoPositions, threeByThreePositions } = wallOffRampService;
      if (addOnPositions.length > 0) {
        const barracksFootprint = getFootprint(BARRACKS);
        if (barracksFootprint === undefined) return [];
        const barracksCellInFootprints = addOnPositions.map(position => cellsInFootprint(createPoint2D(position), barracksFootprint));
        wallOffPositions.push(...barracksCellInFootprints.flat());
      }
      if (twoByTwoPositions.length > 0) {
        const supplyFootprint = getFootprint(SUPPLYDEPOT);
        if (supplyFootprint === undefined) return [];
        const supplyCellInFootprints = twoByTwoPositions.map(position => cellsInFootprint(position, supplyFootprint));
        wallOffPositions.push(...supplyCellInFootprints.flat());
      }
      if (threeByThreePositions.length > 0) {
        const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
        if (engineeringBayFootprint === undefined) return [];
        const engineeringBayCellInFootprints = threeByThreePositions.map(position => cellsInFootprint(position, engineeringBayFootprint));
        wallOffPositions.push(...engineeringBayCellInFootprints.flat());
      }
      const unitTypeFootprint = getFootprint(unitType);
      let addonFootprint;
      if (addOnTypesMapping.has(unitType)) {
        addonFootprint = getFootprint(REACTOR); if (addonFootprint === undefined) return [];
      }
      if (unitTypeFootprint === undefined) return [];
      // Get all existing barracks and starports
      const barracks = units.getById(BARRACKS);
      const starports = units.getById(STARPORT);
      const barracksPositions = barracks.map(b => b.pos);
      const buildingFootprintOfOrphanAddons = getBuildingFootprintOfOrphanAddons(units);

      placements = placementGrids.filter(grid => {
        const cells = [...cellsInFootprint(grid, unitTypeFootprint)];

        // Check if the unit is a STARPORT and there's a nearby BARRACKS, and it's the first STARPORT
        if (unitType === STARPORT && starports.length === 0) {
          // If there is no nearby BARRACKS within 23.6 units, return false to filter out this grid
          if (!barracksPositions.some(bPos => bPos && getDistance(bPos, grid) <= 23.6)) {
            return false;
          }
        }

        if (addonFootprint) {
          cells.push(...cellsInFootprint(getAddOnPlacement(grid), addonFootprint));
        }

        return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions, ...buildingFootprintOfOrphanAddons, ...orphanAddonPositions]);
      }).map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements.push(...findZergPlacements(world, unitType))
    }
    return placements;
  }  

  /**
   * Determines a valid position for a given unit type.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @returns {false | Point2D}
   */
  static findPosition(world, unitType, candidatePositions) {
    const { gasMineTypes } = groupTypes;
    if (candidatePositions.length === 0) {
      candidatePositions = this.findPlacements(world, unitType);
    }
    const { agent, resources } = world;
    const { map } = resources.get();
    if (flyingTypesMapping.has(unitType)) {
      const baseUnitType = flyingTypesMapping.get(unitType);
      unitType = baseUnitType === undefined ? unitType : baseUnitType;
    }
    candidatePositions = candidatePositions.filter(position => {
      const footprint = getFootprint(unitType); if (footprint === undefined) return false;
      const unitTypeCells = cellsInFootprint(position, footprint);
      if (gasMineTypes.includes(unitType)) return isPlaceableAtGasGeyser(map, unitType, position);
      const isPlaceable = unitTypeCells.every(cell => {
        const isPlaceable = map.isPlaceable(cell);
        const needsCreep = agent.race === Race.ZERG && unitType !== UnitType.HATCHERY;
        const hasCreep = map.hasCreep(cell);
        return isPlaceable && (!needsCreep || hasCreep);
      });
      return isPlaceable;
    });
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    let foundPosition = getRandom(randomPositions);
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);
    if (foundPosition) console.log(`Found position for ${unitTypeName}`, foundPosition);
    else console.log(`Could not find position for ${unitTypeName}`);
    return foundPosition;
  }
}

module.exports = PlacementService;

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findZergPlacements(world, unitType) {
  const { townhallTypes } = groupTypes;
  const { resources } = world;
  const { map, units } = resources.get();
  const candidatePositions = [];
  if (townhallTypes.includes(unitType)) {
    // Use the getter to fetch the available expansions (assuming you have a getter for it).
    let availableExpansions = expansionManagementService.getAvailableExpansions();

    // If the availableExpansions is empty, fetch them using getAvailableExpansions and then set them using the setter
    if (!availableExpansions || availableExpansions.length === 0) {
      availableExpansions = getAvailableExpansions(resources);
      expansionManagementService.setAvailableExpansions(availableExpansions);
    }

    // Now use the availableExpansions in the rest of your code
    candidatePositions.push(getNextSafeExpansions(world, availableExpansions)[0]);
  } else {
    const structures = units.getStructures();
    const mineralLinePoints = map.getExpansions().flatMap(expansion => expansion.areas && expansion.areas.mineralLine || []);
    /**
     * @param {Point2D} point
     * @returns {void}
     */
    const processPoint = (point) => {
      const point2D = createPoint2D(point);
      const [closestStructure] = units.getClosest(point2D, structures);
      if (closestStructure.pos && getDistance(point2D, closestStructure.pos) <= 12.5) {
        const [closestMineralLine] = getClosestPosition(point2D, mineralLinePoints);
        if (getDistance(point2D, closestMineralLine) > 1.5 && getDistance(point2D, closestStructure.pos) > 3) {
          candidatePositions.push(point2D);
        }
      }
    };
    if (unitType !== UnitType.NYDUSCANAL) {
      const creepClusters = dbscan(map.getCreep());
      creepClusters.forEach(processPoint);
    } else {
      map.getVisibility().forEach(processPoint);
    }
  }
  return candidatePositions;
}