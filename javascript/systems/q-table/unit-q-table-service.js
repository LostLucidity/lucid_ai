//@ts-check
"use strict"

const fs = require('fs');
const path = require('path');

const unitQTableService = {
  /**
   * @param {Unit} unit
   * @param {{ health: number, type: number, position: Point2D }} state
   */
  getBestAction(unit, state) {
    const epsilon = 0.1; // Probability of choosing a random action.

    // Get the list of available actions for the unit.
    const availableActions = unit.availableAbilities();

    // With probability epsilon, choose a random action from the available actions.
    if (Math.random() < epsilon) {
      const randomAction = availableActions[Math.floor(Math.random() * availableActions.length)];
      return randomAction;
    }

    // Otherwise, choose the action with the highest Q-value for the current state.
    let maxQValue = -Infinity;
    let bestAction = null;
    for (const action of availableActions) {
      const qValue = unitQTableService.getQValue(unit, state, action);
      if (qValue > maxQValue) {
        maxQValue = qValue;
        bestAction = action;
      }
    }

    return bestAction;
  },
  getQTable() {
    const qtable = fs.readFileSync(path.join(__dirname, 'data', 'unit-q-table.json'), 'utf8');
    if (!qtable) {
      return [];
    }
    return JSON.parse(qtable);
  },
  /**
   * Gets the Q-value for a given unit, state, and action.
   *
   * @param {Unit} unit
   * @param {{ health: number, type: number, position: Point2D }} state
   * @param {number} action
   * @returns {number} The Q-value.
   */
  getQValue(unit, state, action) {
    const stateActionKey = createStateActionKey(unit, state, action);

    if (!(stateActionKey in this.Q)) {
      this.Q[stateActionKey] = 0;
    }

    return this.Q[stateActionKey];
  }
}

module.exports = unitQTableService;

/**
 * Creates a unique key representing a state-action pair for a given unit.
 *
 * @param {Unit} unit
 * @param {{ health: number, type: number, position: Point2D }} state
 * @param {number} action
 * @returns {string} The state-action key.
 */
function createStateActionKey(unit, state, action) {
  const stateString = `${state.health},${state.type},${state.position.x},${state.position.y}`;
  const stateActionKey = `${unit.tag}-${stateString}-${action}`;

  return stateActionKey;
}
