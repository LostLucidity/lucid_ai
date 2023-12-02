// sharedBuildingUtils.js

// Import necessary constants, types, and other modules
const { UnitType, Ability } = require("@node-sc2/core/constants");
const { getPendingOrders, getMovementSpeed, getClosestUnitPositionByPath, isMoving, getBuildTimeLeft, getUnitsFromClustering } = require("./sharedUtils");
const GameState = require("./gameState");
const { getStructureAtPosition, getDistance, getAwayPosition, areApproximatelyEqual } = require("./geometryUtils");
const MapResources = require("./mapResources");
const { unitTypeTrainingAbilities } = require("./unitConfig");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");
const { createUnitCommand, getDistanceByPath, getTimeInSeconds } = require("./utils");
const { rallyWorkerToTarget } = require("./workerUtils");
const groupTypes = require("@node-sc2/core/constants/groups");
const { stopOverlappingBuilders } = require("./buildingSharedUtils");
const { setPendingOrders } = require("./common");

/**
 * @param {World} world
 * @param {Unit[]} movingOrConstructingNonDrones 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number}[]}
 */
function calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position) {
  const { resources } = world;
  const { map, units } = resources.get();
  const { SCV, SUPPLYDEPOT } = UnitType;

  return movingOrConstructingNonDrones.reduce((/** @type {{unit: Unit, timeToPosition: number}[]} */acc, movingOrConstructingNonDrone) => {
    const { orders, pos, unitType } = movingOrConstructingNonDrone;
    if (orders === undefined || pos === undefined || unitType === undefined) return acc;

    orders.push(...getPendingOrders(movingOrConstructingNonDrone));
    const { abilityId, targetWorldSpacePos, targetUnitTag } = orders[0];
    if (abilityId === undefined || (targetWorldSpacePos === undefined && targetUnitTag === undefined)) return acc;

    const movingPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined;
    const gameState = new GameState();
    const movementSpeed = getMovementSpeed(map, movingOrConstructingNonDrone, gameState);
    if (movingPosition === undefined || movementSpeed === undefined) return acc;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const isSCV = unitType === SCV;
    const constructingStructure = isSCV ? getStructureAtPosition(units, movingPosition) : undefined;
    constructingStructure && MapResources.setPathableGrids(map, constructingStructure, true);

    const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
    const movingProbeTimeToMovePosition = getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeedPerSecond;

    constructingStructure && MapResources.setPathableGrids(map, constructingStructure, false);

    let buildTimeLeft = 0;
    let supplyDepotCells = [];
    if (isSCV) {
      buildTimeLeft = getContructionTimeLeft(world, movingOrConstructingNonDrone);
      const isConstructingSupplyDepot = unitTypeTrainingAbilities.get(abilityId) === SUPPLYDEPOT;
      if (isConstructingSupplyDepot) {
        const [supplyDepot] = units.getClosest(movingPosition, units.getStructures().filter(structure => structure.unitType === SUPPLYDEPOT));
        if (supplyDepot !== undefined) {
          const { pos, unitType } = supplyDepot; if (pos === undefined || unitType === undefined) return acc;
          const footprint = getFootprint(unitType); if (footprint === undefined) return acc;
          supplyDepotCells = cellsInFootprint(pos, footprint);
          supplyDepotCells.forEach(cell => map.setPathable(cell, true));
        }
      }
    }

    const pathablePremovingPosition = getClosestUnitPositionByPath(resources, position, pathableMovingPosition);
    const targetTimeToPremovePosition = getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeedPerSecond;
    supplyDepotCells.forEach(cell => map.setPathable(cell, false));

    const timeToPosition = movingProbeTimeToMovePosition + buildTimeLeft + targetTimeToPremovePosition;

    acc.push({
      unit: movingOrConstructingNonDrone,
      timeToPosition: timeToPosition
    });

    return acc;
  }, []);
}

/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getContructionTimeLeft(world, unit, inSeconds = true) {
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos, targetUnitTag } = constructingOrder; if (targetWorldSpacePos === undefined && targetUnitTag === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  let targetPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined; if (targetPosition === undefined) return 0;
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && getDistance(unit.pos, targetPosition) < 1);
  const { buildTime } = data.getUnitTypeData(unitTypeBeingConstructed); if (buildTime === undefined) return 0;
  if (unitAtTargetPosition !== undefined) {
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
  } else {
    buildTimeLeft = buildTime;
  }
  if (inSeconds) {
    return getTimeInSeconds(buildTimeLeft);
  }
  return buildTimeLeft;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @param {UnitTypeId} unitType
 * @param {(units: UnitResource, unit: Unit) => Point2D | undefined} getOrderTargetPosition - Injected dependency from workerUtils.js
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleNonRallyBase(world, unit, position, unitCommand, unitType, getOrderTargetPosition) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const { pos } = unit; if (pos === undefined) return [];
  let actions = [];

  const orderTargetPosition = getOrderTargetPosition(units, unit);
  const movingButNotToPosition = isMoving(unit) && orderTargetPosition && getDistance(orderTargetPosition, position) > 1;

  // check for units near the building position
  const unitsNearPosition = units.getAlive(Alliance.SELF).filter(u => u.pos && getDistance(u.pos, position) <= 2);

  unitsNearPosition.forEach(u => {
    if (u.pos) { // only consider units where pos is defined
      const moveAwayCommand = createUnitCommand(Ability.MOVE, [u]);
      moveAwayCommand.targetWorldSpacePos = getAwayPosition(u.pos, position);
      actions.push(moveAwayCommand);
    }
  });

  actions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering, true));

  // check for a current unit that is heading towards position
  const currentUnitMovingToPosition = units.getWorkers().find(u => {
    const orderTargetPosition = getOrderTargetPosition(units, u); if (orderTargetPosition === undefined) return false;
    return isMoving(u) && areApproximatelyEqual(orderTargetPosition, position);
  });

  // if there is a unit already moving to position, check if current unit is closer
  if (currentUnitMovingToPosition) {
    const { pos: currentUnitMovingToPositionPos } = currentUnitMovingToPosition; if (currentUnitMovingToPositionPos === undefined) return [];
    const distanceOfCurrentUnit = getDistanceByPath(resources, pos, position);
    const distanceOfMovingUnit = getDistanceByPath(resources, currentUnitMovingToPositionPos, position);

    if (distanceOfCurrentUnit >= distanceOfMovingUnit) {
      // if current unit is not closer, return early
      return actions;
    }
  }

  if (!unit.isConstructing() && !movingButNotToPosition) {
    unitCommand.targetWorldSpacePos = position;
    setBuilderLabel(unit);
    actions.push(unitCommand, ...stopOverlappingBuilders(units, unit, position));
    setPendingOrders(unit, unitCommand);
    if (agent.race === Race.ZERG) {
      const { foodRequired } = data.getUnitTypeData(unitType);
      if (foodRequired !== undefined) {
        const gameState = GameState.getInstance();
        gameState.pendingFood -= foodRequired; 
      }
    }
  }
  actions.push(...rallyWorkerToTarget(world, position, true));

  return actions;
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

// Export the shared functions
module.exports = {
  calculateMovingOrConstructingNonDronesTimeToPosition,
  handleNonRallyBase,
  setBuilderLabel,
};
