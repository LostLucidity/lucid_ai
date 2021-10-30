//@ts-check
"use strict"

const { UnitTypeId, Ability, UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes } = require("@node-sc2/core/constants/groups");
const { PYLON } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { countTypes } = require("../helper/groups");
const { findPlacements, findPosition } = require("../helper/placement/placement-helper");
const { balanceResources } = require("../systems/manage-resources");
const scoutService = require("../systems/scouting/scouting-service");
const { addEarmark } = require("./data-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("./units-service");
const { premoveBuilderToPosition, getUnitsById } = require("./units-service");

const worldService = {
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
        worldService.logActionIfNearPosition(world, unitType, builder, position);
        collectedActions.push(unitCommand);
        unitService.setPendingOrders(builder, unitCommand);
        collectedActions.push(...unitService.stopOverlappingBuilders(units, builder, abilityId, position));
      }
    }
    return collectedActions;
  },
  /**
  * Returns boolean on whether build step should be executed.
  * @param {World} world 
  * @param {UnitTypeId} unitType 
  * @param {number} targetCount 
  * @returns {boolean}
  */
  checkBuildingCount: (world, unitType, targetCount) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
    const unitsWithCurrentOrders = worldService.getUnitsWithCurrentOrders(units, abilityIds);
    let count = unitsWithCurrentOrders.length;
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    unitTypes.forEach(type => {
      let unitsToCount = units.getById(type);
      if (agent.race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  },
  /**
   * @param {World} world
   * @param {number} unitType
   * @param {Point2D[]} candidatePositions
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  findAndPlaceBuilding: async (world, unitType, candidatePositions) => {
    const { agent, data, resources } = world
    const collectedActions = []
    const { actions, units } = resources.get();
    if (candidatePositions.length === 0) { candidatePositions = await findPlacements(world, unitType); }
    planService.foundPosition = planService.foundPosition ? planService.foundPosition : await findPosition(resources, unitType, candidatePositions);
    if (planService.foundPosition) {
      if (agent.canAfford(unitType)) {
        if (await actions.canPlace(unitType, [planService.foundPosition])) {
          await actions.sendAction(worldService.assignAndSendWorkerToBuild(world, unitType, planService.foundPosition));
          planService.pausePlan = false;
          planService.continueBuild = true;
          addEarmark(data, data.getUnitTypeData(unitType));
          planService.foundPosition = null;
        } else {
          planService.foundPosition = null;
          planService.pausePlan = true;
          planService.continueBuild = false;
        }
      } else {
        collectedActions.push(...premoveBuilderToPosition(units, planService.foundPosition));
        const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
        await balanceResources(world, mineralCost / vespeneCost);
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    } else {
      const [pylon] = units.getById(PYLON);
      if (pylon && pylon.buildProgress < 1) {
        collectedActions.push(...premoveBuilderToPosition(units, pylon.pos));
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  },
  /**
   * @param {DataStorage} data
   * @param {UnitTypeId} unitType
   * @returns {AbilityId[]}
   */
  getAbilityIdsForAddons: (data, unitType) => {
    let { abilityId } = data.getUnitTypeData(unitType);
    let abilityIds = [];
    if (abilityId === 1674) {
      abilityIds.push(...worldService.getReactorAbilities(data));
    } else if (abilityId === 1666) {
      abilityIds.push(...worldService.getTechlabAbilities(data));
    } else {
      abilityIds.push(abilityId);
    }
    return abilityIds;
  },
  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getReactorAbilities: (data) => {
    const reactorAbilities = [];
    reactorTypes.forEach(type => {
      reactorAbilities.push(data.getUnitTypeData(type).abilityId)
    });
    return reactorAbilities;
  },
  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getTechlabAbilities: (data) => {
    const techlabAbilities = [];
    techLabTypes.forEach(type => {
      techlabAbilities.push(data.getUnitTypeData(type).abilityId)
    });
    return techlabAbilities;
  },
  /**
   * @param {UnitResource} units
   * @param {AbilityId[]} abilityIds
   * @returns {Unit[]}
   */
  getUnitsWithCurrentOrders: (units, abilityIds) => {
    const unitsWithCurrentOrders = [];
    abilityIds.forEach(abilityId => {
      unitsWithCurrentOrders.push(...units.withCurrentOrders(abilityId));
    });
    return unitsWithCurrentOrders;
  },
  /**
   * 
   * @param {DataStorage} data 
   * @param {AbilityId[]} abilityIds
   * @returns {UnitTypeId[]}
   */
  getUnitTypesWithAbilities: (data, abilityIds) => {
    const unitTypesWithAbilities = [];
    abilityIds.forEach(abilityId => {
      unitTypesWithAbilities.push(...data.findUnitTypesWithAbility(abilityId));
    });
    return unitTypesWithAbilities;
  },
  /**
   * 
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Point2D} targetPosition 
   * @param {number} unitType 
  */
  logActionIfNearPosition: (world, unitType, unit, targetPosition) => {
    const {  resources } = world;
    if (distance(unit.pos, targetPosition) < 4) {
      const note = `Distance: ${distance(unit.pos, targetPosition)}`;
      worldService.setAndLogExecutedSteps(world, resources.get().frame.timeInSeconds(), UnitTypeId[unitType], note);
    }
  },
  /**
   * 
   * @param {World} world
   * @param {number} time 
   * @param {string} name 
   * @param {string} notes 
  */
  setAndLogExecutedSteps: (world, time, name, notes = '') => {
    const { agent } = world;
    const { foodUsed, minerals, vespene } = agent;
    const buildStepExecuted = [foodUsed, loggingService.formatToMinutesAndSeconds(time), name, scoutService.outsupplied, `${minerals}/${vespene}`];
    const count = UnitType[name] ? getUnitsById(world.resources.get().units, UnitType[name]).length + 1 : 0;
    if (count) buildStepExecuted.push(count);
    if (notes) buildStepExecuted.push(notes);
    console.log(buildStepExecuted);
    loggingService.executedSteps.push(buildStepExecuted);
  },
}

module.exports = worldService;