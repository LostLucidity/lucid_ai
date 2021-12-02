//@ts-check
"use strict"

const { EFFECT_REPAIR, MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const {  PROBE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { countTypes } = require("../helper/groups");
const { createUnitCommand } = require("./actions-service");
const { isPendingContructing } = require("./shared-service");

const unitResourceService = {
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
    const [ closestMineralField ] = units.getClosest(unit.pos, units.getMineralFields());
    return closestMineralField;
  },
  isWorker(unit) {
    return workerTypes.includes(unit.unitType);
  },
  /**
   * 
   * @param {UnitResource} units 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  premoveBuilderToPosition: (units, position) => {
    const collectedActions = [];
    const builder = unitResourceService.selectBuilder(units, MOVE, position);
    const unitCommand = builder ? createUnitCommand(MOVE, [builder]) : {};
    unitCommand.targetWorldSpacePos = position;
    collectedActions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, builder, MOVE, position));
    return collectedActions;
  },
  /**
   * 
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
   * @param {AbilityId} abilityId 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  stopOverlappingBuilders: (units, builder, abilityId, position) => {
    const collectedActions = [];
    const overlappingBuilders = unitResourceService.getBuilders(units)
      .filter(otherBuilder => otherBuilder.tag !== builder.tag && otherBuilder.orders
        .find(order => order.abilityId === abilityId && order.targetWorldSpacePos.x === position.x && order.targetWorldSpacePos.y === position.y));
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