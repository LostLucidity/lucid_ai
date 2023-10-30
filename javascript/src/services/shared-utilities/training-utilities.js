//@ts-check
"use strict";

const groupTypes = require("@node-sc2/core/constants/groups");
const unitService = require("../../../services/unit-service");
const { addEarmark } = require("./common-utilities");
const { createUnitCommand } = require("./command-utilities");
const { checkAddOnPlacement, checkUnitCount } = require("../unit-analysis");
const { Ability, UnitTypeId, UnitType } = require("@node-sc2/core/constants");
const { unpauseAndLog } = require("../shared-functions");
const { getDistance } = require("../../../services/position-service");
const { getAddOnBuildingPosition } = require("../../../helper/placement/placement-utilities");
const armyManagementService = require("../army-management/army-management-service");
const { WARPGATE } = require("@node-sc2/core/constants/unit-type");
const resourceManagerService = require("../../../services/resource-manager-service");
const { getTrainer, canBuild } = require("./training-shared-utils");
const unitRetrievalService = require("../unit-retrieval");

/**
 * Train a unit.
 * @param {World} world The current game world.
 * @param {UnitTypeId} unitTypeId Type of the unit to train.
 * @param {number | null} targetCount Target number of units.
 * @returns {Promise<void>}
 */
async function train(world, unitTypeId, targetCount = null) {
  const {
    getPendingOrders, setPendingOrders
  } = unitService;

  const {
    agent, data, resources
  } = world;

  const { reactorTypes, techLabTypes } = groupTypes;
  const { actions, units } = resources.get();
  const unitTypeData = data.getUnitTypeData(unitTypeId);
  const { abilityId } = unitTypeData;

  if (abilityId === undefined) return;
  const currentUnitTypeCount = unitRetrievalService.getUnitTypeCount(world, unitTypeId);
  let earmarkNeeded = targetCount && currentUnitTypeCount < targetCount;

  const sendCommand = async (/** @type {number} */ ability, /** @type {Unit} */ unit, /** @type {Point2D | null} */ targetPos = null) => {
    const unitCommand = createUnitCommand(ability, [unit]);
    if (targetPos) unitCommand.targetWorldSpacePos = targetPos;
    await actions.sendAction(unitCommand);
    setPendingOrders(unit, unitCommand);
    return unitCommand;
  };

  const setRepositionLabel = (/** @type {Unit} */ unit, /** @type {Point2D} */ position) => {
    unit.labels.set('reposition', position);
    console.log('reposition', position);
  };

  const handleNonWarpgateTrainer = async (/** @type {Unit} */ trainer) => {
    if (trainer.isFlying) {
      const landingPosition = checkAddOnPlacement(world, trainer);
      if (landingPosition) {
        setRepositionLabel(trainer, landingPosition);
        await sendCommand(Ability.LAND, trainer, landingPosition);
      }
    } else {
      await sendCommand(abilityId, trainer);
      unpauseAndLog(world, UnitTypeId[unitTypeId]);
    }
  };

  const selectRandomUnit = (/** @type {Unit[]} */ unitList) => unitList[Math.floor(Math.random() * unitList.length)];

  const handleTechRequirements = (/** @type {Unit} */ unit, /** @type {number} */ techRequirement) => {
    if (!techRequirement) return;

    const matchingAddOnTypes = techLabTypes.includes(techRequirement)
      ? techLabTypes
      : reactorTypes.includes(techRequirement)
        ? reactorTypes
        : [techRequirement];

    const techLabUnits = units.getById(matchingAddOnTypes).filter(unit => unit.unitType !== techRequirement);

    if (techLabUnits.length > 0) {
      const techLab = techLabUnits.reduce((closestTechLab, techLab) => {
        const techLabPos = techLab.pos;
        if (!techLabPos) {
          return closestTechLab;  // return the current closestTechLab if techLabPos is undefined
        }

        const closestTechLabPos = closestTechLab.pos;
        if (!closestTechLabPos) {
          return closestTechLab;  // return the current closestTechLab if closestTechLabPos is undefined
        }

        if (!unit.pos) {
          return closestTechLab;  // return the current closestTechLab if unit.pos is undefined
        }

        return getDistance(techLabPos, unit.pos) < getDistance(closestTechLabPos, unit.pos)
          ? techLab
          : closestTechLab;
      }, techLabUnits[0]);

      if (techLab) {
        const techLabPosition = techLab.pos;
        const [currentBuilding] = units.getClosest(getAddOnBuildingPosition(techLabPosition), units.getStructures().filter(structure => structure.addOnTag === techLab.tag && structure.buildProgress === 1));

        if (currentBuilding) {
          unit.labels.set('reposition', getAddOnBuildingPosition(techLabPosition));
          const [addOnBuilding] = units.getClosest(getAddOnBuildingPosition(techLabPosition), units.getStructures().filter(structure => structure.addOnTag === techLab.tag));
          if (addOnBuilding) {
            addOnBuilding.labels.set('reposition', 'lift');
          }
        }
      }
    }
  };

  const handleUnitBuilding = (/** @type {Unit} */ unit) => {
    const { requireAttached, techRequirement } = unitTypeData;
    if (requireAttached && unit.addOnTag && parseInt(unit.addOnTag) === 0) {
      if (typeof techRequirement !== 'undefined') {
        const matchingAddOnTypes = techLabTypes.includes(techRequirement) ? techLabTypes : reactorTypes.includes(techRequirement) ? reactorTypes : [techRequirement];
        const requiredAddOns = units.getById(matchingAddOnTypes).filter(addOn => {
          const addOnBuilding = units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures().filter(structure => structure.addOnTag === addOn.tag && structure.buildProgress === 1))[0];
          return addOnBuilding && addOnBuilding.noQueue && getPendingOrders(addOnBuilding).length === 0;
        });
        const addOn = selectRandomUnit(requiredAddOns);
        if (addOn) {
          unit.labels.set('reposition', getAddOnBuildingPosition(addOn.pos));
          const addOnBuilding = units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures().filter(structure => structure.addOnTag === addOn.tag))[0];
          if (addOnBuilding) {
            addOnBuilding.labels.set('reposition', 'lift');
          }
        }
      }
    }

    const unitCommand = createUnitCommand(abilityId, [unit]);
    setPendingOrders(unit, unitCommand);
  };

  // Move the logic for determining if a unit can be trained here
  const canTrainUnit = (/** @type {World} */ world, /** @type {number} */ unitTypeId) => {
    return targetCount === null || checkUnitCount(world, unitTypeId, targetCount);
  };

  if (canTrainUnit(world, unitTypeId)) {
    earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
    const trainers = getTrainer(world, unitTypeId);
    const safeTrainers = trainers.filter(trainer => {
      if (trainer.pos) {
        return armyManagementService.isStrongerAtPosition(world, trainer.pos);
      }
      return false;
    });
    const randomSafeTrainer = selectRandomUnit(safeTrainers);

    if (randomSafeTrainer && canBuild(world, unitTypeId)) {
      if (randomSafeTrainer.unitType !== WARPGATE) {
        await handleNonWarpgateTrainer(randomSafeTrainer);
      } else {
        unpauseAndLog(world, UnitTypeId[unitTypeId]);
        await resourceManagerService.warpIn(resources, this, unitTypeId);
      }
      console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`);
      earmarkNeeded = true;
    }

    if (!canBuild(world, unitTypeId)) {
      const { requireAttached, techRequirement } = unitTypeData;
      if (requireAttached || techRequirement) {
        let canDoTypes = data.findUnitTypesWithAbility(abilityId);
        const canDoUnits = units.getById(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
        let unit = selectRandomUnit(canDoUnits);

        if (!unit && agent.canAfford(unitTypeId)) {
          if (typeof techRequirement === 'number') {
            handleTechRequirements(unit, techRequirement);
          } else {
            // Handle the case where techRequirement is undefined.
            return; // or provide some default logic
          }
        } else if (!unit) {
          const idleUnits = units.getById(canDoTypes).filter(unit => unit.isIdle() && unit.buildProgress === 1);
          const unitToReserve = selectRandomUnit(idleUnits);
          if (unitToReserve) {
            const unitCommand = createUnitCommand(abilityId, [unitToReserve]);
            setPendingOrders(unitToReserve, unitCommand);
          }
        } else {
          handleUnitBuilding(unit);
        }
      }
      earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
    }
  }
  earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
}

module.exports = {
  train
};


// Helper Functions
/**
 * Earmark resources if needed.
 *
 * @param {World} world
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 * @param {number | boolean | null} earmarkNeeded
 * @returns {boolean}
 */
const earmarkResourcesIfNeeded = (world, unitTypeData, earmarkNeeded) => {
  const earmarkNeededBool = Boolean(earmarkNeeded);

  if (earmarkNeededBool) {
    addEarmark(world.data, unitTypeData);
  }

  return !earmarkNeededBool;
};