const { interpretBuildOrderAction } = require('../../../data/buildOrders/buildOrderUtils');
const { isBuildOrderStep } = require('../../gameLogic/gameMechanics/gameStrategyUtils');
const { isEqualStep } = require('../../utils/strategyUtils');

/**
 * A type that includes both BuildOrderStep and StrategyStep.
 * @typedef {import('../../core/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} GeneralStep
 */


class StrategyData {
  constructor() {
    this.cumulativeTargetCounts = new Map();
  }

  /**
   * Calculate the cumulative target count for a specific step in the build order, separated by unit type.
   * This function calculates the cumulative counts up to and including the current step index,
   * ensuring that counts for each unit type are properly isolated per step.
   * @param {GeneralStep} step - The step to calculate the target count for.
   * @param {import('../../core/globalTypes').BuildOrder} buildOrder - The build order containing the steps.
   * @param {Record<string, number>} [startingUnitCounts={}] - An object mapping unit types to their initial counts.
   * @returns {Record<string, number>} - The cumulative target counts for each unit type in the specified step.
   */
  calculateTargetCountForStep(step, buildOrder, startingUnitCounts = {}) {
    const stepIndex = buildOrder.steps.findIndex(s => isEqualStep(s, step));
    const cumulativeCounts = { ...startingUnitCounts };

    for (let index = 0; index <= stepIndex; index++) {
      const currentStep = buildOrder.steps[index];
      StrategyData.getInterpretedActions(currentStep).forEach(action => {
        if (action.unitType !== null && !action.isUpgrade) {
          const unitTypeKey = `unitType_${action.unitType}`;
          const countKey = `${unitTypeKey}_step_${index}`;
          const previousKey = this.getLastStepKeyForUnitType(action.unitType, index - 1);
          const lastCount = previousKey ? this.getCumulativeTargetCount(previousKey) : (startingUnitCounts[unitTypeKey] || 0);

          cumulativeCounts[countKey] = lastCount + (action.count || 0);
          this.setCumulativeTargetCount(countKey, cumulativeCounts[countKey]);
        }
      });
    }

    // Filter to get the counts for the current step only
    return Object.fromEntries(Object.entries(cumulativeCounts).filter(([key]) => key.endsWith(`step_${stepIndex}`)));
  }

  /**
   * Checks if a given key exists in the shared data.
   * @param {string} key - The key to check in the cumulativeCounts object.
   * @returns {boolean} - True if the key exists, otherwise false.
   */
  checkIfKeyExists(key) {
    return this.cumulativeTargetCounts.has(key);
  }
  
  /**
   * Retrieve the cumulative target count for a specific step.
   * @param {string} step - The step identifier to retrieve the count for.
   * @returns {number} - The cumulative target count for the step.
   */
  getCumulativeTargetCount(step) {
    if (typeof step !== 'string') {
      console.error('Invalid step identifier:', step);
      return 0;
    }
    if (!this.cumulativeTargetCounts) {
      console.error('Data store is not initialized.');
      return 0;
    }
    return this.cumulativeTargetCounts.get(step) || 0;
  }

  /**
   * @param {import('../../core/globalTypes').BuildOrderStep | import('./strategyManager').StrategyStep} rawStep
   */
  static getInterpretedActions(rawStep) {
    if (rawStep.interpretedAction) {
      return Array.isArray(rawStep.interpretedAction) ? rawStep.interpretedAction : [rawStep.interpretedAction];
    } else {
      const comment = isBuildOrderStep(rawStep) ? rawStep.comment || '' : '';
      return interpretBuildOrderAction(rawStep.action, comment);
    }
  }

  /**
   * Retrieves the last cumulative count key for a given unit type up to a specified step.
   * This function checks for the presence of a specific cumulative count key and returns it if present.
   * If no key is found up to the specified last step, it returns null, indicating that no previous counts were recorded.
   * @param {number} unitType - The unit type identifier.
   * @param {number} lastStep - The last step to consider for retrieving the cumulative count.
   * @returns {string | null} - The key of the last step with the cumulative count for this unit type, or null if not found.
   */
  getLastStepKeyForUnitType(unitType, lastStep) {
    for (let step = lastStep; step >= 0; step--) {
      let key = `unitType_${unitType}_step_${step}`;
      if (this.checkIfKeyExists(key)) {
        return key;
      }
    }
    return null;
  }

  /**
   * Sets the cumulative target count for a specific step.
   * @param {string} unitTypeKey - A unique key representing the unit type.
   * @param {number} count - The cumulative count to set.
   */
  setCumulativeTargetCount(unitTypeKey, count) {
    // Check for validity of inputs
    if (typeof unitTypeKey !== 'string' || unitTypeKey.trim() === '') {
      console.error('Invalid unit type key:', unitTypeKey);
      return;
    }
    if (typeof count !== 'number' || isNaN(count)) {
      console.error('Invalid count provided for unit type key', unitTypeKey, ':', count);
      return;
    }

    // Set the count
    this.cumulativeTargetCounts.set(unitTypeKey, count);
  }
}

module.exports = StrategyData;
