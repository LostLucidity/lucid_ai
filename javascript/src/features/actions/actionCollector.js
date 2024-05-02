const { UnitType, Ability } = require("@node-sc2/core/constants");

const { shouldTrainMoreWorkers, calculateMaxWorkers, trainAdditionalWorkers } = require("../../gameLogic/utils/economy/economyManagement");
const { reassignIdleWorkers, balanceWorkerDistribution } = require("../../gameLogic/utils/economy/workerAssignment");
const { GameState } = require("../../gameState");
const GasMineManager = require("../../gameState/GasMineManager");
const { refreshProductionUnitsCache } = require("../../units/management/unitManagement");
const { buildSupply } = require("../construction/buildingService");
const StrategyManager = require("../strategy/strategyManager");

class ActionCollector {
  /**
   * Creates an instance of ActionCollector.
   * @param {World} world - The current game world state.
   */
  constructor(world) {
    this.world = world;
    this.gameState = GameState.getInstance();
    this.gasMineManager = new GasMineManager();
    this.maxWorkers = 0;  // Define maxWorkers as a property of the class
  }

  /**
   * Collects all actions based on game state and strategy.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} Array of actions to execute.
   */
  collectActions() {
    this.updateManagers(); // Ensure managers are updated right before actions are collected

    const { units } = this.world.resources.get();
    let actionCollection = [
      ...this.handleStrategicActions(this.world),
      ...this.collectLowerDepotActions(this.world)
    ];

    if (units.getIdleWorkers().length > 0) {
      actionCollection.push(...reassignIdleWorkers(this.world));
    }

    if (!StrategyManager.getInstance().isActivePlan()) {
      actionCollection.push(...this.collectAdditionalActions(this.world));
    }

    return actionCollection;
  }

  /**
   * Collects additional actions necessary for maintaining the economy and infrastructure.
   * @param {World} world - The current game world state.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - A collection of additional actions.
   */
  collectAdditionalActions(world) {
    const { units } = world.resources.get();
    const actions = [];

    // Balance worker distribution across bases for optimal resource gathering
    actions.push(...balanceWorkerDistribution(world, units, world.resources));

    // Ensure sufficient supply to support unit production
    actions.push(...buildSupply(world));

    // Train additional workers to maximize resource collection, if under the maximum worker limit
    if (shouldTrainMoreWorkers(units.getWorkers().length, this.maxWorkers)) {
      actions.push(...trainAdditionalWorkers(world, world.agent, units.getBases()));
    }

    return actions;
  }

  /**
   * Collects actions to lower SUPPLYDEPOTS that may be blocking paths.
   * @param {World} world - The current game world state.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of actions to lower SUPPLYDEPOTS.
   */
  collectLowerDepotActions(world) {
    const { units } = world.resources.get();
    const depots = units.getByType(UnitType.SUPPLYDEPOT).filter(depot => depot.buildProgress !== undefined && depot.buildProgress >= 1);

    return depots.reduce((actions, depot) => {
      actions.push(...this.prepareLowerSupplyDepotAction(world, depot));
      return actions;
    }, /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */([]));
  }

  /**
   * Handles strategic actions based on the bot's current plan.
   * @param {World} world - The current game world state.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - A collection of strategic actions.
   */
  handleStrategicActions(world) {
    const strategyManager = StrategyManager.getInstance();

    // Check if there is an active strategic plan.
    if (strategyManager.isActivePlan()) {
      // If there is an active plan, execute it and return the resulting actions.
      return strategyManager.runPlan(world);
    } else {
      // If there is no active plan, return an empty array indicating no actions.
      return [];
    }
  }

  /**
   * Prepares an action to lower a SUPPLYDEPOT if it blocks the worker's path.
   * @param {World} world - The current game world state.
   * @param {Unit} depot - The SUPPLYDEPOT unit that needs to be lowered.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of actions to lower the SUPPLYDEPOT.
   */
  prepareLowerSupplyDepotAction(world, depot) {
    // Check if the depot is already lowered
    // We use available abilities to determine if it can be lowered.
    const depotAbilities = depot.availableAbilities();
    const canLower = depotAbilities.includes(Ability.MORPH_SUPPLYDEPOT_LOWER);

    if (!canLower || !depot.tag) {
      return []; // Return empty array as no action is needed, or tag is undefined.
    }

    // Prepare the lower command action
    const lowerDepotCommand = {
      abilityId: Ability.MORPH_SUPPLYDEPOT_LOWER,
      unitTags: [depot.tag], // Now guaranteed to be defined
    };

    // Return the action in an array for later execution
    return [lowerDepotCommand];
  }

  updateManagers() {
    this.gasMineManager.update(this.world);
    this.gameState.updateGameState(this.world);
    refreshProductionUnitsCache();
  }

  /**
   * Updates the maximum number of workers based on current game conditions.
   * This should be called at an appropriate point in the game loop to ensure maxWorkers is always updated.
   */
  updateMaxWorkers() {
    const { units } = this.world.resources.get();
    this.maxWorkers = calculateMaxWorkers(units); // Assuming calculateMaxWorkers() is an available method
  }  
}

module.exports = ActionCollector;
