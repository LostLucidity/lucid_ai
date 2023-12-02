//@ts-check
"use strict"

const { EFFECT_REPAIR, STOP, EFFECT_CHRONOBOOSTENERGYCOST: CHRONOBOOST } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes, gatheringAbilities } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { PROBE, COLOSSUS, MULE, DRONE, NEXUS } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");
const { countTypes, larvaOrEgg } = require("../../helper/groups");
const { isPendingContructing } = require("../../services/shared-service");
const { canBeChronoBoosted, triggerAbilityByDistance } = require("../../services/unit-service");
const unitService = require("../../services/unit-service");
const Ability = require("@node-sc2/core/constants/ability");
const { UnitType } = require("@node-sc2/core/constants");
const { createUnitCommand } = require("../../src/shared-utilities/command-utilities");

const unitResourceService = {
  /** @type {Map<string, UnitTypeId>} */
  flyingStructures: new Map(),
  /** @type {Unit[] | null} */
  gasGeysers: null,
  /** @type {Point2D[]} */
  landingGrids: [],
  /** @type {{}} */
  unitTypeData: {},
  /** @type {Map<number, { units: Unit[]; frame: number; }>} */
  unitsById: new Map(),
  /** @type {Unit[] | null} */
  workers: null,
  /**
   * @param {UnitResource} units
   * @param {UnitTypeId} unitType 
   * @param {UnitTypeId[]} targetUnitTypes
   * @returns {number}
   */
  calculateSplashDamage: (units, unitType, targetUnitTypes) => {
    if (targetUnitTypes.length > 0) {
      if (unitType === COLOSSUS) {
        let groundUnitsCount = 0;
        const totalGroundDiameter = targetUnitTypes.reduce((totalDiameter, unitType) => {
          const unitDataType = unitResourceService.getUnitTypeData(units, unitType);
          if (!unitDataType.isFlying) {
            groundUnitsCount += 1;
            return totalDiameter + (unitDataType.radius * 2);
          } else { return totalDiameter; }
        }, 0);
        const splashDiameter = 2.8;
        const averageGroundDiameter = totalGroundDiameter / groundUnitsCount;
        const potentialSplashCount = splashDiameter / averageGroundDiameter;
        const splashCount = potentialSplashCount < groundUnitsCount ? potentialSplashCount : groundUnitsCount;
        return splashCount > 1 ? splashCount : 1;
      }
    }
    return 1;
  },
  deleteLabel(units, label) {
    units.withLabel(label).forEach(pusher => pusher.labels.delete(label));
  },
  /**
   * @param {UnitResource} units
   * @returns {UnitTypeId[]}
   */
  getExistingTrainingTypes(units) {
    return units.getAlive().reduce((/** @type {UnitTypeId[]} */ types, unit) => {
      const { unitType } = unit; if (unitType === undefined) { return types; }
      if (types.includes(unitType)) {
        return types;
      }
      return [...types, unitType];
    }, []);
  },
  /**
   * 
   * @param {UnitResource} units 
   * @param {"minerals" | "vespene" | undefined} type 
   * @returns 
   */
  getGatheringWorkers(units, type = undefined, firstOrderOnly = true) {
    const gatheringWorkers = units.getWorkers()
      .filter(worker => {
        return (
          worker.isGathering(type) ||
          (worker['pendingOrders'] && worker['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ order) => gatheringAbilities.includes(order.abilityId)))
        );
      });
    if (firstOrderOnly) {
      return gatheringWorkers.filter(worker => {
        const { orders } = worker; if (orders === undefined) return false;
        const pendingOrders = unitService.getPendingOrders(worker);
        const gatheringOrders = [...orders, ...pendingOrders].filter(order => order.abilityId && gatheringAbilities.includes(order.abilityId));
        return gatheringOrders.length > 0;
      });
    }
    return gatheringWorkers;
  },
  /**
   * Returns whether target unit is in sightRange of unit.
   * @param {Unit[]} units
   * @param {Unit} targetUnit
   * @return {boolean}
   */
  inSightRange(units, targetUnit) {
    return units.some(unit => {
      const targetUnitDistanceToItsEdge = distance(unit.pos, targetUnit.pos) - targetUnit.radius;
      return unit.data().sightRange >= targetUnitDistanceToItsEdge;
    });
  },
  /**
   * @param {UnitResource} units
   * @param {Unit} worker
   * returns {boolean}
   **/
  isMining(units, worker) {
    const { pos, unitType } = worker; if (pos === undefined || unitType === undefined) { return false; }
    const orderTargetPosition = unitResourceService.getOrderTargetPosition(units, worker); if (orderTargetPosition === undefined) { return false; }
    const distanceToResource = distance(pos, orderTargetPosition);
    let minimumDistanceToResource = 0;
    if (worker.isGathering('vespene')) {
      minimumDistanceToResource = 2.28;
    } else if (worker.isGathering('minerals')) {
      minimumDistanceToResource = unitType === MULE ? 1.92 : 1.62;
    }
    return distanceToResource < minimumDistanceToResource;
  },
  isRepairing(unit) {
    return unit.orders.some(order => order.abilityId === EFFECT_REPAIR);
  },
  /**
   * @param {Unit[]} buildings 
   * @param {Point2D} grid 
   * @param {UnitTypeId} unitType 
   */
  getThirdWallPosition(buildings, grid, unitType) {
    // Check spacing between first two buildings.
    const { getSpaceBetweenFootprints } = unitResourceService;
    const [buildingOne, buildingTwo] = buildings;
    const buildingOneFootprint = cellsInFootprint(buildingOne.pos, getFootprint(buildingOne.unitType));
    const buildingTwoFootprint = cellsInFootprint(buildingTwo.pos, getFootprint(buildingTwo.unitType));
    const footprints = [buildingOneFootprint, buildingTwoFootprint];
    const spaceBetweenFootprints = getSpaceBetweenFootprints([buildingOneFootprint, buildingTwoFootprint]);
    let foundThirdWallPosition = false;
    if (spaceBetweenFootprints === 2) {
      // If 1 spacing, leave no space between 1
      foundThirdWallPosition = footprints.some(footprint => {
        const spaceBetweenFootprints = getSpaceBetweenFootprints([cellsInFootprint(grid, getFootprint(unitType)), footprint]);
        return spaceBetweenFootprints > 0.5 && spaceBetweenFootprints < 1.5;
      });
    } else {
      // leave 1 space.
      foundThirdWallPosition = footprints.some(footprint => {
        const spaceBetweenFootprints = getSpaceBetweenFootprints([cellsInFootprint(grid, getFootprint(unitType)), footprint]);
        return spaceBetweenFootprints > 1.5 && spaceBetweenFootprints < 2.5;
      });
    }
    return foundThirdWallPosition;
  },
  /**
   * @param {[Point2D[], Point2D[]]} footprints
   * @returns {number}
   */
  getSpaceBetweenFootprints(footprints) {
    const [footprintOne, footprintTwo] = footprints;
    let shortestDistance = Infinity;
    footprintOne.forEach(footprintOneCell => {
      footprintTwo.forEach(footprintTwoCell => {
        shortestDistance = shortestDistance < distance(footprintOneCell, footprintTwoCell) ? shortestDistance : distance(footprintOneCell, footprintTwoCell);
      });
    });
    return shortestDistance;
  },
  /**
   * @param {UnitResource} units
   * @param {UnitTypeId} unitType
   * @returns {{ healthMax: number; isFlying: boolean; radius: number; shieldMax: number, weaponCooldownMax: number; }} 
   */
  getUnitTypeData: (units, unitType) => {
    const unitTypeData = unitResourceService.unitTypeData[unitType];
    if (unitTypeData) {
      if (['healthMax', 'isFlying', 'radius', 'shieldMax', 'weaponCooldownMax'].every(property => Object.prototype.hasOwnProperty.call(unitTypeData, property))) {
        let { healthMax, isFlying, radius, shieldMax, weaponCooldownMax } = unitTypeData;
        return { healthMax, isFlying, radius, shieldMax, weaponCooldownMax };
      } else {
        return unitResourceService.saveAndGetUnitTypeData(units, unitType);
      }
    } else {
      return unitResourceService.saveAndGetUnitTypeData(units, unitType);
    }
  },
  /**
   * @param {UnitResource} units
   * @param {UnitTypeId} unitType
   * @returns {Unit[]}
   */
  getUnitsById: (units, unitType) => {
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    return units.getById(unitTypes)
  },
  getEnemyWorkers(world) {
    const workers = world.resources.get().units.getAlive(Alliance.ENEMY)
      .filter(u => u.unitType === WorkerRace[world.agent.race]);
    return workers;
  },
  /**
   * 
   * @param {UnitResource} units 
   * @param {Unit} unit 
   * @returns 
   */
  getMineralFieldTarget: (units, unit) => {
    const mineralFields = units.getClosest(unit.pos, units.getMineralFields(), units.getMineralFields().length).filter(mineralField => distance(mineralField.pos, unit.pos) < 8);
    return mineralFields.reduce((mineralFieldWithHighestAmount, mineralField) => {
      if (mineralFieldWithHighestAmount.mineralContents < mineralField.mineralContents) {
        return mineralField;
      } else {
        return mineralFieldWithHighestAmount;
      }
    }
    , { mineralContents: 0 });
  },
  /**
   * @param {UnitResource} units
   * @param {Unit[]} mineralFields
   * @returns {{ count: number; mineralContents: number | undefined; mineralFieldTag: string | undefined; targetedCount: number; }[]}
   */
  getMineralFieldAssignments: (units, mineralFields) => {
    const harvestingMineralWorkers = units.getWorkers().filter(worker => worker.isHarvesting('minerals'));
    return mineralFields.map(mineralField => {
      const targetMineralFieldWorkers = harvestingMineralWorkers.filter(worker => {
        const assignedMineralField = worker.labels.get('mineralField');
        return assignedMineralField && assignedMineralField.tag === mineralField.tag;
      });
      mineralField.labels.set('workerCount', targetMineralFieldWorkers.length);
      const targetedMineralFieldWorkers = harvestingMineralWorkers.filter(worker => {
        const { orders } = worker;
        if (orders === undefined) return false;
        const pendingOrders = unitService.getPendingOrders(worker);
        const allOrders = [...orders, ...pendingOrders];
        return allOrders.some(order => {
          if (order.targetUnitTag === mineralField.tag && worker.labels.has('mineralField')) {
            return true;
          } else {
            return false;
          }
        });
      });
      return {
        count: targetMineralFieldWorkers.length,
        mineralContents: mineralField.mineralContents,
        mineralFieldTag: mineralField.tag,
        targetedCount: targetedMineralFieldWorkers.length,
      };
    });
  },

  /**
   * Check if the frame stored in the map matches the current frame
   * @param {number} unitType 
   * @param {number} currentFrame 
   * @returns {boolean}
   */
  isCurrent: (unitType, currentFrame) => {
    const entry = unitResourceService.unitsById.get(unitType);
    return entry ? entry.frame === currentFrame : false;
  },
  /**
   * @param {UnitResource} units 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  maxEnergyNexusChronoboost: (units) => {
    const collectedActions = [];
    const nexusWithChronoBoost = units.getById(NEXUS).filter(n => n.abilityAvailable(CHRONOBOOST));
    if (nexusWithChronoBoost.length > 0) {
      const structures = units.getStructures();
      const structuresThatCanBeChronoBoosted = structures.filter(structure => canBeChronoBoosted(structure));
      if (structuresThatCanBeChronoBoosted.length > 0) {
        const [nexusWithMostEnergy] = nexusWithChronoBoost.sort((a, b) => b.energy && a.energy ? b.energy - a.energy : 0);
        const randomStructure = getRandom(structuresThatCanBeChronoBoosted);
        const unitCommand = createUnitCommand(CHRONOBOOST, [nexusWithMostEnergy]);
        unitCommand.targetUnitTag = randomStructure.tag;
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  /**
   * 
   * @param {UnitResource} units 
   * @param {UnitTypeId} unitType 
   * @returns 
   */
  saveAndGetUnitTypeData: (units, unitType) => {
    const [unit] = units.getByType(unitType);
    if (unit) {
      let { healthMax, isFlying, radius, shieldMax, weaponCooldown } = unit;
      const weaponCooldownMax = weaponCooldown;
      unitResourceService.unitTypeData[unitType] = { healthMax, isFlying, radius, shieldMax, weaponCooldownMax };
      return { healthMax, isFlying, radius, shieldMax, weaponCooldownMax };
    } else {
      return unitResourceService.unitTypeData[unitType];
    }
  },
  isWorker(unit) {
    return workerTypes.includes(unit.unitType);
  },

  /**
   * @description Siege tanks will siege if target is within 4 distance and unsiege if target is greater than 4 distance.
   * @param {UnitResource} units
   * @param {Unit | null} target
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  tankBehavior: (units, target=null) => {
    const collectedActions = [];
    const { MORPH_SIEGEMODE, MORPH_UNSIEGE } = Ability;
    const { SIEGETANK, SIEGETANKSIEGED } = UnitType;
    // get siege tanks
    if (target) {
      units.getByType(SIEGETANK).filter(tank => {
        collectedActions.push(...triggerAbilityByDistance(tank, target, '<', 4, MORPH_SIEGEMODE));
      });
      units.getByType(SIEGETANKSIEGED).filter(tank => {
        collectedActions.push(...triggerAbilityByDistance(tank, target, '>', 4, MORPH_UNSIEGE));
      });
    } else {
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
      units.getByType(SIEGETANK).filter(tank => {
        let [closestEnemyUnit] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit, '<', 13, MORPH_SIEGEMODE));
        }
      });
      units.getById(SIEGETANKSIEGED).filter(tank => {
        let [closestEnemyUnit] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit, '>', 13, MORPH_UNSIEGE));
        }
      });
    }
    return collectedActions;
  },
}

module.exports = unitResourceService

