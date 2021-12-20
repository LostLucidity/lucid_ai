//@ts-check
"use strict"

const { UnitTypeId, Ability, UnitType } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes, combatTypes } = require("@node-sc2/core/constants/groups");
const { PYLON, CYCLONE, ZERGLING } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes } = require("../helper/groups");
const { findPlacements, findPosition } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { balanceResources } = require("../systems/manage-resources");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { addEarmark, calculateNearDPSHealth, getUpgradeBonus, calculateDPSHealthOfTrainingUnits } = require("./data-service");
const { formatToMinutesAndSeconds } = require("./logging-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("../systems/unit-resource/unit-resource-service");
const { premoveBuilderToPosition, getUnitsById, getUnitTypeData } = require("../systems/unit-resource/unit-resource-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel } = require("./units-service");

const worldService = {
  /** @type {boolean} */
  outpowered: false,
  /** @type {number} */
  totalEnemyDPSHealth: 0,
  /** @type {number} */
  totalSelfDPSHealth: 0,
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
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {Point2D}
   */
  getPositionVersusTargetUnit: (world, unit, targetUnit) => {
    const { data, resources } = world;
    const totalRadius = unit.radius + targetUnit.radius + 1;
    const range = Math.max.apply(Math, data.getUnitTypeData(unit.unitType).weapons.map(weapon => { return weapon.range; })) + totalRadius;
    if (distance(unit.pos, targetUnit.pos) < range) {
      const corrosiveBileArea = [];
      const RAVAGERCORROSIVEBILECP = 11;
      const corrosiveBileRadius = data.getEffectData(RAVAGERCORROSIVEBILECP).radius;
      resources.get().frame.getEffects().forEach(effect => {
        if (effect.effectId === RAVAGERCORROSIVEBILECP) {
          corrosiveBileArea.push(...gridsInCircle(effect.pos[0], corrosiveBileRadius))
        }
      });
      const outerRangeOfEnemy = gridsInCircle(targetUnit.pos, range).filter(grid => {
        return distance(grid, targetUnit.pos) >= (range - 0.5) && corrosiveBileArea.every(position => distance(position, unit.pos) > corrosiveBileRadius + unit.radius);
      });
      const [closestCandidatePosition] = getClosestPosition(avgPoints(unit['selfUnits'].map((/** @type {Unit} */ unit) => unit.pos)), outerRangeOfEnemy);
      return closestCandidatePosition;
    } else {
      return targetUnit.pos;
    }
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
   * @param {World} world 
   * @param {UnitTypeId[]} unitTypes 
   * @returns 
   */
  getTrainingPower: (world) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const trainingUnitTypes = worldService.getTrainingUnitTypes(world);
    const { enemyCombatUnits } = enemyTrackingService;
    return trainingUnitTypes.reduce((previousValue, unitType) => {
      const weapon = data.getUnitTypeData(unitType).weapons[0];
      let dPSHealth = 0;
      if (weapon) {
        const unitTypeData = getUnitTypeData(units, unitType);
        if (unitTypeData) {
          const { healthMax, shieldMax } = unitTypeData;
          const [unit] = units.getAlive(Alliance.SELF);
          const weaponUpgradeDamage = weapon.damage + (getAttackUpgradeLevel(Alliance.SELF) * getUpgradeBonus(Alliance.SELF, weapon.damage));
          const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyCombatUnits.map(enemyCombatUnit => enemyCombatUnit.unitType));
          const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(Alliance.SELF) + weaponBonusDamage;
          dPSHealth = weaponDamage / weapon.speed * (healthMax + shieldMax);
          dPSHealth = unitType === ZERGLING ? dPSHealth * 2 : dPSHealth;
        }
      }
      return previousValue + dPSHealth
    }, 0);
  },
  /**
   * @param {World} world
   * @returns {UnitTypeId[]}
   */
  getTrainingUnitTypes: (world) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const trainingUnitTypes = [];
    combatTypes.forEach(type => {
      let abilityId = data.getUnitTypeData(type).abilityId;
      trainingUnitTypes.push(...units.withCurrentOrders(abilityId).map(() => type));
    });
    return trainingUnitTypes;
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
    const { resources } = world;
    if (distance(unit.pos, targetPosition) < 4) {
      worldService.setAndLogExecutedSteps(world, resources.get().frame.timeInSeconds(), UnitTypeId[unitType], targetPosition);
    }
  },
  /**
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  microRangedUnit: (world, unit, targetUnit) => {
    const { data } = world;
    const collectedActions = [];
    if (
      (unit.weaponCooldown > 12 || unit.unitType === CYCLONE) &&
      data.getUnitTypeData(targetUnit.unitType).weapons.some(weapon => { return weapon.range; })
    ) {
      const microPosition = worldService.getPositionVersusTargetUnit(world, unit, targetUnit)
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: microPosition,
        unitTags: [unit.tag],
      });
    } else {
      const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
      unitCommand.targetWorldSpacePos = targetUnit.pos;
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  /**
   * 
   * @param {World} world
   * @param {number} time 
   * @param {string} name 
   * @param {string | Point2D} notes 
  */
  setAndLogExecutedSteps: (world, time, name, notes = '') => {
    const { agent, data } = world;
    const { foodUsed, minerals, vespene } = agent;
    /**
     * @type {(string | number | boolean | Point2D)[]}
     */
    const buildStepExecuted = [foodUsed, formatToMinutesAndSeconds(time), name, planService.currentStep, worldService.outpowered, `${minerals}/${vespene}`];
    const count = UnitType[name] ? getUnitsById(world.resources.get().units, UnitType[name]).length + 1 : 0;
    if (count) buildStepExecuted.push(count);
    if (notes) buildStepExecuted.push(notes);
    console.log(buildStepExecuted);
    const lastElement = loggingService.executedSteps.length - 1;
    const lastStep = loggingService.executedSteps[lastElement];
    let matchingLastStep = false;
    if (lastStep) {
      matchingLastStep = buildStepExecuted[2] === lastStep[2] && buildStepExecuted[6] === lastStep[6];
      const isStructure = UnitType[name] && data.getUnitTypeData(UnitType[name]).attributes.includes(Attribute.STRUCTURE);
      if (matchingLastStep && !isStructure) {
        matchingLastStep = matchingLastStep && buildStepExecuted[3] === lastStep[3];
      }
    }
    matchingLastStep ? loggingService.executedSteps.splice(lastElement, 1, buildStepExecuted) : loggingService.executedSteps.push(buildStepExecuted);
  },
  /**
   * @param {World} world
   * @param {Unit[]} units
   * @param {Unit[]} enemyUnits 
   * @returns {void}
   */
  setEnemyDPSHealthPower: (world, units, enemyUnits) => {
    const { data, resources } = world;
    units.forEach(unit => {
      unit['enemyUnits'] = enemyUnits.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16)
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['enemyDPSHealth'] = dataService.calculateNearDPSHealth(data, unit['enemyUnits'], (closestEnemyUnit && closestEnemyUnit['selfUnits']) ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },
  /**
   * Sets list of selfUnits and calculates DPSHealth for selfUnits within a 16 distance range.
   * @param {World} world 
   * @param {Unit[]} units
   * @param {Unit[]} enemyUnits
   * @returns {void}
   */
  setSelfDPSHealthPower: (world, units, enemyUnits) => {
    const { data, resources } = world;
    units.forEach(unit => {
      unit['selfUnits'] = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['selfDPSHealth'] = dataService.calculateNearDPSHealth(data, unit['selfUnits'], closestEnemyUnit ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },
  /**
   * @param {World} world 
   */
  setTotalEnemyDPSHealth: (world) => {
    const { data, resources } = world;
    const selfCombatUnits = resources.get().units.getCombatUnits();
    const { enemyCombatUnits } = enemyTrackingService;
    worldService.totalEnemyDPSHealth = enemyCombatUnits.reduce((totalDPSHealth, unit) => {
      return totalDPSHealth + calculateNearDPSHealth(data, [unit], [...selfCombatUnits.map(selfCombatUnit => selfCombatUnit.unitType), ...worldService.getTrainingUnitTypes(world)]);
    }, 0);
  },
  /**
   * @param {World} world 
   */
  setTotalSelfDPSHealth: (world) => {
    const { data, resources } = world;
    const selfCombatUnits = resources.get().units.getCombatUnits();
    const { enemyCombatUnits } = enemyTrackingService;
    worldService.totalSelfDPSHealth = selfCombatUnits.reduce((totalDPSHealth, unit) => {
      return totalDPSHealth + calculateNearDPSHealth(data, [unit], enemyCombatUnits.map(enemyCombatUnit => enemyCombatUnit.unitType));
    }, 0);
    worldService.totalSelfDPSHealth += worldService.getTrainingUnitTypes(world).reduce((totalDPSHealth, unitType) => {
      return totalDPSHealth + calculateDPSHealthOfTrainingUnits(data, [unitType], Alliance.SELF, enemyCombatUnits);
    }, 0);
  },
  /**
   * Unpause and log on attempted steps.
   * @param {World} world 
   * @param {string} name 
   * @param {string} extra 
  */
  unpauseAndLog: (world, name, extra = '') => {
    const { resources } = world;
    const { frame } = resources.get();
    planService.pausePlan = false;
    planService.continueBuild = true;
    worldService.setAndLogExecutedSteps(world, frame.timeInSeconds(), name, extra);
  },
}

module.exports = worldService;