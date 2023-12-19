//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities, mineralFieldTypes } = require("@node-sc2/core/constants/groups");
const { COMMANDCENTER, MULE } = require("@node-sc2/core/constants/unit-type");

const { gasMineCheckAndBuild } = require("../helper/balance-resources");
const { upgradeTypes } = require("../helper/groups");
const { gather } = require("../services/resource-manager-service");
const { mine, getPendingOrders, setPendingOrders } = require("../services/unit-service");

const debugSilly = require('debug')('sc2:silly:WorkerBalance');

const manageResources = {
  /**
   * @param {ResourceManager} resources
   * @param {Unit} unit
   * @param {Unit|null} mineralField
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  gatherOrMine(resources, unit, mineralField = null) {
    const { units } = resources.get();
    if (units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1).length > 0) {
      const needyGasMines = getNeedyGasMines(units);
      const needyGasMine = chooseNeedyGasMine(resources, unit, needyGasMines);
      const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
      return needyGasMine && mineralMinerCount / vespeneMinerCount > 16 / 6 ? [mine(unit, needyGasMine, false)] : gather(resources, unit, mineralField, false);
    } else {
      return [];
    }
  },
  /**
   * 
   * @param {World['data']} data 
   * @param {any[]} steps 
   * @returns {any}
   */
  getResourceDemand(data, steps) {
    let totalMineralCost = 0;
    let totalVespeneCost = 0;
    steps.forEach(step => {
      if (step.orderType === 'UnitType') {
        let { mineralCost, vespeneCost } = data.getUnitTypeData(step.unitType);
        let { adjustMineralCost, adjustVespeneCost } = adjustForUpgrades(data, step.unitType);
        totalMineralCost += mineralCost - adjustMineralCost;
        totalVespeneCost += vespeneCost - adjustVespeneCost;
      } else if (step.orderType === 'Upgrade') {
        let { mineralCost, vespeneCost } = data.getUpgradeData(step.upgrade);
        totalMineralCost += mineralCost;
        totalVespeneCost += vespeneCost;
      }
    });
    return { totalMineralCost, totalVespeneCost };
  },
}
/**
 * 
 * @param {UnitResource} units 
 * @returns {any}
 */
function getMinerCount(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  let mineralMinerCount = units.getBases(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  mineralMinerCount += (units.getById(MULE).filter(mule => mule.isHarvesting()).length * (3 + 2/3));
  const vespeneMinerCount = units.getGasMines(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  return { mineralMinerCount, vespeneMinerCount }
}

function adjustForUpgrades(data, unitType) {
  const adjustedCost = { adjustMineralCost: 0, adjustVespeneCost: 0 };
  if (upgradeTypes.get(COMMANDCENTER).includes(unitType)) {
    const unitData = data.getUnitTypeData(COMMANDCENTER);
    adjustedCost.adjustMineralCost = unitData.mineralCost;
    adjustedCost.adjustVespeneCost = unitData.vespeneCost;
  }
  return adjustedCost;
}

module.exports = manageResources;

/**
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getNeedyGasMines(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  return units.getGasMines(readySelfFilter).filter(gasMine => {
    const { assignedHarvesters, idealHarvesters } = gasMine;
    if (assignedHarvesters === undefined || idealHarvesters === undefined) return false;
    const workers = units.getWorkers().filter(worker => {
      const pendingOrders = getPendingOrders(worker);
      return pendingOrders.some(order => {
        const { abilityId, targetUnitTag } = order;
        if (abilityId === undefined || targetUnitTag === undefined) return false;
        return (
          [...gatheringAbilities].includes(abilityId) &&
          targetUnitTag === gasMine.tag
        );
      });
    });
    const assignedHarvestersWithWorkers = assignedHarvesters + workers.length;
    return assignedHarvestersWithWorkers < idealHarvesters;
  });
}

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {Unit[]} needyGasMines
 * @returns {Unit|null}
 */
function chooseNeedyGasMine(resources, unit, needyGasMines) {
  if (needyGasMines.length === 0) return null;
  const { pos: unitPos } = unit; if (unitPos === undefined) return null;
  const shuffledGasMines = shuffle(needyGasMines);
  for (const gasMine of shuffledGasMines) {
    const { pos: gasMinePos } = gasMine; if (gasMinePos === undefined) continue;
    const pathablePositions = getClosestPathWithGasGeysers(resources, unitPos, gasMinePos);
    const { pathCoordinates } = pathablePositions;
    const enemyUnits = getEnemyUnitsCloseToPath(unit, pathCoordinates);
    if (enemyUnits.length === 0) return gasMine;
  }
  return null;
}

/**
 * @param {Unit} unit
 * @param {Point2D[]} pathCoordinates
 * @returns {Unit[]}
 */
function getEnemyUnitsCloseToPath(unit, pathCoordinates) {
  const enemyUnits = [];
  for (const enemyUnit of enemyTrackingService.mappedEnemyUnits) {
    const { pos: enemyUnitPos } = enemyUnit; if (enemyUnitPos === undefined) continue;
    const enemyUnitCloseToPath = pathCoordinates.some(pathCoordinate => {
      if (!canAttack(enemyUnit, unit)) return false;
      const closeToPath = getDistance(pathCoordinate, enemyUnitPos) <= 1;
      return closeToPath;
    });
    if (enemyUnitCloseToPath) enemyUnits.push(enemyUnit);
  }
  return enemyUnits;
}

