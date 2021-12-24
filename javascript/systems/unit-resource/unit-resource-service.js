//@ts-check
"use strict"

const { EFFECT_REPAIR, MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { PROBE } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { countTypes } = require("../../helper/groups");
const { isPendingContructing } = require("../../services/shared-service");

const unitResourceService = {
  /** @type {{}} */
  unitTypeData: {},
  /** @type {Point2D[]} */
  seigeTanksSiegedGrids: [],
  /**
   * @param {UnitResource} units 
   * @param {Unit} unit 
   * @returns {number}
   */
   calculateTotalHealthRatio: (units, unit) => {
    const { healthMax, shieldMax } = unitResourceService.getUnitTypeData(units, unit.unitType)
    const totalHealthShield = unit.health + unit.shield;
    const maxHealthShield = healthMax + shieldMax;
    return totalHealthShield / maxHealthShield;
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
   * @returns {{healthMax: number, shieldMax: number}} 
   */
  getUnitTypeData: (units, unitType) => {
    const unitTypeData = unitResourceService.unitTypeData[unitType];
    if (unitTypeData) {
      let { healthMax, shieldMax } = unitTypeData;
      return { healthMax, shieldMax };
    } else {
      const [unit] = units.getByType(unitType);
      if (unit) {
        let { healthMax, shieldMax } = unit;
        unitResourceService.unitTypeData[unitType] = { healthMax, shieldMax };
        return { healthMax, shieldMax };
      }
    }
  },
  /**
   * 
   * @param {Unit} unit 
   * @returns {boolean}
   */
  getWithLabelAvailable: (unit) => {
    return (
      !unit.isConstructing() ||
      (unit.isConstructing() && unit.unitType === PROBE)) &&
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
      ...units.withLabel('builder').filter(builder => getWithLabelAvailable(builder)),
      ...units.withLabel('proxy').filter(proxy => getWithLabelAvailable(proxy)),
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
  isWorker(unit) {
    return workerTypes.includes(unit.unitType);
  },
  /**
   * @param {UnitResource} units 
   * @param {AbilityId} abilityId 
   * @param {Point2D} position 
   * @returns {Unit}
   */
  selectBuilder: (units, abilityId, position) => {
    const builders = unitResourceService.getBuilders(units);
    if (abilityId !== MOVE || builders.length === 0) {
      builders.push(...units.getWorkers().filter(worker => worker.noQueue || worker.isGathering()));
    }
    const [builder] = units.getClosest(position, builders);
    if (builder) builder.labels.set('builder', true);
    return builder;
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

module.exports = unitResourceService