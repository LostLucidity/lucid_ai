const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

/**
 * Class to manage gas mine worker assignments.
 */
class GasMineManager {
  /** @type {Map<string, Set<string>>} */
  gasMineWorkers = new Map();

  /** @type {GasMineManager|null} */
  static instance = null;

  constructor() {
    if (GasMineManager.instance) {
      return GasMineManager.instance;
    }
    GasMineManager.instance = this;
  }

  /**
   * Returns the singleton instance of the GasMineManager.
   * @returns {GasMineManager} The singleton instance.
   */
  static getInstance() {
    if (!GasMineManager.instance) {
      GasMineManager.instance = new GasMineManager();
    }
    return GasMineManager.instance;
  }

  /**
   * Assigns a worker to a gas mine.
   * @param {string} workerTag - The tag of the worker.
   * @param {string} mineTag - The tag of the mine.
   */
  assignWorkerToMine(workerTag, mineTag) {
    if (mineTag && workerTag) {
      if (!this.gasMineWorkers.has(mineTag)) {
        this.gasMineWorkers.set(mineTag, new Set());
      }
      const workersSet = this.gasMineWorkers.get(mineTag);
      if (workersSet) {
        workersSet.add(workerTag);
      }
    }
  }

  /**
   * Counts the workers presumed inside gas mines.
   * @param {World} world - The current game world state.
   * @returns {number} Count of workers presumed inside gas mines.
   */
  countWorkersInsideGasMines(world) {
    const { units } = world.resources.get();
    const gasMines = units.getAll(Alliance.SELF).filter(unit => unit.isGasMine());
    const allWorkers = new Map(units.getAll(Alliance.SELF).filter(worker => worker.isWorker() && worker.tag).map(worker => [worker.tag, worker]));

    let totalInside = 0;

    gasMines.forEach(mine => {
      if (mine.tag) { // Ensure mine.tag is defined
        const assignedWorkers = this.gasMineWorkers.get(mine.tag) || new Set();

        // Count workers that are assigned to this mine, currently visible and active
        let visibleWorkersCount = 0;
        assignedWorkers.forEach(workerTag => {
          const worker = allWorkers.get(workerTag);
          if (worker && worker.isCurrent() && (worker.isGathering('vespene') || worker.isReturning('vespene'))) {
            visibleWorkersCount++;
          }
        });

        // Ensure assigned workers count does not exceed gasMine.assignedHarvesters
        const assignedCount = Math.min(assignedWorkers.size, mine.assignedHarvesters || 0);

        // Calculate the number of workers inside the gas mine
        const insideWorkers = Math.max(0, assignedCount - visibleWorkersCount);
        totalInside += Math.min(insideWorkers, 1); // Ensure no more than 1 inside worker per mine
      }
    });

    return totalInside;
  }

  /**
   * Initializes the manager with default settings.
   * @param {World} world - The initial game world state, if needed for setup.
   */
  initialize(world) {
    console.log('Initializing GasMineManager with default settings.');
    const { units } = world.resources.get();
    const gasMines = units.getAll(Alliance.SELF).filter(unit => unit.isGasMine());

    gasMines.forEach(mine => {
      if (mine.tag) { // Ensure mine.tag is defined
        this.gasMineWorkers.set(mine.tag, new Set());
      }
    });
  }

  /**
   * Removes a worker from a gas mine.
   * @param {string} workerTag - The tag of the worker.
   * @param {string} mineTag - The tag of the mine.
   */
  removeWorkerFromMine(workerTag, mineTag) {
    if (mineTag && this.gasMineWorkers.has(mineTag)) {
      const workersSet = this.gasMineWorkers.get(mineTag);
      if (workersSet) {
        workersSet.delete(workerTag);
      }
    }
  }

  /**
   * Determines whether a worker should be assigned to a particular gas mine based on orders and possibly proximity.
   * @param {Unit} worker - The worker unit to evaluate.
   * @param {Unit} mine - The gas mine unit to evaluate.
   * @returns {boolean} - Returns true if the worker is assigned to the mine based on specific orders.
   */
  static shouldAssignWorkerToMine(worker, mine) {
    if (worker.orders && worker.orders.length > 0) {
      return worker.orders.some(order =>
        order.targetUnitTag === mine.tag &&
        order.abilityId !== undefined && // Ensure abilityId is defined
        gatheringAbilities.includes(order.abilityId)
      );
    }
    return false;
  }

  /**
   * Updates the state of gas mine workers based on current visibility and assignment.
   * @param {World} world - The current game world state.
   */
  update(world) {
    const { units } = world.resources.get();
    const allWorkers = units.getAll(Alliance.SELF).filter(unit => unit.isWorker());
    const allMines = units.getAll(Alliance.SELF).filter(unit => unit.isGasMine());

    allMines.forEach(mine => {
      if (mine.tag) { // Ensure mine.tag is defined
        const currentAssignedWorkers = this.gasMineWorkers.get(mine.tag) || new Set();

        allWorkers.forEach(worker => {
          if (worker.tag) { // Ensure worker.tag is defined
            const isGathering = worker.isGathering('vespene') && worker.orders && worker.orders.some(order => order.targetUnitTag === mine.tag);
            const isReturning = worker.isReturning('vespene') && currentAssignedWorkers.has(worker.tag);

            if (isGathering || isReturning) {
              currentAssignedWorkers.add(worker.tag);
            } else {
              currentAssignedWorkers.delete(worker.tag);
            }
          }
        });

        this.gasMineWorkers.set(mine.tag, currentAssignedWorkers);
      }
    });
  }
}

module.exports = GasMineManager;
