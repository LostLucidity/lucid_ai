//@ts-check
"use strict"

// buildingPlacement.js

// External library imports
const { UnitType, Ability } = require('@node-sc2/core/constants');
const { Race, Alliance } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { WorkerRace } = require('@node-sc2/core/constants/race-map');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D, getNeighbors, avgPoints } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint, twoByTwoUnits } = require('@node-sc2/core/utils/geometry/units');
const getRandom = require('@node-sc2/core/utils/get-random');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');

// Internal module imports
const { getCurrentlyEnrouteConstructionGrids, keepPosition, getBuilderInformation } = require('./buildingCommons');
const { getTimeToTargetTech } = require('./gameData');
const GameState = require('./gameState');
const { buildingPositions, currentStep } = require('./gameStateResources');
const { getDistance, getClosestPosition } = require('./geometryUtils');
const MapResources = require('./mapResources');
const { getOccupiedExpansions, existsInMap, pointsOverlap } = require('./mapUtils');
const { getClosestUnitByPath, getClosestPositionByPath } = require('./pathfinding');
const { getPathCoordinates, getMapPath } = require('./pathUtils');
const { calculateBaseTimeToPosition } = require('./placementAndConstructionUtils');
const { getAddOnPlacement, getAddOnBuildingPlacement, getBuildingFootprintOfOrphanAddons, findZergPlacements } = require('./placementUtils');
const { getTimeToTargetCost } = require('./resourceManagement');
const { earmarkThresholdReached } = require('./resourceUtils');
const { handleNonRallyBase } = require('./sharedBuildingUtils');
const { getBuildTimeLeft, getClosestPathWithGasGeysers, getPendingOrders, getUnitsFromClustering } = require('./sharedUtils');
const { seigeTanksSiegedGrids } = require('./unitActions');
const { flyingTypesMapping, canUnitBuildAddOn, unitTypeTrainingAbilities, addOnTypesMapping } = require('./unitConfig');
const { getTimeInSeconds, getPathablePositionsForStructure, getDistanceByPath, createUnitCommand, getStringNameOfConstant } = require('./utils');
const { handleRallyBase, getOrderTargetPosition, rallyWorkerToTarget } = require('./workerUtils');
const config = require('../config/config');

class BuildingPlacement {
  /** @type {Point2D[]} */
  static addOnPositions = [];

  /** @type {Point2D[]} */
  static wall = []; 

  /** @type {Point2D | null} */
  static pylonPlacement = null;

  /** @type {Point2D[]} */
  static threeByThreePositions = [];

  /** @type {Point2D[]} */
  static twoByTwoPositions = [];

  /**
   * Private static property to hold the found position.
   * @type {Point2D | null}
   */
  static #foundPosition = null;

  /** @type {false | Point2D | undefined} */
  static get buildingPosition() {
    const positions = buildingPositions.get(currentStep);
    // Return the first element of the array or undefined if the array is empty
    return positions ? positions[0] : undefined;
  }

  /**
   * @param {false | Point2D} value
   * @returns {void}
   */
  static set buildingPosition(value) {
    if (value) {
      buildingPositions.set(currentStep, value);
    }
  }

  /**
   * Updates the found position.
   * @param {Point2D | null} newPosition - The new position to set.
   */
  static updateFoundPosition(newPosition) {
    BuildingPlacement.#foundPosition = newPosition;
  }

  /**
   * Retrieves the currently found position.
   * @returns {Point2D | null} - The found position.
   */
  static getFoundPosition() {
    return BuildingPlacement.#foundPosition;
  }  

  /**
   * Retrieves candidate positions for building based on provided criteria.
   * @param {ResourceManager} resources
   * @param {Point2D[] | string} positions
   * @param {UnitTypeId | null} [unitType=null]
   * @returns {Point2D[]}
   */
  static getCandidatePositions(resources, positions, unitType = null) {
    if (typeof positions === 'string') {
      const functionName = `get${positions}`;
      // Replace placementHelper with direct method call
      if (typeof BuildingPlacement[functionName] === 'function') {
        return BuildingPlacement[functionName](resources, unitType);
      } else {
        throw new Error(`Function "${functionName}" does not exist in BuildingPlacement`);
      }
    } else {
      return positions;
    }
  }

  /**
   * @param {ResourceManager} resources
   * @returns {Promise<Point2D[]>}
   */
  static async getByMainRamp(resources) {
    const { map } = resources.get();
    const main = map.getMain();

    // Check if 'main' and 'main.areas' are defined
    if (!main || !main.areas) {
      return []; // Return an empty array if 'main' or 'main.areas' is undefined
    }

    // get pathable main area within 8 distance of ramp
    const getMainPositionsByRamp = main.areas.areaFill.filter(point => {
      return getNeighbors(point).some(neighbor => map.isRamp(neighbor));
    });

    const pathableMainAreas = main.areas.areaFill.filter(point =>
      map.isPathable(point) && getDistance(avgPoints(getMainPositionsByRamp), point) <= 8
    );

    return pathableMainAreas;
  }

  /**
   * Finds positions where a given unit type can be placed.
   * @param {Point2D[]} candidates - Candidate positions for placement.
   * @param {MapResource} map - The map resource.
   * @param {UnitTypeId} unitType - The type of unit to place.
   * @returns {Point2D[]} - An array of placeable positions.
   */
  static getPlaceableAtPositions(candidates, map, unitType) {
    const filteredCandidates = candidates.filter(position => map.isPlaceableAt(unitType, position));

    if (filteredCandidates.length === 0) {
      let expandedCandidates = [];
      candidates.forEach(candidate => {
        expandedCandidates.push(candidate, ...getNeighbors(candidate));
      });
      expandedCandidates = expandedCandidates.filter((candidate, index, self) =>
        self.findIndex(selfCandidate => selfCandidate.x === candidate.x && selfCandidate.y === candidate.y) === index
      );

      if (expandedCandidates.length > 0) {
        return BuildingPlacement.getPlaceableAtPositions(expandedCandidates, map, unitType);
      } else {
        return [];
      }
    } else {
      return filteredCandidates;
    }
  }

  /**
   * 
   * @param {ResourceManager} resources 
   * @param {UnitTypeId} unitType 
   * @returns {Point2D[]}
   */
  static getMiddleOfNaturalWall(resources, unitType) {
    const { map } = resources.get();
    const naturalWall = map.getNatural().getWall() || this.wall;
    let candidates = [];
    if (naturalWall) {
      let wallPositions = this.getPlaceableAtPositions(naturalWall, map, unitType);
      // Filter placeable positions first to reduce size of array
      wallPositions = wallPositions.filter(point => map.isPlaceableAt(unitType, point));
      const middleOfWall = getClosestPosition(avgPoints(wallPositions), wallPositions, 2);
      candidates = middleOfWall;
    }
    return candidates;
  }

  /**
   * @param {ResourceManager} resources
   * @returns {Point2D[]}
   */
  static getNaturalWallPylon(resources) {
    const { map } = resources.get();
    const naturalExpansion = map.getNatural();

    // Check if 'naturalExpansion' and 'naturalExpansion.areas' are defined
    if (!naturalExpansion || !naturalExpansion.areas) {
      return []; // Return an empty array if 'naturalExpansion' or 'naturalExpansion.areas' is undefined
    }

    let possiblePlacements = this.pylonPlacement ? [this.pylonPlacement] : [];
    const naturalWall = this.wall.length > 0 ? this.wall : naturalExpansion.getWall();
    if (naturalWall) {
      const naturalTownhallPosition = naturalExpansion.townhallPosition;
      if (!this.pylonPlacement) {
        possiblePlacements = frontOfGrid(resources, naturalExpansion.areas.areaFill)
          .filter(point => naturalWall.every(wallCell => (
            (getDistance(naturalTownhallPosition, point) > 4.5) &&
            (getDistance(wallCell, point) <= 6.5) &&
            (getDistance(wallCell, point) >= 3) &&
            getDistance(wallCell, naturalTownhallPosition) > getDistance(point, naturalTownhallPosition)
          )));

        if (possiblePlacements.length === 0) {
          possiblePlacements = frontOfGrid(resources, naturalExpansion.areas.areaFill)
            .map(point => {
              point['coverage'] = naturalWall.filter(wallCell => (
                (getDistance(wallCell, point) <= 6.5) &&
                (getDistance(wallCell, point) >= 1) &&
                getDistance(wallCell, naturalTownhallPosition) > getDistance(point, naturalTownhallPosition)
              )).length;
              return point;
            })
            .sort((a, b) => b['coverage'] - a['coverage'])
            .filter((cell, i, arr) => cell['coverage'] === arr[0]['coverage'])
        }
      }
    }
    return possiblePlacements;
  }

  /**
   * @param {World} world 
   * @param {Unit} building 
   * @param {UnitTypeId} addOnType 
   * @returns {Point2D | undefined}
   */
  static checkAddOnPlacement(world, building, addOnType = UnitType.REACTOR) {
    const { REACTOR, TECHLAB } = UnitType;
    const { resources } = world;
    const { map, units } = resources.get();
    const { unitType, pos } = building;

    // Ensure unitType and pos are defined
    if (unitType === undefined || pos === undefined) {
      console.error("checkAddOnPlacement: Missing unit type or position.");
      return;
    }

    if (canUnitBuildAddOn(unitType)) {
      let position = null;
      let addOnPosition = null;
      let range = 1;

      do {
        const nearPoints = gridsInCircle(getAddOnPlacement(pos), range).filter(grid => {
          const addOnFootprint = getFootprint(addOnType);
          if (!addOnFootprint) return false; // Ensure addOnFootprint is defined

          const addOnBuildingPlacementsForOrphanAddOns = units.getStructures(Alliance.SELF).reduce((/** @type {Point2D[]} */acc, structure) => {
            if (typeof structure.unitType === 'number' && [REACTOR, TECHLAB].includes(structure.unitType) && structure.pos) {
              return [...acc, ...cellsInFootprint(getAddOnBuildingPlacement(structure.pos), { h: 3, w: 3 })];
            }
            return acc;
          }, []);

          const getBuildingAndAddOnPlacement = [
            ...cellsInFootprint(grid, addOnFootprint),
            ...cellsInFootprint(getAddOnBuildingPlacement(grid), { h: 3, w: 3 })
          ];

          return [
            existsInMap(map, grid) && map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(flyingTypesMapping.get(unitType) || unitType, getAddOnBuildingPlacement(grid)),
            !pointsOverlap(getBuildingAndAddOnPlacement, [...seigeTanksSiegedGrids, ...addOnBuildingPlacementsForOrphanAddOns]),
          ].every(condition => condition);
        });
        if (nearPoints.length > 0) {
          if (Math.random() < (1 / 2)) {
            addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, addOnType)}`, addOnPosition);
            position = getAddOnBuildingPlacement(addOnPosition);
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, building.unitType)}`, position);
          } else {
            addOnPosition = this.findPosition(world, addOnType, nearPoints);
            if (addOnPosition) {
              if (typeof building.unitType === 'number') {
                position = this.findPosition(world, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
              } else {
                console.error('checkAddOnPlacement: building.unitType is undefined');
              }
            }
          }
        }
        range++
      } while (!position || !addOnPosition);
      return position;
    } else {
      return;
    }
  }

  /**
   * Retrieves positions near mineral lines.
   * @param {ResourceManager} resources
   * @returns {Point2D[]}
   */
  static getMineralLines(resources) {
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
  }

  /**
   * Finds placement for wall-off structures based on the unit type.
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  static findWallOffPlacement(unitType) {
    if (twoByTwoUnits.includes(unitType)) {
      return this.twoByTwoPositions;
    } else if (addOnTypesMapping.has(unitType)) {
      return this.addOnPositions;
    } else if (groupTypes.structureTypes.includes(unitType)) {
      return this.threeByThreePositions;
    } else {
      return [];
    }
  }
  
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  static findPlacements(world, unitType) {
    const { BARRACKS, ENGINEERINGBAY, FORGE, PYLON, REACTOR, STARPORT, SUPPLYDEPOT, TECHLAB } = UnitType;
    const { gasMineTypes } = groupTypes;
    const { agent, data, resources } = world;
    const { race } = agent;
    const { map, units } = resources.get();
    const [main, natural] = map.getExpansions();

    // Check if main and natural expansions are defined and have the 'areas' property
    if (!main || !main.areas || !natural || !natural.areas) {
      return [];
    }

    const mainMineralLine = main.areas.mineralLine;
    if (gasMineTypes.includes(unitType)) {
      const geyserPositions = MapResources.getFreeGasGeysers(map).map(geyser => {
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
            return this.getCandidatePositions(resources, 'NaturalWallPylon', unitType);
          }
        }
        const occupiedExpansions = getOccupiedExpansions(resources);
        const occupiedExpansionsPlacementGrid = occupiedExpansions.reduce((/** @type {Point2D[]} */acc, expansion) => {
          if (expansion.areas !== undefined) {
            acc.push(...expansion.areas.placementGrid);
          }
          return acc;
        }, []);

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


        this.threeByThreePositions = this.threeByThreePositions.filter(position => {
          // Ensure position is a valid Point2D object before passing it to cellsInFootprint
          if (typeof position === 'object' && position) {
            return !pointsOverlap(
              filteredPositions,
              cellsInFootprint(position, threeByThreeFootprint)
            );
          }
          return false;
        });

        if (this.threeByThreePositions.length > 0) {
          const threeByThreeCellsInFootprints = this.threeByThreePositions.map(position => cellsInFootprint(position, threeByThreeFootprint));
          wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, cellsInFootprint(position, threeByThreeFootprint))));
          const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
          if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
            const canPlace = getRandom(this.threeByThreePositions.filter(pos => map.isPlaceableAt(unitType, pos)));
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

      const buildingFootprints = Array.from(buildingPositions.entries()).reduce((/** @type {Point2D[]} */positions, [step, buildingPos]) => {
        const stepData = currentPlan[step] ?
          currentPlan[step] :
          gameState.convertLegacyPlan(GameState.legacyPlan)[step];

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

      const wallOffPositions = this.findWallOffPlacement(unitType).slice();
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
      if (this.addOnPositions.length > 0) {
        const barracksFootprint = getFootprint(BARRACKS);
        if (barracksFootprint === undefined) return [];
        const barracksCellInFootprints = this.addOnPositions.map(position => cellsInFootprint(createPoint2D(position), barracksFootprint));
        wallOffPositions.push(...barracksCellInFootprints.flat());
      }
      if (this.twoByTwoPositions.length > 0) {
        const supplyFootprint = getFootprint(SUPPLYDEPOT);
        if (supplyFootprint === undefined) return [];
        const supplyCellInFootprints = this.twoByTwoPositions.map(position => cellsInFootprint(position, supplyFootprint));
        wallOffPositions.push(...supplyCellInFootprints.flat());
      }
      if (this.threeByThreePositions.length > 0) {
        const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
        if (engineeringBayFootprint === undefined) return [];
        const engineeringBayCellInFootprints = this.threeByThreePositions.map(position => cellsInFootprint(position, engineeringBayFootprint));
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
   * Find potential building placements within the main base.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Promise<Point2D[]>}
   */
  static async getInTheMain(world, unitType) {
    const { actions, map } = world.resources.get();
    const mainBase = map.getMain();

    if (!mainBase || !mainBase.areas) {
      return []; // Return an empty array if mainBase or its areas are undefined
    }

    const candidatePositions = mainBase.areas.placementGrid.filter(grid => map.isPlaceableAt(unitType, grid));
    const placementResults = await Promise.all(candidatePositions.map(pos => actions.canPlace(unitType, [pos])));

    // Use reduce to filter and accumulate the Point2D objects
    return placementResults.reduce((/** @type {Point2D[]} */ acc, result, index) => {
      if (result) {
        acc.push(candidatePositions[index]);
      }
      return acc;
    }, []);
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
      if (gasMineTypes.includes(unitType)) return this.isPlaceableAtGasGeyser(map, unitType, position);
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

  /**
   * @param {UnitTypeId} unitType
   * @param {Point2D | false} position
   * @returns {void}
   */
  static setBuildingPosition(unitType, position) {
    this.buildingPosition =
      GameState.legacyPlan.length > 0 && GameState.legacyPlan[currentStep][2] !== unitType
        ? this.buildingPosition || false // Provide a default value
        : position;
  } 

  /**
   * Determines a valid position for placing a building.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @returns {false | Point2D}
   */
  static determineBuildingPosition(world, unitType, candidatePositions) {
    let position = this.buildingPosition;
    const validPosition = position && keepPosition(world, unitType, position, this.isPlaceableAtGasGeyser);

    if (!validPosition) {
      if (candidatePositions.length === 0) {
        candidatePositions = this.findPlacements(world, unitType);
      }
      position = this.findPosition(world, unitType, candidatePositions);
      if (!position) {
        candidatePositions = this.findPlacements(world, unitType);
        position = this.findPosition(world, unitType, candidatePositions);
      }
      this.setBuildingPosition(unitType, position);
    }

    return position || false;
  }

  /**
   * Determines if a position is suitable for placing a building near a gas geyser.
   * 
   * @param {MapResource} map 
   * @param {UnitTypeId} unitType
   * @param {Point2D} position
   * @returns {boolean}
   */
  static isPlaceableAtGasGeyser(map, unitType, position) {
    return groupTypes.gasMineTypes.includes(unitType) && map.freeGasGeysers().some(gasGeyser => gasGeyser.pos && getDistance(gasGeyser.pos, position) <= 1);
  }

  /**
   * Calculates the middle position of a structure's footprint.
   * @param {Point2D} position - The starting position for the building.
   * @param {UnitTypeId} unitType - The type of the building.
   * @returns {Point2D} - The middle position of the structure's footprint.
   */
  static getMiddleOfStructure(position, unitType) {
    const { gasMineTypes } = groupTypes;
    if (gasMineTypes.includes(unitType)) return position;

    const point2D = createPoint2D(position);
    let { x, y } = point2D;
    if (x === undefined || y === undefined) return position;

    const footprint = getFootprint(unitType);
    if (footprint === undefined) return position;

    if (footprint.h % 2 === 1) {
      x += 0.5;
      y += 0.5;
    }
    return { x, y };
  }  

  /**
   * Moves a builder to a position in preparation for building.
   * @param {World} world 
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @param {(world: World, position: Point2D) => {unit: Unit, timeToPosition: number} | undefined} getBuilderFunc
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  static premoveBuilderToPosition(world, position, unitType, getBuilderFunc) {
    const { constructionAbilities, gasMineTypes, workerTypes } = groupTypes;
    const { agent, data, resources } = world;
    if (earmarkThresholdReached(data)) return [];
    const { debug, map, units } = resources.get();
    const collectedActions = [];
    position = this.getMiddleOfStructure(position, unitType);
    const builder = getBuilderFunc(world, position);
    if (builder) {
      let { unit, timeToPosition, movementSpeedPerSecond } = getBuilderInformation(builder);
      const { orders, pos } = unit; if (orders === undefined || pos === undefined) return collectedActions;
      const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, position);
      const { pathCoordinates, pathableTargetPosition } = closestPathablePositionBetweenPositions;
      if (debug !== undefined) {
        debug.setDrawCells('prmv', getPathCoordinates(getMapPath(map, pos, pathableTargetPosition)).map(point => ({ pos: point })), { size: 1, cube: false });
      }
      let rallyBase = false;
      let buildTimeLeft = 0;
      const completedBases = units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1);
      const [closestBaseByPath] = getClosestUnitByPath(resources, pathableTargetPosition, completedBases);
      if (closestBaseByPath) {
        const pathablePositions = getPathablePositionsForStructure(map, closestBaseByPath);
        const [pathableStructurePosition] = getClosestPositionByPath(resources, pathableTargetPosition, pathablePositions);
        const baseDistanceToPosition = getDistanceByPath(resources, pathableStructurePosition, pathableTargetPosition);
        const workerCurrentlyTraining = closestBaseByPath.orders ?
          closestBaseByPath.orders.some(order => {
            const abilityId = order.abilityId;
            if (abilityId === undefined) {
              return false;
            }
            const unitTypeForAbility = unitTypeTrainingAbilities.get(abilityId);
            return unitTypeForAbility !== undefined && workerTypes.includes(unitTypeForAbility);
          }) :
          false;

        if (workerCurrentlyTraining) {
          const { buildTime } = data.getUnitTypeData(WorkerRace[agent.race]);
          const progress = closestBaseByPath.orders?.[0]?.progress;
          if (buildTime === undefined || progress === undefined) return collectedActions;
          buildTimeLeft = getBuildTimeLeft(closestBaseByPath, buildTime, progress);
          let baseTimeToPosition = calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond);
          rallyBase = timeToPosition > baseTimeToPosition;
          timeToPosition = rallyBase ? baseTimeToPosition : timeToPosition;
        }
      }
      const pendingConstructionOrder = getPendingOrders(unit).some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
      const unitCommand = builder ? createUnitCommand(Ability.MOVE, [unit], pendingConstructionOrder) : {};
      const timeToTargetCost = getTimeToTargetCost(world, unitType);
      const timeToTargetTech = getTimeToTargetTech(world, unitType);
      const timeToTargetCostOrTech = timeToTargetTech > timeToTargetCost ? timeToTargetTech : timeToTargetCost;
      const gameState = GameState.getInstance();
      if (gameState.shouldPremoveNow(world, timeToTargetCostOrTech, timeToPosition)) {
        if (agent.race === Race.PROTOSS && !gasMineTypes.includes(unitType)) {
          if (pathCoordinates.length >= 2) {
            const secondToLastPosition = pathCoordinates[pathCoordinates.length - 2];
            position = avgPoints([secondToLastPosition, position, position]);
          }
        }
        if (rallyBase) {
          collectedActions.push(...handleRallyBase(world, unit, position));
        } else {
          collectedActions.push(...handleNonRallyBase(world, unit, position, unitCommand, unitType, getOrderTargetPosition));
        }
      } else {
        collectedActions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));
      }
    }
    return collectedActions;
  }
}

module.exports = BuildingPlacement;
