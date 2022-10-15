//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { EFFECT_INJECTLARVA, MOVE } = require("@node-sc2/core/constants/ability");
const { QUEENSPAWNLARVATIMER } = require("@node-sc2/core/constants/buff");
const { Race } = require("@node-sc2/core/constants/enums");
const { QUEEN } = require("@node-sc2/core/constants/unit-type");
const { areEqual } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../services/actions-service");
const { getTimeInSeconds } = require("../services/frames-service");
const { getClosestUnitByPath, getDistanceByPath, getClosestUnitPositionByPath } = require("../services/resource-manager-service");
const { getMovementSpeed, getPendingOrders } = require("../services/unit-service");
const { setPendingOrders } = require("./unit-resource/unit-resource-service");

module.exports = createSystem({
  name: "InjectorSystem",
  type: "agent",
  async onStep(world) {
    const { agent, resources } = world;
    if (agent.race === Race.ZERG) {
      const { actions } = resources.get();
      const collectedActions = [];
      collectedActions.push(...injectLarva(resources));
      await actions.sendAction(collectedActions);
    }
  }
});
/**
 * @param {ResourceManager} resources
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function injectLarva(resources) {
  const { units } = resources.get();
  const collectedActions = [];
  const baseAndQueenSpawnTimerLeft = getBaseAndQueenSpawnTimerLeft(resources);
  units.getById(QUEEN).forEach(queen => {
    const { energy, orders, pos } = queen;
    if (energy === undefined || orders === undefined || pos === undefined) return;
    const timeTo25Energy = (25 - energy) > 0 ? (25 - energy) / getEnergyRegenRate() : 0;
    const [closestUnitByPath] = getClosestUnitByPath(resources, pos, baseAndQueenSpawnTimerLeft.filter(base => {
      const { base: { pos: basePos }, timeLeft } = base;
      if (basePos === undefined) return false;
      const closestUnitPositionByPath = getClosestUnitPositionByPath(resources, basePos, pos);
      const timeToDistance = getTimeToDistance(resources, queen, closestUnitPositionByPath);
      return timeLeft <= timeTo25Energy || timeLeft <= timeToDistance;
    }).map(base => base.base));
    if (closestUnitByPath) {
      const { buffIds, pos: closestUnitByPathPos } = closestUnitByPath;
      if (buffIds === undefined || closestUnitByPathPos === undefined) return;
      const ordersAndPendingOrders = getPendingOrders(queen).concat(orders);
      if (queen.canInject()) {
        const noInjectingOrder = ordersAndPendingOrders.every(order => order.abilityId !== EFFECT_INJECTLARVA);
        if (noInjectingOrder && !buffIds.includes(QUEENSPAWNLARVATIMER)) {
          const unitCommand = createUnitCommand(EFFECT_INJECTLARVA, [queen]);
          unitCommand.targetUnitTag = closestUnitByPath.tag;
          collectedActions.push(unitCommand);
          setPendingOrders(queen, unitCommand);
          closestUnitByPath.labels.delete('queenSpawnTimerLeft');
        }
      } else {
        const [closestBase] = units.getClosest(closestUnitByPathPos, units.getBases());
        const { pos: closestBasePos } = closestBase;
        if (closestBasePos === undefined) return;
        const noMoveOrderToBase = ordersAndPendingOrders.every(order => {
          const { abilityId, targetWorldSpacePos } = order;
          if (targetWorldSpacePos === undefined) return true; 
          return abilityId !== MOVE || !areEqual(targetWorldSpacePos, closestBasePos);
        });
        if (noMoveOrderToBase) {
          const unitCommand = createUnitCommand(MOVE, [queen]);
          unitCommand.targetWorldSpacePos = closestBase.pos;
          collectedActions.push(unitCommand);
          setPendingOrders(queen, unitCommand);
        }
      }
    }
  });
  return collectedActions;
}

/**
 * @param {ResourceManager} resources 
 * @returns {{base: Unit, timeLeft: number}[]}
 */
function getBaseAndQueenSpawnTimerLeft(resources) {
  const { frame, units } = resources.get();
  return units.getBases().map(base => {
    const { buffIds } = base;
    if (buffIds === undefined) return { base, timeLeft: 0 };
    if (buffIds.includes(QUEENSPAWNLARVATIMER)) {
      if (!base.labels.get('queenSpawnLarvatimer')) {
        base.labels.set('queenSpawnLarvatimer', frame.getGameLoop());
        return { base, timeLeft: 40 / 1.4 };
      } else {
        const queenSpawnLarvatimer = base.labels.get('queenSpawnLarvatimer');
        const timeLeft = 40 / 1.4 - getTimeInSeconds(frame.getGameLoop() - queenSpawnLarvatimer);
        return { base, timeLeft };
      }
    } else {
      base.labels.delete('queenSpawnLarvatimer');
      return { base, timeLeft: 0 };
    }
  });
}

function getEnergyRegenRate() { 
  return 0.7875;
}

/**
 * @param {ResourceManager} resources 
 * @param {Unit} unit 
 * @param {Point2D} target 
 * @returns {number}
 */
function getTimeToDistance(resources, unit, target) {
  const { pos } = unit;
  if (pos === undefined) return Infinity
  const distanceByPath = getDistanceByPath(resources, pos, target);
  const movementSpeed = getMovementSpeed(unit);
  if (movementSpeed === undefined) return Infinity;
  return distanceByPath / movementSpeed;
}