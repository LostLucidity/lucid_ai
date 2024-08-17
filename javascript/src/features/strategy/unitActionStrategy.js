const { UnitType, Ability } = require("@node-sc2/core/constants");
const { Attribute } = require("@node-sc2/core/constants/enums");

const ActionStrategy = require("./actionStrategy");
const { getUnitTypeData } = require("../../core/gameData");
const { getUnitsById } = require("../../core/unitUtils");
const { getPendingOrders } = require("../../sharedServices");
const { train } = require("../../units/management/training");
const { setPendingOrders } = require("../../units/management/unitOrders");
const { build } = require("../construction/buildingService");

// Concrete strategy for handling unit type actions
class UnitActionStrategy extends ActionStrategy {
  /**
   * Executes unit type actions based on the provided world and plan step.
   * @param {World} world - The game world context, used for action decisions.
   * @param {import("./strategyManager").PlanStep} planStep - The plan step to execute.
   * @returns {any} Result of the unit type action.
   */
  static execute(world, planStep) {
    return UnitActionStrategy.handleUnitTypeAction(world, planStep);
  }

  /**
   * Handle the chrono boost action for the current plan step.
   * @param {World} world - The current game world context.
   * @param {import("./strategyManager").PlanStep} planStep - The current step in the plan to be executed.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to perform the chrono boost.
   */
  static handleChronoBoostAction(world, planStep) {
    const chronoBoostActions = /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */ ([]);

    // Get all Nexus units and exit early if there are none
    const nexusUnits = getUnitsById(world, UnitType.NEXUS);
    if (!nexusUnits.length) return chronoBoostActions;

    // Select the Nexus with the highest energy
    const nexus = nexusUnits.reduce((maxNexus, currentNexus) =>
      (currentNexus.energy ?? 0) > (maxNexus.energy ?? 0) ? currentNexus : maxNexus
    );

    // Exit early if the selected Nexus doesn't have a tag
    if (!nexus.tag) return chronoBoostActions;

    // Get the ability ID for the unit type specified in the plan step
    const unitTypeData = getUnitTypeData(world, planStep.unitType);
    const abilityId = unitTypeData?.abilityId;

    // Exit early if there's no ability ID
    if (!abilityId) return chronoBoostActions;

    // Check if the Nexus has the Chrono Boost ability available
    const availableAbilities = nexus.availableAbilities();
    if (!availableAbilities.includes(Ability.EFFECT_CHRONOBOOSTENERGYCOST)) return chronoBoostActions;

    // Find the structure that is training the specified unit type
    const trainingUnit = world.resources.get().units.getStructures().find(unit =>
      unit.orders?.some(order => order.abilityId === abilityId)
    );

    // Exit early if there's no training unit
    if (!trainingUnit) return chronoBoostActions;

    // Check if Chrono Boost is already pending
    const isChronoBoostPending = getPendingOrders(nexus).some(order =>
      order.abilityId === Ability.EFFECT_CHRONOBOOSTENERGYCOST
    );

    // Add Chrono Boost action if it's not already pending
    if (!isChronoBoostPending) {
      const chronoBoostAction = {
        abilityId: Ability.EFFECT_CHRONOBOOSTENERGYCOST,
        unitTags: [nexus.tag],
        targetUnitTag: trainingUnit.tag
      };

      // Set pending orders for the Nexus unit and add the action to the list
      setPendingOrders(nexus, chronoBoostAction);
      chronoBoostActions.push(chronoBoostAction);
    }

    return chronoBoostActions;
  }

  /**
   * @param {World} world
   * @param {{ supply?: number | undefined; time?: string | undefined; action?: string | undefined; orderType?: any; unitType: any; targetCount: any; upgrade?: any; isChronoBoosted?: any; count?: any; candidatePositions: any; food?: number | undefined; }} planStep
   */
  static handleUnitTypeAction(world, planStep) {
    const { data } = world;
    if (planStep.unitType === undefined || planStep.unitType === null) return [];
    const { attributes } = data.getUnitTypeData(planStep.unitType);
    if (attributes === undefined) return [];

    const isStructure = attributes.includes(Attribute.STRUCTURE);
    return isStructure ? build(world, planStep.unitType, planStep.targetCount, planStep.candidatePositions) : train(world, planStep.unitType, planStep.targetCount);
  }
}

module.exports = UnitActionStrategy;

