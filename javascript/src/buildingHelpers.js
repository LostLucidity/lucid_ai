const { Ability } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");

const { logNoFreeGeysers } = require("./builderUtils");
const { keepPosition, getBuilderInformation } = require("./buildingCommons");
const { isGasCollector, isGeyserFree } = require("./buildingUtils");
const { getTimeToTargetTech } = require("./gameData");
const GameState = require("./gameState");
const { getClosestUnitByPath, getClosestPositionByPath } = require("./pathfinding");
const { getPathCoordinates, getMapPath } = require("./pathUtils");
const { calculateBaseTimeToPosition } = require("./placementAndConstructionUtils");
const { earmarkThresholdReached } = require("./resourceUtils");
const { handleNonRallyBase } = require("./sharedBuildingUtils");
const { getClosestPathWithGasGeysers, getBuildTimeLeft, getUnitsFromClustering } = require("./sharedUtils");
const { unitTypeTrainingAbilities } = require("./unitConfig");
const { getPathablePositionsForStructure, getDistanceByPath, createUnitCommand, isPlaceableAtGasGeyser } = require("./utils");
const { getPendingOrders } = require("./utils/commonGameUtils");
const { handleRallyBase, rallyWorkerToTarget, getOrderTargetPosition } = require("./workerUtils");

// src/buildingHelpers.js
module.exports = {
  /**
   * Determines a valid position for placing a building.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @param {false | Point2D | undefined} buildingPositionFn
   * @param {(world: World, unitType: UnitTypeId) => Point2D[]} findPlacementsFn
   * @param {(world: World, unitType: UnitTypeId, candidatePositions: Point2D[]) => false | Point2D} findPositionFn
   * @param {(unitType: UnitTypeId, position: false | Point2D) => void} setBuildingPositionFn
   * @returns {false | Point2D}
   */
  determineBuildingPosition(world, unitType, candidatePositions, buildingPositionFn, findPlacementsFn, findPositionFn, setBuildingPositionFn) {
    if (buildingPositionFn && keepPosition(world, unitType, buildingPositionFn, isPlaceableAtGasGeyser)) {
      setBuildingPositionFn(unitType, buildingPositionFn);
      return buildingPositionFn;
    }

    if (isGasCollector(unitType)) {
      candidatePositions = findPlacementsFn(world, unitType).filter(pos => isGeyserFree(world, pos));
      if (candidatePositions.length === 0) {
        logNoFreeGeysers();
        return false;
      }
    } else if (candidatePositions.length === 0) {
      candidatePositions = findPlacementsFn(world, unitType);
    }

    let position = findPositionFn(world, unitType, candidatePositions);
    if (!position) {
      console.error(`No valid position found for building type ${unitType}`);
      return false;
    }

    setBuildingPositionFn(unitType, position);
    return position;
  },

  /**
   * Find potential building placements within the main base.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */  
  getInTheMain: function (world, unitType) {
    const { map } = world.resources.get();
    const mainBase = map.getMain();

    if (!mainBase || !mainBase.areas) {
      return []; // Return an empty array if mainBase or its areas are undefined
    }

    // Filter the placement grid to find suitable positions
    return mainBase.areas.placementGrid.filter(grid => map.isPlaceableAt(unitType, grid));
  },

  /**
   * Moves a builder to a position in preparation for building.
   * @param {World} world 
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @param {(world: World, position: Point2D) => {unit: Unit, timeToPosition: number} | undefined} getBuilderFunc
   * @param {(position: Point2D, unitType: UnitTypeId) => Point2D} getMiddleOfStructureFn
   * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCostFn
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  premoveBuilderToPosition(world, position, unitType, getBuilderFunc, getMiddleOfStructureFn, getTimeToTargetCostFn) {
    const { constructionAbilities, gasMineTypes, workerTypes } = groupTypes;
    const { agent, data, resources } = world;
    if (earmarkThresholdReached(data)) return [];
    const { debug, map, units } = resources.get();

    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    position = getMiddleOfStructureFn(position, unitType);
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
          const { buildTime } = data.getUnitTypeData(WorkerRace[agent.race || Race.TERRAN]);
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
      const timeToTargetCost = getTimeToTargetCostFn(world, unitType);
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
  },
};
