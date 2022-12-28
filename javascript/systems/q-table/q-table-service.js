//@ts-check
"use strict"

const { Attribute } = require("@node-sc2/core/constants/enums");
const { getAllActions } = require("../../services/data-service");
const { build, train } = require("../execute-plan/plan-actions");

/** @typedef { { step: number, foodUsed: number } } State */

const qTableService = {
  alpha: 0.1,
  epsilon: 0.1,
  gamma: 0.9,
  /** @type {number[][]} */
  Q: [],
  /** @type { number[] } */
  steps: [],
  /** @type { State[] } */
  states: [],
  /**
   * @param {number} stateIndex
   * @param {Map<number, any>} availableAbilities
   * @returns {number}
   */
  chooseAction(stateIndex, availableAbilities) {
    const { Q, epsilon } = qTableService;
    const allActions = getAllActions();
    const actionsAvailable = allActions.filter(action => availableAbilities.has(action));
    if (Math.random() < epsilon) {
      const randomAction = actionsAvailable[Math.floor(Math.random() * actionsAvailable.length)];
      return allActions.indexOf(randomAction);
    }
    const actionValues = Q[stateIndex];
    // get the index of the action with the highest value from actionsAvailable
    const actionIndex = actionValues.reduce((maxIndex, value, index, array) => {
      if (actionsAvailable.includes(allActions[index]) && value > array[maxIndex]) {
        return index;
      }
      return maxIndex;
    }, 0);
    return actionIndex;
  },
  /**
   * @param {World} world
   * @param {number} action
   * @param {Map<number, { "orderType": "UnitType" | "Upgrade", "unitType"?: number, "upgradeType"?: number }>} availableActions
   */
  async executeAction(world, action, availableActions) {
    const { data } = world;
    const { steps } = qTableService;
    steps.push(action);
    const actionData = availableActions.get(action); if (!actionData) { return; }
    if (actionData.orderType === 'UnitType') {
      const { unitType } = actionData; if (!unitType) { return; }
      const { attributes } = data.getUnitTypeData(unitType);
      if (attributes === undefined) return;
      if (attributes.includes(Attribute.STRUCTURE)) {
        await build(world, unitType);
      } else {
        await train(world, unitType);
      }
    }
  },
  /**
   * @param {State} currentState
   * @returns {number}
   */
  getStateIndex(currentState) {
    const { states } = qTableService;
    const stateIndex = states.findIndex(state => state.step === currentState.step && state.foodUsed === currentState.foodUsed);
    if (stateIndex === -1) {
      states.push(currentState);
      // push a new row to the Q table with all random values
      const randomActionValues = Array(getAllActions().length).fill(0).map(() => Math.random());
      qTableService.Q.push(randomActionValues);
      return states.length - 1;
    }
    return stateIndex;
  }
}
module.exports = qTableService;