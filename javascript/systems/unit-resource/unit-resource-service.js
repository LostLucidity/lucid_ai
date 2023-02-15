//@ts-check
"use strict"

const { EFFECT_REPAIR, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes, gatheringAbilities } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { PROBE, COLOSSUS, MULE, DRONE } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { countTypes } = require("../../helper/groups");
const { createUnitCommand } = require("../../services/actions-service");
const { getDistance } = require("../../services/position-service");
const { isPendingContructing } = require("../../services/shared-service");
const unitService = require("../../services/unit-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../track-units/track-units-service");

const unitResourceService = {
  /** @type {{}} */
  unitTypeData: {},
  /** @type {Point2D[]} */
  seigeTanksSiegedGrids: [],
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
  /**
   * @param {UnitResource} units 
   * @param {Unit} unit 
   * @returns {number}
   */
  calculateTotalHealthRatio: (units, unit) => {
    if (unitResourceService.getUnitTypeData(units, unit.unitType)) {
      const { healthMax, shieldMax } = unitResourceService.getUnitTypeData(units, unit.unitType)
      const totalHealthShield = unit.health + unit.shield;
      const maxHealthShield = healthMax + shieldMax;
      return totalHealthShield / maxHealthShield;
    }
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

  /**
   * @param {UnitResource} units
   * @param {Unit} unit
   * @returns {Unit[]}
   */
  getSelfUnits: (units, unit) => {
    const { pos, tag } = unit; if (pos === undefined || tag === undefined) return [];
    let hasSelfUnits = unitService.selfUnits.has(tag);
    if (!hasSelfUnits) {
      let unitsByAlliance = [];
      if (unit.alliance === Alliance.SELF) {
        unitsByAlliance = trackUnitsService.selfUnits.length > 0 ? trackUnitsService.selfUnits : units.getAlive(Alliance.SELF);
      } else if (unit.alliance === Alliance.ENEMY) {
        unitsByAlliance = enemyTrackingService.mappedEnemyUnits.length > 0 ? enemyTrackingService.mappedEnemyUnits : units.getAlive(Alliance.ENEMY);
      }
      const selfUnits = unitsByAlliance.filter(allyUnit => {
        const { pos: allyPos } = allyUnit; if (allyPos === undefined) return false;
        return getDistance(pos, allyPos) < 16;
      });
      unitService.selfUnits.set(tag, selfUnits);
    }
    return unitService.selfUnits.get(tag) || [];
  },
  inSightRange(units, targetUnit) {
    return units.some(unit => {
      const targetUnitDistanceToItsEdge = distance(unit.pos, targetUnit.pos) - targetUnit.radius;
      return unit.data().sightRange >= targetUnitDistanceToItsEdge;
    });
  },
  /**
   * @param {UnitResource} units
   * @param {Unit} unit
   * @returns {boolean}
   */
  isByItselfAndNotAttacking: (units, unit) => {
    const isByItself = unitResourceService.getSelfUnits(units, unit).length === 1;
    const isAttacking = unit.labels.get('hasAttacked');
    return isByItself && !isAttacking;
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
   * @param {Unit} unit 
   * @returns {boolean}
   */
  getWithLabelAvailable: (units, unit) => {
    // if unit has constructing order, if building at order position has a buildProgress of 1, then unitIsConstructing is false
    let unitIsConstructing = unit.isConstructing();
    if (unitIsConstructing) {
      if (!unit.orders[0].targetWorldSpacePos && !units.getByTag(unit.orders[0].targetUnitTag)) {
        console.log('unit.orders', unit.orders);
      }
      const constructionPosition = unit.orders[0].targetWorldSpacePos ? unit.orders[0].targetWorldSpacePos : units.getByTag(unit.orders[0].targetUnitTag).pos;
      const buildingAtOrderPosition = units.getAlive().filter(unit => unit.isStructure()).find(structure => unit.orders[0].targetWorldSpacePos && distance(structure.pos, constructionPosition) < 1);
      if (buildingAtOrderPosition) {
        const { buildProgress } = buildingAtOrderPosition;
        if (buildProgress === undefined) return false;
        if (buildProgress >= 1) {
          unitIsConstructing = false;
        }
      } else {
        unitIsConstructing = false;
      }
    }
    const isNotConstructing = !unitIsConstructing || (unitIsConstructing && unit.unitType === PROBE);
    const probeAndMoving = unit.unitType === PROBE && unitService.isMoving(unit);
    return (isNotConstructing && !unit.isAttacking() && !isPendingContructing(unit)) || probeAndMoving;
  },
  /**
   * 
   * @param {UnitResource} units 
   * @returns {Unit[]}
   */
  getBuilders: (units) => {
    const { getWithLabelAvailable } = unitResourceService;
    let builders = [
      ...units.withLabel('builder').filter(builder => getWithLabelAvailable(units, builder)),
      ...units.withLabel('proxy').filter(proxy => getWithLabelAvailable(units, proxy)),
    ].filter(worker => {
      const gatheringAndMining = worker.isGathering() && unitResourceService.isMining(units, worker);
      const isConstructingDrone = worker.isConstructing() && worker.unitType === DRONE;
      return !worker.isReturning() && !gatheringAndMining && !isConstructingDrone;
    });
    return builders;
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
   * @param {UnitResource} units
   * @param {Unit[]} mineralFields
   * @returns {Unit | undefined}}
   */
  getNeediestMineralField: (units, mineralFields) => {
    const mineralFieldCounts = unitResourceService.getMineralFieldAssignments(units, mineralFields)
      .filter(mineralFieldAssignments => mineralFieldAssignments.count < 2 && mineralFieldAssignments.targetedCount < 2)
      .sort((a, b) => {
        const { mineralContents: aContents } = a;
        const { mineralContents: bContents } = b;
        if (aContents === undefined || bContents === undefined) return 0;
        return bContents - aContents
      }).sort((a, b) => {
        return Math.max(a.count, a.targetedCount) - Math.max(b.count, b.targetedCount);
      });
    if (mineralFieldCounts.length > 0) {
      const [mineralFieldCount] = mineralFieldCounts;
      const { mineralFieldTag } = mineralFieldCount;
      if (mineralFieldTag) {
        return units.getByTag(mineralFieldTag);
      }
    }
  },
  /**
   * @param {UnitResource} units
   * @param {Unit} worker
   * @returns {Point2D|undefined}
   */
  getOrderTargetPosition: (units, worker) => {
    if (worker.orders && worker.orders.length > 0) {
      const order = worker.orders[0];
      if (order.targetWorldSpacePos) {
        return order.targetWorldSpacePos;
      } else if (order.targetUnitTag) {
        const targetUnit = units.getByTag(order.targetUnitTag);
        if (targetUnit) {
          return targetUnit.pos;
        }
      }
    }
  },
  /**
   * @param {UnitResource} units
   * @param {Unit} unit
   * @returns {Unit[]}
   */
  getTargetedByWorkers: (units, unit) => {
    const workers = units.getWorkers().filter(worker => {
      const { orders } = worker;
      const pendingOrders = worker['pendingOrders'];
      if (orders === undefined) return false;
      return orders.some(order => {
        if (order.targetUnitTag === unit.tag) {
          return true;
        } else if (pendingOrders && pendingOrders.some(pendingOrder => pendingOrder.targetUnitTag === unit.tag)) {
          return true;
        } else {
          return false;
        }
      });
    });
    return workers;
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
   * @param {Unit} unit 
   * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
   * @returns {void}
   */
  setPendingOrders: (unit, unitCommand) => {
    if (unit['pendingOrders']) {
      unit['pendingOrders'].push(unitCommand);
    } else {
      unit['pendingOrders'] = [unitCommand];
    }
  },
  /**
   * Returns an array of unitCommands to prevent multiple builders on the same task. 
   * @param {UnitResource} units 
   * @param {Unit} builder 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  stopOverlappingBuilders: (units, builder, position) => {
    const collectedActions = [];
    const overlappingBuilders = unitResourceService.getBuilders(units).filter(otherBuilder => {
      const orderTargetPosition = unitResourceService.getOrderTargetPosition(units, otherBuilder);
      return otherBuilder.tag !== builder.tag && orderTargetPosition && distance(orderTargetPosition, position) < 1.6;
    });
    if (overlappingBuilders.length > 0) {
      const unitCommand = createUnitCommand(STOP, overlappingBuilders.map(builder => builder));
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }
}

module.exports = unitResourceService;