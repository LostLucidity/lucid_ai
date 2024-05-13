// buildingWorkerInteractions.js

const { Ability } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");

const { createUnitCommand } = require("../../core/utils/common");
const { getAwayPosition, areApproximatelyEqual } = require("../../gameLogic/spatial/pathfinding");
const { getDistanceByPath } = require("../../gameLogic/spatial/pathfindingCore");
const { getDistance } = require("../../gameLogic/spatial/spatialCoreUtils");
const { isMoving, rallyWorkerToTarget, getUnitsFromClustering, setBuilderLabel, getOrderTargetPosition } = require("../../gameLogic/utils/economy/workerService");
const { getBuilders } = require("../../gameLogic/utils/gameMechanics/workerUtils");
const { GameState } = require("../../gameState");
const { setPendingOrders } = require("../../units/management/unitOrders");

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

  actions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));

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
  actions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));

  return actions;
}

/**
 * Returns an array of unitCommands to prevent multiple builders on the same task. 
 * @param {UnitResource} units 
 * @param {Unit} builder 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopOverlappingBuilders(units, builder, position) {
  const collectedActions = [];
  const overlappingBuilders = getBuilders(units).filter(otherBuilder => {
    const orderTargetPosition = getOrderTargetPosition(units, otherBuilder);
    return otherBuilder.tag !== builder.tag && orderTargetPosition && getDistance(orderTargetPosition, position) < 1.6;
  });
  if (overlappingBuilders.length > 0) {
    const unitCommand = createUnitCommand(Ability.STOP, overlappingBuilders.map(builder => builder));
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

// Exporting the functions
module.exports = {
  handleNonRallyBase,
  stopOverlappingBuilders,
};
