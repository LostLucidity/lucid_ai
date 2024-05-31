// src/core/common/buildUtils.js

const { Ability } = require("@node-sc2/core/constants");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const EarmarkManager = require("./EarmarkManager");
const { getAddOnPlacement, pointsOverlap } = require("../../gameLogic/pathfinding");
const { getDistance } = require("../../gameLogic/spatialCoreUtils");
const { setPendingOrders } = require("../../units/management/unitOrders");
const { seigeTanksSiegedGrids } = require("../../utils/sharedUnitPlacement");

/**
 * Attempt to build addOn
 * @param {World} world
 * @param {Unit} unit
 * @param {UnitTypeId} addOnType
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function attemptBuildAddOn(world, unit, addOnType, unitCommand) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { pos } = unit; if (pos === undefined) return [];
  const addonPlacement = getAddOnPlacement(pos);
  const addOnFootprint = getFootprint(addOnType);

  if (addOnFootprint === undefined) return [];

  const canPlace = map.isPlaceableAt(addOnType, addonPlacement) &&
    !pointsOverlap(cellsInFootprint(addonPlacement, addOnFootprint), seigeTanksSiegedGrids);

  if (!canPlace) return [];

  unitCommand.targetWorldSpacePos = unit.pos;
  setPendingOrders(unit, unitCommand);
  EarmarkManager.getInstance().addEarmark(data, data.getUnitTypeData(addOnType));

  return [unitCommand];
}

/**
 * Attempt to lift off the unit if it doesn't have pending orders.
 * @param {Unit} unit 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function attemptLiftOff(unit) {
  const { pos, tag } = unit; if (pos === undefined || tag === undefined) return [];
  const collectedActions = [];

  if (!unit.labels.has('pendingOrders')) {
    const addOnPosition = unit.labels.get('addAddOn');
    if (addOnPosition && getDistance(getAddOnPlacement(pos), addOnPosition) < 1) {
      unit.labels.delete('addAddOn');
    } else {
      unit.labels.set('addAddOn', null);
      const unitCommand = {
        abilityId: Ability.LIFT,
        unitTags: [tag],
      };
      collectedActions.push(unitCommand);
      setPendingOrders(unit, unitCommand);
    }
  }

  return collectedActions;
}

module.exports = {
  attemptBuildAddOn,
  attemptLiftOff,
};