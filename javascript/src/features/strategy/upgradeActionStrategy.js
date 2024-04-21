const ActionStrategy = require("./actionStrategy");
const { upgrade } = require("../../utils/unit/unitManagement");

// Concrete strategy for handling upgrade actions
class UpgradeActionStrategy extends ActionStrategy {
  /**
   * Execute action strategy for upgrading.
   * @param {World} _world World context, unused but required for interface compatibility.
   * @param {import("./strategyManager").PlanStep} planStep Details of the plan step to execute.
   * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} Array of actions to be performed.
   */
  execute(_world, planStep) {
    console.log("Executing UpgradeActionStrategy for", planStep);
    // Implementation logic for upgrades
    return [];
  }

  /**
   * Handles the actual upgrade action.
   * @param {World} world The game world context.
   * @param {import("./strategyManager").PlanStep} planStep Details of the plan step.
   * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} Array of actions to be performed.
   */
  handleUpgradeAction(world, planStep) {
    if (planStep.upgrade === undefined || planStep.upgrade === null) {
      console.log("No upgrade specified.");
      return [];
    }
    return upgrade(world, planStep.upgrade);
  }
}

module.exports = { UpgradeActionStrategy };
