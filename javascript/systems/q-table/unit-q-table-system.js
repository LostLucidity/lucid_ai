//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const dataService = require("../../services/data-service");
const unitQTableService = require("./unit-q-table-service");
const { Alliance, AbilityDataTarget } = require("@node-sc2/core/constants/enums");

module.exports = createSystem({
  name: 'UnitQTableSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 2 ** 1,
  },
  async onGameStart(world) {
    const { data } = world;
    dataService.setGameData(data);
    unitQTableService.Q = await unitQTableService.getQTable();
    await executeQLearning(world);
  },
  async onStep(world) {
    await executeQLearning(world);
  }
});

/**
 * @param {World} world
 * @returns {Promise<void>}
 */
async function executeQLearning(world) {
  const { units } = world.resources.get();
  const selfUnits = units.getAlive(Alliance.SELF);

  for (const unit of selfUnits) { // Loop through each unit
    const currentState = getState(unit); // Define a function that gets a unit's state
    const currentAction = unitQTableService.getBestAction(unit, currentState); // Choose action
    await performAction(unit, currentAction); // Define a function that performs the action

    const newState = getState(unit); // Get the new state after the action
    const reward = getReward(unit, newState); // Define a function that calculates the reward
    unitQTableService.updateQValue(unit, currentState, currentAction, reward, newState); // Update Q-Value
  }
}

// Here's a very simplified version of getState. You'll need to flesh this out with real logic.
/**
 * @param {Unit} unit
 * @returns {{ health: number, type: number, position: Point2D }}
 */
function getState(unit) {
  // A state could be a combination of different parameters. For example, unit's health, type, position etc.
  const state = {
    health: unit.health ?? 0,
    type: unit.unitType ?? 0,
    position: unit.pos ?? { x: 0, y: 0 },
  };

  // Add the state of potential targets to the state
  for (let i = 0; i < potentialTargets.length; i++) {
    const target = potentialTargets[i];
    state['target' + i] = {
      health: target.health,
      type: target.unitType,
      position: target.pos
    };
  }

  return state;
}

/**
 * Perform the chosen action on a unit.
 *
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {number} action
 * @returns {SC2APIProtocol.ActionRawUnitCommand}
 */
function performAction(data, unit, action) {
  // Get ability data
  const abilityData = data.getAbilityData(action);

  // Check if unit.tag is not undefined.
  if (unit.tag !== undefined) {
    const command = {
      abilityId: action,  // The action corresponds to the abilityId.
      unitTags: [unit.tag],  // The action is performed by this unit.
    };

    // Check the target type of the action.
    switch (abilityData.target) {
      case AbilityDataTarget.NONE:
        // No target is needed.
        break;
      case AbilityDataTarget.POINT:
      case AbilityDataTarget.POINTORNONE:
      case AbilityDataTarget.POINTORUNIT:
        // The action requires a target position.
        command.targetWorldSpacePos = unit.pos; // This is a simplified example. You would set the actual target position here.
        break;
      case AbilityDataTarget.UNIT:
        // The action requires a target unit. You would set the actual target unit tag here.
        // As a placeholder, we are using the same unit tag.
        command.targetUnitTag = unit.tag;
        break;
    }

    return command;
  } else {
    // Handle the case where unit.tag is undefined.
    throw new Error("Unit tag is undefined");
  }
}


