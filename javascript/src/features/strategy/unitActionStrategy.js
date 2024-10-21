const { UnitType, Ability } = require("@node-sc2/core/constants");
const { Attribute } = require("@node-sc2/core/constants/enums");

const ActionStrategy = require("./actionStrategy");
const StrategyContext = require("./strategyContext");
const { getUnitTypeData } = require("../../core/gameData");
const { getPendingOrders } = require("../../services/sharedServices");
const { train } = require("../../units/management/training");
const { setPendingOrders } = require("../../units/management/unitOrders");
const { getUnitsById } = require("../../utils/unitUtils");
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
   * @param {Function} applyChronoBoost - The function to apply chrono boost, passed from strategyManager.js
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to perform the chrono boost.
   */
  static handleChronoBoostAction(world, planStep, applyChronoBoost) {
    const chronoBoostActions = /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */ ([]);

    const nexusUnits = getUnitsById(world, UnitType.NEXUS);
    if (!nexusUnits.length) return chronoBoostActions;

    const nexus = nexusUnits.reduce((maxNexus, currentNexus) =>
      (currentNexus.energy ?? 0) > (maxNexus.energy ?? 0) ? currentNexus : maxNexus
    );

    if (!nexus.tag) return chronoBoostActions;

    const unitTypeData = getUnitTypeData(world, planStep.unitType);
    const abilityId = unitTypeData?.abilityId;
    if (!abilityId) return chronoBoostActions;

    const availableAbilities = nexus.availableAbilities();
    if (!availableAbilities.includes(Ability.EFFECT_CHRONOBOOSTENERGYCOST)) return chronoBoostActions;

    const trainingUnit = world.resources.get().units.getStructures().find(unit =>
      unit.orders?.some(order => order.abilityId === abilityId)
    );

    if (!trainingUnit) return chronoBoostActions;

    const isChronoBoostPending = getPendingOrders(nexus).some(order =>
      order.abilityId === Ability.EFFECT_CHRONOBOOSTENERGYCOST
    );

    if (!isChronoBoostPending) {
      const chronoBoostAction = {
        abilityId: Ability.EFFECT_CHRONOBOOSTENERGYCOST,
        unitTags: [nexus.tag],
        targetUnitTag: trainingUnit.tag
      };

      setPendingOrders(nexus, chronoBoostAction);
      chronoBoostActions.push(chronoBoostAction);

      // Apply Chrono Boost by calling the passed function
      const stepIndex = StrategyContext.getInstance().getCurrentStep();
      if (planStep.unitType !== undefined) {
        applyChronoBoost(world, planStep.unitType, stepIndex);
      } else {
        console.error(`Unit type is undefined for plan step`);
      }
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

