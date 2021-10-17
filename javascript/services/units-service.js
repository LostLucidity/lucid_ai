//@ts-check
"use strict"

const Ability = require("@node-sc2/core/constants/ability");
const { EFFECT_REPAIR, MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { ZERGLING, PROBE } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("./actions-service");
const { logActionIfNearPosition } = require("./logging-service");
const { isPendingContructing } = require("./shared-service");

const unitService = {
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @param {Point2D} position 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
   assignAndSendWorkerToBuild: (world, unitType, position) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const { abilityId } = data.getUnitTypeData(unitType);
    const collectedActions = [];
    const builder = unitService.selectBuilder(units, abilityId, position);
    if (builder) {
      if (!builder.isConstructing() && !isPendingContructing(builder)) {
        builder.labels.set('builder', true);
        const unitCommand = {
          abilityId,
          unitTags: [builder.tag],
          targetWorldSpacePos: position,
        };
        console.log(`Command given: ${Object.keys(Ability).find(ability => Ability[ability] === abilityId)}`);
        logActionIfNearPosition(world, unitType, builder, position);
        collectedActions.push(unitCommand);
        unitService.setPendingOrders(builder, unitCommand);
        collectedActions.push(...unitService.stopOverlappingBuilders(units, builder, abilityId, position));
      }
    }
    return collectedActions;
  },
  /**
   * Checks whether unit can attack targetUnit.
   * @param {{ get: () => { map: any; units: any; }; }} resources
   * @param {{ isFlying: any; isMelee: () => any; }} unit
   * @param {{ isFlying: any; pos: any; radius: any; }} targetUnit
   * @return {boolean}
   */
  canAttack(resources, unit, targetUnit) {
    const { map, units } = resources.get();
    const rangedGroundUnit = !unit.isFlying && !unit.isMelee();
    if (rangedGroundUnit && targetUnit.isFlying) {
      const inRangeOfVisionAndVisible = gridsInCircle(targetUnit.pos, targetUnit.radius, { normalize: true }).some(grid => map.isVisible(grid)) && unitService.inSightRange(units.getAlive(Alliance.SELF), targetUnit);
      return inRangeOfVisionAndVisible;
    }
    return true;
  },
  deleteLabel(units, label) {
    units.withLabel(label).forEach(pusher => pusher.labels.delete(label));
  },
  /**
   * Returns whether target unit is in sightRange of unit.
   * @param {any[]} units
   * @param {{ isFlying?: any; pos: any; radius?: any; }} targetUnit
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
    const { getWithLabelAvailable } = unitService;
    let builders = [
      ...units.withLabel('builder').filter(builder => getWithLabelAvailable(builder)),
      ...units.withLabel('proxy').filter(proxy => getWithLabelAvailable(proxy)),
    ].filter(worker => !worker.isReturning());
    return builders;
  },
  getEnemyWorkers(world) {
    const workers = world.resources.get().units.getAlive(Alliance.ENEMY)
      .filter(u => u.unitType === WorkerRace[world.agent.race]);
    return workers;
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
    const builder = unitService.selectBuilder(units, MOVE, position);
    const unitCommand = builder ? createUnitCommand(MOVE, [builder]) : {};
    unitCommand.targetWorldSpacePos = position;
    collectedActions.push(unitCommand, ...unitService.stopOverlappingBuilders(units, builder, MOVE, position));
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
    const builders = unitService.getBuilders(units);
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
    const overlappingBuilders = unitService.getBuilders(units)
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

module.exports = unitService