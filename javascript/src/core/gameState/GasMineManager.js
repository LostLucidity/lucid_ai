// GasMineManager.js

const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

/**
 * Class to manage gas mine worker assignments.
 */
class GasMineManager {
  /** @type {Map<string, Set<string>>} */
  gasMineWorkers = new Map();  // Initialize directly here

  /** @type {GasMineManager|null} */
  static instance = null;

  constructor() {
    if (GasMineManager.instance) {
      return GasMineManager.instance;
    }
    GasMineManager.instance = this;
  }

  /**
   * Assigns a worker to a gas mine.
   * @param {string} workerTag - The tag of the worker.
   * @param {string} mineTag - The tag of the mine.
   */
  assignWorkerToMine(workerTag, mineTag) {
    if (mineTag && workerTag) { // Ensure tags are defined
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
    let presumedInside = 0;

    gasMines.forEach(mine => {
      if (mine.tag) {
        const assignedWorkers = this.gasMineWorkers.get(mine.tag) || new Set();
        const visibleWorkers = units.getAll(Alliance.SELF).filter(worker => {
          return worker.isWorker() && worker.isGathering('vespene') && worker.tag && assignedWorkers.has(worker.tag);
        }).length;

        if (assignedWorkers.size > visibleWorkers) {
          presumedInside += (assignedWorkers.size - visibleWorkers);
        }
      }
    });

    return presumedInside;
  }

  /**
   * Initializes the manager with default settings.
   * @param {World} world - The initial game world state, if needed for setup.
   */
  initialize(world) {
    console.log('Initializing GasMineManager with default settings.');
    // Example: Pre-load known gas mines from the game map or configuration
    const { units } = world.resources.get();
    const gasMines = units.getAll(Alliance.SELF).filter(unit => unit.isGasMine());

    // Set up the gas mine workers map with empty sets for each mine
    gasMines.forEach(mine => {
      if (mine.tag) {
        this.gasMineWorkers.set(mine.tag, new Set());
      }
    });

    // Additional setup logic can go here
    // This might include setting defaults, pre-calculating values, etc.
  }

  /**
   * Removes a worker from a gas mine.
   * @param {string} workerTag - The tag of the worker.
   * @param {string} mineTag - The tag of the mine.
   */
  removeWorkerFromMine(workerTag, mineTag) {
    if (mineTag && this.gasMineWorkers.has(mineTag)) {
      const workersSet = this.gasMineWorkers.get(mineTag);
      if (workersSet && workerTag) {
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
  shouldAssignWorkerToMine(worker, mine) {
    // Check the worker's current orders to determine if it is gathering gas from the specific mine
    if (worker.orders && worker.orders.length > 0) {
      return worker.orders.some(order =>
        order.targetUnitTag === mine.tag &&
        order.abilityId !== undefined && // Ensure abilityId is not undefined
        gatheringAbilities.includes(order.abilityId) // Check against all gathering abilities
      );
    }

    return false;  // Return false if no relevant orders are found
  }

  /**
   * Updates the state of gas mine workers based on current visibility and assignment.
   * @param {World} world - The current game world state.
   */
  update(world) {
    console.log('Updating gas mine workers status');
    const { units } = world.resources.get();
    const allWorkers = units.getAll(Alliance.SELF).filter(unit => unit.isWorker());
    const allMines = units.getAll(Alliance.SELF).filter(unit => unit.isGasMine());

    allMines.forEach(mine => {
      if (mine.tag) {
        const currentAssignedWorkers = this.gasMineWorkers.get(mine.tag) || new Set();

        // Verify and update the workers currently assigned to each mine
        allWorkers.forEach(worker => {
          // Safely check if orders are defined and then proceed
          const isGathering = worker.isGathering('vespene') && worker.orders && worker.orders.some(order => order.targetUnitTag === mine.tag);
          const isReturning = worker.isReturning('vespene') && worker.tag && currentAssignedWorkers.has(worker.tag);

          if (isGathering || isReturning) {
            if (worker.tag) { // Make sure the tag is not undefined before adding or checking
              currentAssignedWorkers.add(worker.tag);
            }
          } else {
            if (worker.tag) { // Make sure the tag is not undefined before removing
              currentAssignedWorkers.delete(worker.tag);
            }
          }
        });

        // Update the map with the latest valid set of workers
        this.gasMineWorkers.set(mine.tag, currentAssignedWorkers);
      }
    });
  }
}

module.exports = GasMineManager;  // Export the class for use in other files