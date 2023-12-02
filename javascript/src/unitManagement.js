//@ts-check
"use strict";

// Import necessary modules or constants
// Include imports that are required by the functions being moved to this module.
// For example:
// const { Unit, World, Point2D, SC2APIProtocol } = require('...');

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

// Other shared functions
// For example, if there are other functions in constructionUtils.js and buildingPlacement.js 
// that are used by both modules, they should be moved here as well.

module.exports = {
  handleNonRallyBase,
  // Export other functions that are defined in this module
};
