//@ts-check
"use strict"

const { EFFECT_REPAIR, STOP, SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { PROBE, COLOSSUS } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getClosestUnitByPath } = require("../../helper/get-closest-by-path");
const { countTypes } = require("../../helper/groups");
const { createUnitCommand } = require("../../services/actions-service");
const { isPendingContructing } = require("../../services/shared-service");

const unitResourceService = {
  /** @type {{}} */
  unitTypeData: {},
  /** @type {Point2D[]} */
  seigeTanksSiegedGrids: [],
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
  /**
   * Checks whether unit can attack targetUnit.
   * @param {ResourceManager} resources
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @return {boolean}
   */
  canAttack(resources, unit, targetUnit) {
    const { units } = resources.get();
    if (targetUnit.isFlying) {
      if (unit.canShootUp()) {
        const inRangeOfVisionAndVisible = units.getAlive(Alliance.ENEMY).some(unit => unit.tag === targetUnit.tag) && unitResourceService.inSightRange(units.getAlive(Alliance.SELF), targetUnit);
        return inRangeOfVisionAndVisible;
      } else {
        return false;
      }
    }
    return true;
  },
  deleteLabel(units, label) {
    units.withLabel(label).forEach(pusher => pusher.labels.delete(label));
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
  isRepairing(unit) {
    return unit.orders.some(order => order.abilityId === EFFECT_REPAIR);
  },
  /**
     * @param {UnitResource} units
     * @param {Unit} unit 
     * @param {Unit} mineralField 
     * @param {boolean} queue 
     * @returns {SC2APIProtocol.ActionRawUnitCommand}
     */
  gather: (units, unit, mineralField, queue = true) => {
    if (unit.labels.has('command') && queue === false) {
      console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
      queue = true;
    }
    const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1);
    let target;
    if (mineralField && mineralField.tag) {
      target = mineralField;
    } else {
      let targetBase;
      const needyBase = ownBases.sort((a, b) => {
        // sort by the closest base to the idle worker
        return distance(unit.pos, a.pos) - distance(unit.pos, b.pos);
      })
        // try to find a base that's needy, closest first
        .find(base => base.assignedHarvesters < base.idealHarvesters);
      if (!needyBase) {
        [targetBase] = ownBases;
      } else {
        targetBase = needyBase;
      }
      const currentMineralFields = units.getMineralFields();
      const targetBaseFields = units.getClosest(targetBase.pos, currentMineralFields, 3);
      [target] = units.getClosest(unit.pos, targetBaseFields);
    }
    const sendToGather = createUnitCommand(SMART, [unit]);
    sendToGather.targetUnitTag = target.tag;
    sendToGather.queueCommand = queue;
    return sendToGather;
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
    let unitIsConstructiing = unit.isConstructing();
    if (unitIsConstructiing) {
      if (!unit.orders[0].targetWorldSpacePos && !units.getByTag(unit.orders[0].targetUnitTag)) {
        console.log('unit.orders', unit.orders);
      }
      const constructionPosition = unit.orders[0].targetWorldSpacePos ? unit.orders[0].targetWorldSpacePos : units.getByTag(unit.orders[0].targetUnitTag).pos;
      const buildingAtOrderPosition = units.getAlive().filter(unit => unit.isStructure()).find(structure => unit.orders[0].targetWorldSpacePos && distance(structure.pos, constructionPosition) < 1);
      if (buildingAtOrderPosition && buildingAtOrderPosition.buildProgress >= 1) {
        unitIsConstructiing = false;
      }
    }
    return (
      !unitIsConstructiing ||
      (unitIsConstructiing && unit.unitType === PROBE)) &&
      !unit.isAttacking() &&
      !isPendingContructing(unit);
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
    ].filter(worker => !worker.isReturning());
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
    const [closestMineralField] = units.getClosest(unit.pos, units.getMineralFields());
    return closestMineralField;
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
    }
  },
  isWorker(unit) {
    return workerTypes.includes(unit.unitType);
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @returns {Unit}
   */
  selectBuilder: (resources, position) => {
    const { units } = resources.get();
    const builderCandidates = unitResourceService.getBuilders(units);
    builderCandidates.push(...units.getWorkers().filter(worker => {
      return worker.noQueue || worker.isGathering() || worker.orders.findIndex(order => order.targetWorldSpacePos && (distance(order.targetWorldSpacePos, position) < 1)) > -1;
    }));
    const [closestBuilder] = getClosestUnitByPath(resources, position, builderCandidates);
    return closestBuilder;
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
      return (
        otherBuilder.tag !== builder.tag &&
        otherBuilder.orders.find(order => order.targetWorldSpacePos && order.targetWorldSpacePos.x === position.x && order.targetWorldSpacePos.y === position.y)
      );
    });
    if (overlappingBuilders.length > 0) {
      collectedActions.push({
        abilityId: STOP,
        unitTags: overlappingBuilders.map(builder => builder.tag),
      });
    }
    return collectedActions;
  }
}

module.exports = unitResourceService;