const { calculateMaxWorkers, shouldTrainMoreWorkers, trainAdditionalWorkers } = require("./economyManagement");
const { distributeWorkersAcrossBases } = require("./workerAssignment");
const config = require("../../../config/config");

class EconomicManager {
  /**
   * Creates an instance of EconomicManager.
   * @param {World} world - The current game world state.
   */
  constructor(world) {
    /** @type {World} */
    this.world = world;
    /** @type {UnitResource} */
    this.units = world.resources.get().units;
    /** @type {number} */
    this.maxWorkers = 0;
  }

  /**
   * Balances the distribution of workers across resources for optimal resource gathering.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} Actions to balance worker distribution.
   */
  balanceWorkerDistribution() {
    const averageGatheringTime = config.getAverageGatheringTime();
    return distributeWorkersAcrossBases(this.world, this.units, this.world.resources, averageGatheringTime);
  }

  /**
   * Collects all economic actions needed for the current game step.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A collection of economic actions.
   */
  collectEconomicActions() {
    let actions = [];

    this.updateMaxWorkers();
    actions.push(...this.balanceWorkerDistribution());

    if (this.units.getWorkers().length < this.maxWorkers) {
      actions.push(...this.trainAdditionalWorkers());
    }

    return actions;
  }
  /**
   * Trains additional workers if the current number is below the maximum.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} Actions to train additional workers.
   */
  trainAdditionalWorkers() {
    if (shouldTrainMoreWorkers(this.units.getWorkers().length, this.maxWorkers)) {
      return trainAdditionalWorkers(this.world, this.world.agent, this.units.getBases());
    }
    return [];
  }

  /**
   * Updates the maximum number of workers based on current economic conditions.
   */
  updateMaxWorkers() {
    this.maxWorkers = calculateMaxWorkers(this.units);
  }
}

module.exports = EconomicManager;
