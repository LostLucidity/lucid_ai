const { Ability } = require("@node-sc2/core/constants");

const { getFoodUsedByUnitType, createUnitCommand } = require("../../core/common");
const { getUnitBeingTrained, isStructureLifted, canStructureLiftOff } = require("../../core/commonUnitUtils");
const { getPendingOrders } = require("../../services/sharedServices");
const { GameState } = require("../../state");
const { getPlanFoodValue } = require("../../utils/strategyUtils");

/**
 * Prepares a unit to build an addon, handling various commands based on the unit's state.
 * Consolidates command creation to reduce redundancy and streamline the decision-making process.
 * @param {World} world - The game world context.
 * @param {Unit} unit - The unit to prepare.
 * @param {Point2D | undefined} targetPosition - The target position for landing if needed.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function prepareUnitToBuildAddon(world, unit, targetPosition) {
  const { agent, data } = world;
  if (agent.foodUsed === undefined) return [];

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const unitBeingTrained = getUnitBeingTrained(unit);
  const foodUsedByTrainingUnit = unitBeingTrained ? getFoodUsedByUnitType(data, unitBeingTrained) : 0;
  const gameState = GameState.getInstance();
  const planFoodValue = getPlanFoodValue(gameState);
  const hasPendingOrders = getPendingOrders(unit).length === 0;

  if (!unit.isIdle() || !hasPendingOrders) return collectedActions;  // Exit early if unit is busy or has pending orders

  handleLiftAndLandActions(unit, targetPosition, collectedActions);

  // Cancel training if not enough food available
  if ((agent.foodUsed - foodUsedByTrainingUnit) < planFoodValue) {
    collectedActions.push(createUnitCommand(Ability.CANCEL_QUEUE5, [unit]));
  }

  return collectedActions;
}

/**
 * Handles lift and land commands based on the unit's ability to lift off and the target position availability.
 * @param {Unit} unit - The unit being manipulated.
 * @param {Point2D | undefined} targetPosition - The target position for landing.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} actions - Collection of actions to execute.
 */
function handleLiftAndLandActions(unit, targetPosition, actions) {
  if (canStructureLiftOff(unit)) {
    actions.push(createUnitCommand(Ability.LIFT, [unit]));
  }
  if (isStructureLifted(unit) && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    actions.push(landCommand);
  }
}

module.exports = {
  prepareUnitToBuildAddon,
};
