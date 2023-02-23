//@ts-check
"use strict"

const fs = require('fs');
const { Attribute } = require("@node-sc2/core/constants/enums");
const { getAllActions } = require("../../services/data-service");
const planService = require("../../services/plan-service");
const { train, getStep, getUnitTypeCount, build, upgrade } = require("../../services/world-service");
const path = require('path');

/** @typedef { { step: number } } State */

const qTableService = {
  alpha: 0.1,
  epsilon: 1 / 2 ** 12,
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
   * @param {Map<number, import("../../interfaces/actions-map").ActionsMap>} availableActions
   */
  async executeAction(world, action, availableActions) {
    const { agent, data } = world;
    const { foodUsed } = agent; if (!foodUsed) { return; }
    const { steps } = qTableService;
    steps.push(action);
    const actionData = availableActions.get(action); if (!actionData) { return; }
    const { orderType, unitType, upgrade: upgradeType } = actionData; if (!(orderType !== undefined && (unitType !== undefined || upgradeType !== undefined))) { return; }
    if (orderType === 'UnitType' && unitType !== undefined) {
      const matchingStep = getStep(world, unitType);
      if (!matchingStep) {
        planService.plan.push({
          orderType, unitType, food: foodUsed, targetCount: getUnitTypeCount(world, unitType)
        });
        planService.currentStep = planService.plan.length - 1;
        const { attributes } = data.getUnitTypeData(unitType);
        if (attributes === undefined) return;
        if (attributes.includes(Attribute.STRUCTURE)) {
          await build(world, unitType);
        } else {
          await train(world, unitType);
        }
      }
    } else if (orderType === 'Upgrade' && upgradeType !== undefined) {
      planService.plan.push({
        orderType, upgrade: upgradeType, food: foodUsed
      });
      await upgrade(world, upgradeType);
    }
  },
  getQTable() {
    const qtable = fs.readFileSync(path.join(__dirname, 'data', 'q-table.json'), 'utf8');
    if (!qtable) {
      return [];
    }
    return JSON.parse(qtable);
  },
  /**
   * @param {State} currentState
   * @returns {number}
   */
  getStateIndex(currentState) {
    const { epsilon, Q, states } = qTableService;
    if (!states.some(state => state.step === currentState.step)) {
      states.push(currentState);
    }
    if (Q[currentState.step] === undefined) {
      const randomActionValues = Array(getAllActions().length).fill(0).map((_value, index) => index === 0 ? 1 - (epsilon * 2) : Math.random());
      Q[currentState.step] = [...randomActionValues];
    }
    const stateIndex = states.findIndex(state => state.step === currentState.step);
    return stateIndex;
  },
  saveQTable() {
    const { Q } = qTableService;
    if (Q.length === 0) {
      return;
    }
    fs.writeFileSync(path.join(__dirname, 'data', 'q-table.json'), JSON.stringify(Q), 'utf8');
  },
  /**
   * @param {boolean} result
   * @returns {void}
   */
  updateQTable(result) {
    const { alpha, gamma, Q, steps, states } = qTableService;
    const reward = result ? 1 : -1;
    for (let i = 0; i < steps.length; i++) {
      const stateIndex = qTableService.getStateIndex(states[i]);
      const action = steps[i];
      const actionIndex = getAllActions().indexOf(action);
      const maxQ = Math.max(...Q[stateIndex]);
      Q[stateIndex][actionIndex] += alpha * (reward + gamma * maxQ - Q[stateIndex][actionIndex]);
    }
  },
}
module.exports = qTableService;