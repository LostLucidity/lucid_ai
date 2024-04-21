const { UnitType } = require("@node-sc2/core/constants");
const { Race, Attribute } = require("@node-sc2/core/constants/enums");

const StrategyContext = require("../../features/strategy/strategyContext");
const { foodEarmarks } = require("../../sharedServices");
const { upgradeTypes } = require("../../utils/misc/gameData");
const { GameState } = require("../gameState");

// EarmarkManager.js
class EarmarkManager {
  constructor() {
    /**
     * @type {{
        name: string;
        minerals: number;
        vespene: number;
      }[]}
    */
    this.earmarks = [];
    this.addEarmark = this.addEarmark.bind(this); // Bind the method to ensure 'this' context
  }

  /**
   * @param {DataStorage} data 
   * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
   */
  addEarmark(data, orderData) {
    const gameState = GameState.getInstance();
    const race = gameState.getRace();

    // If race information is not available, exit the function
    if (race === null) {
      console.warn("Race information not available in addEarmark.");
      return;
    }

    const foodUsed = gameState.getFoodUsed(); // Use the getFoodUsed method

    const { ZERGLING } = UnitType;

    const { name, mineralCost, vespeneCost } = orderData;

    if (this.earmarkThresholdReached(data) || name === undefined || mineralCost === undefined || vespeneCost === undefined) return;

    const foodKey = `${foodUsed + this.getEarmarkedFood()}`;
    const stepKey = `${StrategyContext.getInstance().getCurrentStep()}`;
    const fullKey = `${stepKey}_${foodKey}`;

    let minerals = 0;
    let foodEarmark = foodEarmarks.get(fullKey) || 0;

    if ('unitId' in orderData) {
      const isZergling = orderData.unitId === ZERGLING;
      const { attributes, foodRequired, race, unitId } = orderData;

      if (attributes !== undefined && foodRequired !== undefined && race !== undefined && unitId !== undefined) {
        const adjustedFoodRequired = isZergling ? foodRequired * 2 : foodRequired;
        foodEarmarks.set(fullKey, foodEarmark + adjustedFoodRequired);

        // Check for town hall upgrades
        for (let [base, upgrades] of upgradeTypes.entries()) {
          if (upgrades.includes(unitId)) {
            const baseTownHallData = data.getUnitTypeData(base);
            minerals = -(baseTownHallData?.mineralCost ?? 400); // defaulting to 400 if not found
            break;
          }
        }

        if (race === Race.ZERG && attributes.includes(Attribute.STRUCTURE)) {
          foodEarmarks.set(fullKey, foodEarmark - 1);
        }
      }

      minerals += isZergling ? mineralCost * 2 : mineralCost;
    } else if ('upgradeId' in orderData) {
      // This is an upgrade
      minerals += mineralCost;
    }

    // set earmark name to include step number and food used plus food earmarked
    const earmarkName = `${name}_${fullKey}`;
    const earmark = {
      name: earmarkName,
      minerals,
      vespene: vespeneCost,
    }
    data.addEarmark(earmark);
    this.earmarks.push(earmark);
  }

  /**
   * @param {DataStorage} data 
   * @returns {boolean}
   */
  earmarkThresholdReached(data) {
    const { minerals: earmarkedTotalMinerals, vespene: earmarkedTotalVespene } = data.getEarmarkTotals('');
    return earmarkedTotalMinerals > 512 && earmarkedTotalVespene > 512 || earmarkedTotalMinerals > 1024;
  }

  /**
     * @description Get total food earmarked for all steps
     * @returns {number}
     */
  getEarmarkedFood() {
    return Array.from(foodEarmarks.values()).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
  }
}

module.exports = new EarmarkManager();
