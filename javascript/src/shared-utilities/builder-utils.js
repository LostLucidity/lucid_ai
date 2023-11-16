//@ts-check
"use strict"

// === IMPORTS ===

const groupTypes = require("@node-sc2/core/constants/groups");
const { earmarkThresholdReached } = require("../../services/data-service");
const { getMiddleOfStructure, getDistance } = require("../../services/position-service");
const unitService = require("../../services/unit-service");
const worldService = require("../world-service");
const { getTimeToTargetCost, getTimeToTargetTech } = require("./common-utilities");
const { getTimeInSeconds } = require("../../services/frames-service");
const { getClosestPathWithGasGeysers } = require("../services/utility-service");
const { pathFindingService } = require("../services/pathfinding");
const { createUnitCommand } = require("./command-utilities");
const { MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { UnitType } = require("@node-sc2/core/constants");
const { getPathCoordinates } = require("../../services/path-service");
const MapResourceService = require("../../systems/map-resource-system/map-resource-service");
const dataService = require("../../services/data-service");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const unitResourceService = require("../../systems/unit-resource/unit-resource-service");
const planService = require("../../services/plan-service");


// === UTILITY FUNCTIONS ===

/**
 * @param {SC2APIProtocol.Point2D} point1
 * @param {SC2APIProtocol.Point2D} point2
 * @param {number} epsilon
 * @returns {boolean}
 */
const areApproximatelyEqual = (point1, point2, epsilon = 0.0002) => {
  if (point1.x === undefined || point1.y === undefined || point2.x === undefined || point2.y === undefined) {
    return false;
  }

  const dx = Math.abs(point1.x - point2.x);
  const dy = Math.abs(point1.y - point2.y);

  return dx < epsilon && dy < epsilon;
}

/**
 * @param {number} baseDistanceToPosition
 * @param {number} buildTimeLeft
 * @param {number} movementSpeedPerSecond
 * @returns {number}
 */
const calculateBaseTimeToPosition = (baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond) => {
  return (baseDistanceToPosition / movementSpeedPerSecond) + getTimeInSeconds(buildTimeLeft) + movementSpeedPerSecond;
};

/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 */
function calculateTimeToFinishStructure(data, unit) {
  const { buildProgress } = unit;
  const { buildTime } = data.getUnitTypeData(unit.unitType);
  const timeElapsed = buildTime * buildProgress;
  const timeLeft = getTimeInSeconds(buildTime - timeElapsed);
  return timeLeft;
}

/**
 * @param {Point2D} buildingPosition
 * @param {Point2D} unitPosition
 * @returns {Point2D}
 */
function getAwayPosition(buildingPosition, unitPosition) {
  // Default to 0 if undefined
  const unitX = unitPosition.x || 0;
  const unitY = unitPosition.y || 0;
  const buildingX = buildingPosition.x || 0;
  const buildingY = buildingPosition.y || 0;

  const dx = unitX - buildingX;
  const dy = unitY - buildingY;
  return {
    x: unitX + dx,
    y: unitY + dy
  };
}

/**
 * 
 * @param {{unit: Unit, timeToPosition: number }} builder
 * @returns {{unit: Unit, timeToPosition: number, movementSpeedPerSecond: number }}
 */
const getBuilderInformation = (builder) => {
  let { unit, timeToPosition } = builder;
  const { movementSpeed } = unit.data();
  const movementSpeedPerSecond = movementSpeed ? movementSpeed * 1.4 : 0;
  return { unit, timeToPosition, movementSpeedPerSecond };
};

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @param {UnitTypeId} unitType
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleNonRallyBase = (world, unit, position, unitCommand, unitType) => {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const { pos } = unit; if (pos === undefined) return [];
  let actions = [];

  const orderTargetPosition = unitResourceService.getOrderTargetPosition(units, unit);
  const movingButNotToPosition = unitService.isMoving(unit) && orderTargetPosition && getDistance(orderTargetPosition, position) > 1;

  // check for units near the building position
  const unitsNearPosition = units.getAlive(Alliance.SELF).filter(u => u.pos && getDistance(u.pos, position) <= 2);

  unitsNearPosition.forEach(u => {
    if (u.pos) { // only consider units where pos is defined
      const moveAwayCommand = createUnitCommand(MOVE, [u]);
      moveAwayCommand.targetWorldSpacePos = getAwayPosition(u.pos, position);
      actions.push(moveAwayCommand);
    }
  });

  actions.push(...worldService.rallyWorkerToTarget(world, position, true));

  // check for a current unit that is heading towards position
  const currentUnitMovingToPosition = units.getWorkers().find(u => {
    const orderTargetPosition = unitResourceService.getOrderTargetPosition(units, u); if (orderTargetPosition === undefined) return false;
    return unitService.isMoving(u) && areApproximatelyEqual(orderTargetPosition, position);
  });

  // if there is a unit already moving to position, check if current unit is closer
  if (currentUnitMovingToPosition) {
    const { pos: currentUnitMovingToPositionPos } = currentUnitMovingToPosition; if (currentUnitMovingToPositionPos === undefined) return [];
    const distanceOfCurrentUnit = pathFindingService.getDistanceByPath(resources, pos, position);
    const distanceOfMovingUnit = pathFindingService.getDistanceByPath(resources, currentUnitMovingToPositionPos, position);

    if (distanceOfCurrentUnit >= distanceOfMovingUnit) {
      // if current unit is not closer, return early
      return actions;
    }
  }

  if (!unit.isConstructing() && !movingButNotToPosition) {
    unitCommand.targetWorldSpacePos = position;
    setBuilderLabel(unit);
    actions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, unit, position));
    unitService.setPendingOrders(unit, unitCommand);
    if (agent.race === Race.ZERG) {
      const { foodRequired } = data.getUnitTypeData(unitType);
      if (foodRequired !== undefined) {
        planService.pendingFood -= foodRequired;
      }
    }
  }
  actions.push(...worldService.rallyWorkerToTarget(world, position, true));

  return actions;
};

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleRallyBase = (world, unit, position) => {
  let actions = [];
  actions.push(...worldService.rallyWorkerToTarget(world, position));
  actions.push(...stopUnitFromMovingToPosition(unit, position));
  return actions;
};

/**
 * Moves a builder to a position in preparation for building.
 * @param {World} world 
 * @param {Point2D} position 
 * @param {UnitTypeId} unitType
 * @param {(world: World, position: Point2D) => {unit: Unit, timeToPosition: number} | undefined} getBuilderFunc
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function premoveBuilderToPosition(world, position, unitType, getBuilderFunc) {
  const { getBuildTimeLeft, getPendingOrders } = unitService;
  const { constructionAbilities, gasMineTypes, workerTypes } = groupTypes;
  const { agent, data, resources } = world;
  if (earmarkThresholdReached(data)) return [];
  const { debug, map, units } = resources.get();
  const { rallyWorkerToTarget } = worldService;
  const collectedActions = [];
  position = getMiddleOfStructure(position, unitType);
  const builder = getBuilderFunc(world, position);
  if (builder) {
    let { unit, timeToPosition, movementSpeedPerSecond } = getBuilderInformation(builder);
    const { orders, pos } = unit; if (orders === undefined || pos === undefined) return collectedActions;
    const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, position);
    const { pathCoordinates, pathableTargetPosition } = closestPathablePositionBetweenPositions;
    if (debug !== undefined) {
      debug.setDrawCells('prmv', getPathCoordinates(MapResourceService.getMapPath(map, pos, pathableTargetPosition)).map(point => ({ pos: point })), { size: 1, cube: false });
    }
    let rallyBase = false;
    let buildTimeLeft = 0;
    const completedBases = units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1);
    const [closestBaseByPath] = pathFindingService.getClosestUnitByPath(resources, pathableTargetPosition, completedBases);
    if (closestBaseByPath) {
      const pathablePositions = MapResourceService.getPathablePositionsForStructure(map, closestBaseByPath);
      const [pathableStructurePosition] = pathFindingService.getClosestPositionByPath(resources, pathableTargetPosition, pathablePositions);
      const baseDistanceToPosition = pathFindingService.getDistanceByPath(resources, pathableStructurePosition, pathableTargetPosition);
      const { unitTypeTrainingAbilities } = dataService;
      const workerCurrentlyTraining = closestBaseByPath.orders.findIndex(order => workerTypes.includes(unitTypeTrainingAbilities.get(order.abilityId))) === 0;
      if (workerCurrentlyTraining) {
        const { buildTime } = data.getUnitTypeData(WorkerRace[agent.race]);
        const { progress } = closestBaseByPath.orders[0];
        if (buildTime === undefined || progress === undefined) return collectedActions;
        buildTimeLeft = getBuildTimeLeft(closestBaseByPath, buildTime, progress);
        let baseTimeToPosition = calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond);
        rallyBase = timeToPosition > baseTimeToPosition;
        timeToPosition = rallyBase ? baseTimeToPosition : timeToPosition;
      }
    }
    const pendingConstructionOrder = getPendingOrders(unit).some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
    const unitCommand = builder ? createUnitCommand(MOVE, [unit], pendingConstructionOrder) : {};
    const timeToTargetCost = getTimeToTargetCost(world, unitType);
    const timeToTargetTech = getTimeToTargetTech(world, unitType);
    const timeToTargetCostOrTech = timeToTargetTech > timeToTargetCost ? timeToTargetTech : timeToTargetCost;
    if (shouldPremoveNow(world, timeToTargetCostOrTech, timeToPosition)) {
      if (agent.race === Race.PROTOSS && !gasMineTypes.includes(unitType)) {
        if (pathCoordinates.length >= 2) {
          const secondToLastPosition = pathCoordinates[pathCoordinates.length - 2];
          position = avgPoints([secondToLastPosition, position, position]);
        }
      }
      if (rallyBase) {
        collectedActions.push(...handleRallyBase(world, unit, position));
      } else {
        collectedActions.push(...handleNonRallyBase(world, unit, position, unitCommand, unitType));
      }
    } else {
      collectedActions.push(...rallyWorkerToTarget(world, position, true));
    }
  }
  return collectedActions;
}

/**
 * @param {Unit} builder
 */
function setBuilderLabel(builder) {
  builder.labels.set('builder', true);
  if (builder.labels.has('mineralField')) {
    const mineralField = builder.labels.get('mineralField');
    if (mineralField) {
      mineralField.labels.set('workerCount', mineralField.labels.get('workerCount') - 1);
      builder.labels.delete('mineralField');
    }
  }
}

/**
 * @param {World} world
 * @param {number} timeToTargetCost 
 * @param {number} timeToPosition 
 * @returns {boolean}
 */
function shouldPremoveNow(world, timeToTargetCost, timeToPosition) {
  const { PYLON } = UnitType;
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const willHaveEnoughMineralsByArrival = timeToTargetCost <= timeToPosition;
  // if race is protoss
  if (agent.race === Race.PROTOSS) {
    const pylons = units.getById(PYLON);
    // get time left for first pylon to warp in
    if (pylons.length === 1) {
      const [pylon] = pylons;
      if (pylon.buildProgress < 1) {
        const timeToFinish = calculateTimeToFinishStructure(data, pylon);
        // if time left for first pylon to warp in is less than time to target cost and time to position, then we should pre-move
        return willHaveEnoughMineralsByArrival && timeToFinish <= timeToPosition;
      } else {
        // ignore in progress pylons beyound first pylon
      }
    } else {
      // if there are more than one pylon or no pylon, then no need to calculate time to finish
    }
  }
  return willHaveEnoughMineralsByArrival;
}

/**
 * 
 * @param {Unit} unit 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopUnitFromMovingToPosition(unit, position) {
  const collectedActions = [];
  const { orders } = unit;
  if (orders === undefined) return collectedActions;
  if (orders.length > 0) {
    const { targetWorldSpacePos } = orders[0];
    if (targetWorldSpacePos === undefined) return collectedActions;
    const distanceToTarget = getDistance(targetWorldSpacePos, position);
    if (distanceToTarget < 1) {
      collectedActions.push(createUnitCommand(STOP, [unit]));
    }
  }
  return collectedActions;
}

// === EXPORTS ===

module.exports = {
  premoveBuilderToPosition,
  setBuilderLabel
};
