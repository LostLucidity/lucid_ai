const { Ability } = require("@node-sc2/core/constants");

const { getFoodUsedByUnitType, createUnitCommand } = require("../../../core/utils/common");
const { getUnitBeingTrained, isStructureLifted, canStructureLiftOff } = require("../../../core/utils/commonUnitUtils");
const { getPlanFoodValue } = require("../../../features/strategy/strategyUtils");
const { GameState } = require("../../../gameState");
const { getPendingOrders } = require("../../../sharedServices");
const { getSingletonInstance } = require("../../unit/singletonFactory");


/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D | undefined} targetPosition
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function prepareUnitToBuildAddon(world, unit, targetPosition) {
  const { agent, data } = world;
  const { foodUsed } = agent;
  if (foodUsed === undefined) return [];

  const collectedActions = [];

  const currentFood = foodUsed;
  const unitBeingTrained = getUnitBeingTrained(unit); // Placeholder function
  const foodUsedByTrainingUnit = unitBeingTrained ? getFoodUsedByUnitType(data, unitBeingTrained) : 0;

  // Retrieve the singleton instance of GameState
  const gameState = getSingletonInstance(GameState);
  // Pass the retrieved GameState instance
  const plan = getPlanFoodValue(gameState);

  if (unit.isIdle() && getPendingOrders(unit).length === 0 && isStructureLifted(unit) && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    landCommand.targetWorldSpacePos = targetPosition;
    collectedActions.push(landCommand);
  }

  if (canStructureLiftOff(unit) && getPendingOrders(unit).length === 0) {
    const liftCommand = createUnitCommand(Ability.LIFT, [unit]);
    collectedActions.push(liftCommand);
  }

  if (isStructureLifted(unit) && getPendingOrders(unit).length === 0 && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    landCommand.targetWorldSpacePos = targetPosition;
    collectedActions.push(landCommand);
  }

  if (!unit.isIdle() && getPendingOrders(unit).length === 0 && (currentFood - foodUsedByTrainingUnit >= plan)) {
    const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [unit]);
    collectedActions.push(cancelCommand);
  }

  return collectedActions;
}

module.exports = {
  prepareUnitToBuildAddon,
};