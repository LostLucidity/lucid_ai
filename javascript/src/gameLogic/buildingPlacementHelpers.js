// buildingPlacementHelpers.js
const { UnitType } = require("@node-sc2/core/constants");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

const config = require("../../config/config");
const GameState = require("../core/gameState");
const { buildingPositions } = require("../core/gameStateResources");
const MapResources = require("../core/mapResources");
const BuildingPlacement = require("../features/construction/buildingPlacement");
const { getOccupiedExpansions, existsInMap, pointsOverlap, getAddOnPlacement, getAddOnBuildingPlacement, getBuildingFootprintOfOrphanAddons, findZergPlacements } = require("../utils/common/geometry");
const { getTimeInSeconds } = require("../utils/common/pathfindingUtils");
const { getBuildTimeLeft } = require("../utils/common/sharedUtils");
const { getDistance } = require("../utils/common/spatialUtils");
const { flyingTypesMapping, canUnitBuildAddOn, addOnTypesMapping } = require("../utils/common/unitConfig");
const { isPlaceableAtGasGeyser } = require("../utils/common/utils");
const { getCurrentlyEnrouteConstructionGrids } = require("../utils/gameLogic/constructionHelpers");

/**
 * @typedef {Object} FootprintType
 * @property {number} h - The height of the footprint.
 * @property {number} w - The width of the footprint.
 */

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findPlacements(world, unitType) {
  const { BARRACKS, ENGINEERINGBAY, FORGE, PYLON, REACTOR, STARPORT, SUPPLYDEPOT, TECHLAB } = UnitType;
  const { gasMineTypes } = groupTypes;
  const { agent, data, resources } = world;
  const { race } = agent;
  const { map, units, frame } = resources.get();
  const currentGameLoop = frame.getGameLoop();
  const [main, natural] = map.getExpansions();

  if (!main || !main.areas || !natural || !natural.areas) {
    return [];
  }

  const mainMineralLine = main.areas.mineralLine;

  if (gasMineTypes.includes(unitType)) {
    const geyserPositions = MapResources.getFreeGasGeysers(map, currentGameLoop).map(geyser => {
      const { pos } = geyser;
      if (pos === undefined) return { pos, buildProgress: 0 };
      const [closestBase] = units.getClosest(pos, units.getBases());
      return { pos, buildProgress: closestBase.buildProgress };
    });

    const sortedGeyserPositions = geyserPositions
      .filter(geyser => {
        const { pos, buildProgress } = geyser;
        if (pos === undefined || buildProgress === undefined) return false;
        const [closestBase] = units.getClosest(pos, units.getBases());
        if (closestBase === undefined) return false;
        const { unitType: baseType } = closestBase;
        if (baseType === undefined) return false;
        const { buildTime } = data.getUnitTypeData(baseType);
        if (buildTime === undefined) return false;
        const timeLeft = getBuildTimeLeft(closestBase, buildTime, buildProgress);
        const { buildTime: geyserBuildTime } = data.getUnitTypeData(unitType);
        if (geyserBuildTime === undefined) return false;
        return getTimeInSeconds(timeLeft) <= getTimeInSeconds(geyserBuildTime);
      })
      .sort((a, b) => {
        const buildProgressA = a.buildProgress !== undefined ? a.buildProgress : 0;
        const buildProgressB = b.buildProgress !== undefined ? b.buildProgress : 0;
        return buildProgressA - buildProgressB;
      });

    const [topGeyserPosition] = sortedGeyserPositions;
    if (topGeyserPosition && topGeyserPosition.pos) {
      return [topGeyserPosition.pos];
    } else {
      return []; // Return an empty array if no suitable position is found
    }
  }
  /**
   * @type {Point2D[]}
   */
  let placements = [];
  const gameState = GameState.getInstance();
  const currentPlan = gameState.plan;
  if (race === Race.PROTOSS) {
    if (unitType === PYLON) {
      if (gameState.getUnitTypeCount(world, unitType) === 0) {
        if (config.naturalWallPylon) {
          return BuildingPlacement.getCandidatePositions(resources, 'NaturalWallPylon', unitType);
        }
      }
      const occupiedExpansions = getOccupiedExpansions(resources);
      const occupiedExpansionsPlacementGrid = occupiedExpansions.reduce((/** @type {Point2D[]} */acc, expansion) => {
        if (expansion.areas !== undefined) {
          acc.push(...expansion.areas.placementGrid);
        }
        return acc;
      }, []);

      /** @type {Point2D[]} */
      const placementGrids = [];
      occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(grid));
      placements = placementGrids
        .filter((point) => {
          return (
            (getDistance(natural.townhallPosition, point) > 4.5) &&
            (mainMineralLine.every(mlp => getDistance(mlp, point) > 1.5)) &&
            (natural.areas?.hull.every(hp => getDistance(hp, point) > 3)) && // Safe access using optional chaining
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
          .filter(u => (u.buildProgress ?? 0) >= 1)
          .filter(pylon => getDistance(pylon.pos, main.townhallPosition) < 50);

      }
      pylonsNearProduction.forEach(pylon => {
        if (pylon.pos) {  // Check if pylon.pos is defined
          placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true })
            .filter(grid => existsInMap(map, grid) && getDistance(grid, pylon.pos) < 6.5));
        }
      });
      /** @type {Point2D[]} */
      const wallOffPositions = [];
      const currentlyEnrouteConstructionGrids = getCurrentlyEnrouteConstructionGrids(world);
      const threeByThreeFootprint = getFootprint(FORGE); if (threeByThreeFootprint === undefined) return [];
      // Using reduce to filter and combine currentlyEnrouteConstructionGrids and buildingPositions
      const filteredPositions = [...currentlyEnrouteConstructionGrids, ...buildingPositions].reduce((/** @type {Point2D[]} */acc, position) => {
        // Check if 'position' is a Point2D and not a tuple
        if (position && typeof position === 'object' && !Array.isArray(position)) {
          acc.push(position);
        } else if (Array.isArray(position) && position[1] && typeof position[1] === 'object') {
          // If 'position' is a tuple, extract the Point2D part
          acc.push(position[1]);
        }
        return acc;
      }, []);


      BuildingPlacement.threeByThreePositions = BuildingPlacement.threeByThreePositions.filter(position => {
        // Ensure position is a valid Point2D object before passing it to cellsInFootprint
        if (typeof position === 'object' && position) {
          return !pointsOverlap(
            filteredPositions,
            cellsInFootprint(position, threeByThreeFootprint)
          );
        }
        return false;
      });

      if (BuildingPlacement.threeByThreePositions.length > 0) {
        const threeByThreeCellsInFootprints = BuildingPlacement.threeByThreePositions.map(position => cellsInFootprint(position, threeByThreeFootprint));
        wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, cellsInFootprint(position, threeByThreeFootprint))));
        const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
        if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
          const canPlace = getRandom(BuildingPlacement.threeByThreePositions.filter(pos => map.isPlaceableAt(unitType, pos)));
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
    /** @type {Point2D[]} */
    const placementGrids = [];
    const orphanAddons = units.getById([REACTOR, TECHLAB]);

    const buildingFootprints = Array.from(buildingPositions.entries()).reduce((/** @type {Point2D[]} */positions, [step, buildingPos]) => {

      const stepData = currentPlan[step];

      const stepUnitType = stepData.unitType;

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

    const wallOffPositions = BuildingPlacement.findWallOffPlacement(unitType).slice();
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
      if (expansion.areas) {
        placementGrids.push(...expansion.areas.placementGrid);
      }
    });
    if (BuildingPlacement.addOnPositions.length > 0) {
      const barracksFootprint = getFootprint(BARRACKS);
      if (barracksFootprint === undefined) return [];
      const barracksCellInFootprints = BuildingPlacement.addOnPositions.map(position => cellsInFootprint(createPoint2D(position), barracksFootprint));
      wallOffPositions.push(...barracksCellInFootprints.flat());
    }
    if (BuildingPlacement.twoByTwoPositions.length > 0) {
      const supplyFootprint = getFootprint(SUPPLYDEPOT);
      if (supplyFootprint === undefined) return [];
      const supplyCellInFootprints = BuildingPlacement.twoByTwoPositions.map(position => cellsInFootprint(position, supplyFootprint));
      wallOffPositions.push(...supplyCellInFootprints.flat());
    }
    if (BuildingPlacement.threeByThreePositions.length > 0) {
      const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
      if (engineeringBayFootprint === undefined) return [];
      const engineeringBayCellInFootprints = BuildingPlacement.threeByThreePositions.map(position => cellsInFootprint(position, engineeringBayFootprint));
      wallOffPositions.push(...engineeringBayCellInFootprints.flat());
    }
    const unitTypeFootprint = getFootprint(unitType);
    /** @type {FootprintType | undefined} */
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
function findPosition(world, unitType, candidatePositions) {
  const { gasMineTypes } = groupTypes;
  if (candidatePositions.length === 0) {
    candidatePositions = findPlacements(world, unitType);
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
  const unitTypeName = Object.keys(UnitType).find(type => UnitType[/** @type {keyof UnitType} */(type)] === unitType);
  if (foundPosition) console.log(`Found position for ${unitTypeName}`, foundPosition);
  else console.log(`Could not find position for ${unitTypeName}`);
  return foundPosition;
}

module.exports = {
  findPlacements,
  findPosition,
};
