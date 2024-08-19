const { Ability } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");

const { createUnitCommand } = require("../../core/common");
const {
  isMoving,
  rallyWorkerToTarget,
  setBuilderLabel,
  reserveWorkerForBuilding,
} = require("../../gameLogic/economy/workerService");
const { GameState } = require("../../state");
const { getAvailableBuilders } = require("../../units/management/builderUtils");
const { setPendingOrders } = require("../../units/management/unitOrders");
const {
  getAwayPosition,
  getUnitsFromClustering,
  areApproximatelyEqual,
  getOrderTargetPosition,
} = require("../shared/pathfinding/pathfinding");
const { getDistanceByPath } = require("../shared/pathfinding/pathfindingCore");
const { getDistance } = require("../shared/pathfinding/spatialCoreUtils");

/**
 * Handles non-rally base situations by assigning and moving workers.
 * @param {World} world - The game world object.
 * @param {Unit} unit - The worker unit.
 * @param {Point2D} position - The position of the building.
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand - The command for the unit.
 * @param {UnitTypeId} unitType - The type of the unit to be constructed.
 * @param {(units: UnitResource, unit: Unit) => Point2D | undefined} getOrderTargetPosition - Injected dependency from workerUtils.js
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} The array of actions to be executed.
 */
function assignWorkersToBuild(world, unit, position, unitCommand, unitType, getOrderTargetPosition) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const { pos } = unit;
  if (!pos) return [];
  let actions = [];

  const orderTargetPosition = getOrderTargetPosition(units, unit);
  const isMovingButNotToPosition = isMoving(unit) && orderTargetPosition && getDistance(orderTargetPosition, position) > 1;

  // Filter worker units near the building position and move them away
  const unitsNearPosition = units.getAlive(Alliance.SELF).filter(u => u.isWorker() && u.pos && getDistance(u.pos, position) <= 2);
  unitsNearPosition.forEach(u => {
    if (u.pos) { // Ensure u.pos is defined
      const moveAwayCommand = createUnitCommand(Ability.MOVE, [u]);
      moveAwayCommand.targetWorldSpacePos = getAwayPosition(u.pos, position);
      actions.push(moveAwayCommand);
    }
  });

  // Add rally worker commands
  actions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));

  // Find a worker unit currently moving towards the position
  const currentUnitMovingToPosition = units.getWorkers().find(u => {
    const targetPos = getOrderTargetPosition(units, u);
    return targetPos && isMoving(u) && areApproximatelyEqual(targetPos, position);
  });

  if (currentUnitMovingToPosition && currentUnitMovingToPosition.pos) {
    const distanceOfCurrentUnit = getDistanceByPath(resources, pos, position);
    const distanceOfMovingUnit = getDistanceByPath(resources, currentUnitMovingToPosition.pos, position);
    if (distanceOfCurrentUnit >= distanceOfMovingUnit) {
      return actions; // Current unit is not closer, return early
    }
  }

  // Handle worker unit assignment for building
  if (unit.isWorker() && !unit.isConstructing() && !isMovingButNotToPosition) {
    reserveWorkerForBuilding(unit, position);

    unitCommand.targetWorldSpacePos = position;
    setBuilderLabel(unit);
    actions.push(unitCommand, ...stopOverlappingBuilders(units, unit, position));
    setPendingOrders(unit, unitCommand);

    if (agent.race === Race.ZERG) {
      const { foodRequired } = data.getUnitTypeData(unitType);
      if (foodRequired !== undefined) {
        GameState.getInstance().pendingFood -= foodRequired;
      }
    }
  }

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
  const overlappingBuilders = getAvailableBuilders(units).filter(otherBuilder => {
    const orderTargetPosition = getOrderTargetPosition(units, otherBuilder);
    return otherBuilder.tag !== builder.tag && orderTargetPosition && getDistance(orderTargetPosition, position) < 1.6;
  });

  if (overlappingBuilders.length > 0) {
    // overlappingBuilders.forEach(builder => builder.labels.delete("builder"));
    return [createUnitCommand(Ability.STOP, overlappingBuilders.map(builder => builder))];
  }

  return [];
}

// Exporting the functions
module.exports = {
  assignWorkersToBuild,
  stopOverlappingBuilders,
};
