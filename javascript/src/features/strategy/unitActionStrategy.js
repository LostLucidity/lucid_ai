const { Attribute } = require("@node-sc2/core/constants/enums");

const ActionStrategy = require("./actionStrategy");
const { train } = require("../../units/management/training");
const { build } = require("../construction/buildingService");

// Concrete strategy for handling unit type actions
class UnitActionStrategy extends ActionStrategy {
  /**
   * Executes unit type actions based on the provided world and plan step.
   * @param {World} world - The game world context, used for action decisions.
   * @param {import("./strategyManager").PlanStep} planStep - The plan step to execute.
   * @returns {any} Result of the unit type action.
   */
  execute(world, planStep) {
    return this.handleUnitTypeAction(world, planStep);
  }

  /**
   * @param {World} world
   * @param {{ supply?: number | undefined; time?: string | undefined; action?: string | undefined; orderType?: any; unitType: any; targetCount: any; upgrade?: any; isChronoBoosted?: any; count?: any; candidatePositions: any; food?: number | undefined; }} planStep
   */
  handleUnitTypeAction(world, planStep) {
    const { data } = world;
    if (planStep.unitType === undefined || planStep.unitType === null) return [];
    const { attributes } = data.getUnitTypeData(planStep.unitType);
    if (attributes === undefined) return [];

    const isStructure = attributes.includes(Attribute.STRUCTURE);
    return isStructure ? build(world, planStep.unitType, planStep.targetCount, planStep.candidatePositions) : train(world, planStep.unitType, planStep.targetCount);
  }
}

module.exports = UnitActionStrategy;

