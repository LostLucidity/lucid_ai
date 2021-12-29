//@ts-check
"use strict"

const { UnitTypeId, Ability, UnitType } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, SMART, STOP } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes, combatTypes, vespeneGeyserTypes, mineralFieldTypes, workerTypes, townhallTypes } = require("@node-sc2/core/constants/groups");
const { PYLON, CYCLONE, ZERGLING, LARVA } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes } = require("../helper/groups");
const { findPlacements, findPosition } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { balanceResources } = require("../systems/manage-resources");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { addEarmark, calculateNearDPSHealth } = require("./data-service");
const { formatToMinutesAndSeconds } = require("./logging-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("../systems/unit-resource/unit-resource-service");
const { getUnitsById, getUnitTypeData, isRepairing } = require("../systems/unit-resource/unit-resource-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel } = require("./units-service");
const { GasMineRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { calculateHealthAdjustedSupply, getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { distanceByPath } = require("../helper/get-closest-by-path");
const canAfford = require("../helper/can-afford");

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
    const { agent, data, resources } = world;
    const { map, units } = resources.get();
    const { abilityId } = data.getUnitTypeData(unitType);
    const collectedActions = [];
    const builder = unitService.selectBuilder(units, abilityId, position);
    if (builder) {
      if (!builder.isConstructing() && !isPendingContructing(builder)) {
        builder.labels.set('builder', true);
        const unitCommand = createUnitCommand(abilityId, [builder]);
        if (GasMineRace[agent.race] === unitType) {
          const [geyser] = map.freeGasGeysers();
          unitCommand.targetUnitTag = geyser.tag;
          collectedActions.push(unitCommand);
          const smartUnitCommand = createUnitCommand(SMART, [builder]);
          const [closestMineralField] = units.getClosest(builder.pos, units.getByType(mineralFieldTypes))
          smartUnitCommand.targetWorldSpacePos = closestMineralField.pos;
          smartUnitCommand.queueCommand = true;
          collectedActions.push(smartUnitCommand);
        } else {
          unitCommand.targetWorldSpacePos = position;
          collectedActions.push(unitCommand);
        }
        console.log(`Command given: ${Object.keys(Ability).find(ability => Ability[ability] === abilityId)}`);
        worldService.logActionIfNearPosition(world, unitType, builder, position);
        unitService.setPendingOrders(builder, unitCommand);
        collectedActions.push(...unitService.stopOverlappingBuilders(units, builder, position));
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @returns {Promise<void>}
   */
  buildWorkers: async (world) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const workerType = WorkerRace[agent.race];
    if (canAfford(agent, data, workerType)) {
      if (agent.race === Race.ZERG) {
        if (units.getById(LARVA).length > 0) {
          try { await actions.train(workerType); } catch (error) { console.log(error) }
        }
      } else {
        const idleTownhalls = units.getById(townhallTypes, { alliance: Alliance.SELF, buildProgress: 1, noQueue: true })
          .filter(townhall => townhall.abilityAvailable(data.getUnitTypeData(workerType).abilityId));
        if (idleTownhalls.length > 0) {
          try { await actions.train(workerType); } catch (error) { console.log(error) }
        }
      }
    }
  },
  /**
   * Calculate DPS health base on ally units and enemy armor upgrades.
   * @param {World} world 
   * @param {UnitTypeId[]} unitTypes
   * @param {Alliance} alliance
   * @param {Unit[]} enemyUnits 
   * @returns {number}
   */

  calculateDPSHealthOfTrainingUnits: (world, unitTypes, alliance, enemyUnits) => {
    return unitTypes.reduce((totalDPSHealth, unitType) => {
      if (workerTypes.includes(unitType)) {
        return totalDPSHealth;
      } else {
        return totalDPSHealth + worldService.getDPSHealthOfTrainingUnit(world, unitType, alliance, enemyUnits);
      }
    }, 0);
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
        const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
        collectedActions.push(...worldService.premoveBuilderToPosition(world, planService.foundPosition, unitType));
        await balanceResources(world, mineralCost / vespeneCost);
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    } else {
      const [pylon] = units.getById(PYLON);
      if (pylon && pylon.buildProgress < 1) {
        collectedActions.push(...worldService.premoveBuilderToPosition(world, pylon.pos, pylon.unitType));
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
   * @param {UnitTypeId} unitType
   * @param {Alliance} alliance
   * @param {Unit[]} enemyUnits 
   */
  getDPSHealthOfTrainingUnit: (world, unitType, alliance, enemyUnits) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const weapon = data.getUnitTypeData(unitType).weapons[0];
    let dPSHealth = 0;
    if (weapon) {
      const unitTypeData = getUnitTypeData(units, unitType);
      if (unitTypeData) {
        const { healthMax, shieldMax } = unitTypeData;
        const weaponUpgradeDamage = weapon.damage + (getAttackUpgradeLevel(alliance) * dataService.getUpgradeBonus(alliance, weapon.damage));
        const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyUnits.map(enemyUnit => enemyUnit.unitType));
        const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(alliance) + weaponBonusDamage;
        dPSHealth = weaponDamage / weapon.speed * (healthMax + shieldMax);
        dPSHealth = unitType === ZERGLING ? dPSHealth * 2 : dPSHealth;
      }
    }
    return dPSHealth;
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
   * @returns {number}
   */
  getTrainingPower: (world) => {
    const trainingUnitTypes = worldService.getTrainingUnitTypes(world);
    const { enemyCombatUnits } = enemyTrackingService;
    return trainingUnitTypes.reduce((totalDPSHealth, unitType) => {
      return totalDPSHealth + worldService.getDPSHealthOfTrainingUnit(world, unitType, Alliance.SELF, enemyCombatUnits);
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
   * @param {World} world 
   * @param {Unit} worker 
   * @param {Unit} targetUnit 
   * @returns {boolean}
   */
  defendWithUnit: (world, worker, targetUnit) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const inRangeEnemySupply = calculateHealthAdjustedSupply(world, getInRangeUnits(targetUnit, [...enemyTrackingService.mappedEnemyUnits]));
    const amountToFightWith = Math.ceil(inRangeEnemySupply / data.getUnitTypeData(WorkerRace[agent.race]).foodRequired);
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy', 'builder']) && !isRepairing(unit));
    const fighters = units.getClosest(targetUnit.pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), amountToFightWith);
    return fighters.some(fighter => fighter.tag === worker.tag);
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
   * @param {World} world 
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  premoveBuilderToPosition: (world, position, unitType) => {
    const { agent, data, resources } = world;
    const { frame, units } = resources.get();
    const collectedActions = [];
    const builder = unitResourceService.selectBuilder(units, MOVE, position);
    if (builder) {
      // get speed, distance and average collection rate
      const { movementSpeed } = builder.data();
      const distanceToPosition = distanceByPath(resources, builder.pos, position);
      const unitCommand = builder ? createUnitCommand(MOVE, [builder]) : {};
      const { collectionRateMinerals } = frame.getObservation().score.scoreDetails;
      const timeToPosition = distanceToPosition / movementSpeed;
      const { mineralCost } = data.getUnitTypeData(unitType);
      const mineralsLeft = mineralCost - agent.minerals;
      const timeToTargetCost = mineralsLeft / (collectionRateMinerals / 60);
      if (timeToTargetCost <= timeToPosition) {
        unitCommand.targetWorldSpacePos = position;
        collectedActions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, builder, position));
      } else {
        if (builder.orders.some(order => order.targetWorldSpacePos && order.targetWorldSpacePos.x === position.x && order.targetWorldSpacePos.y === position.y)) {
          collectedActions.push(createUnitCommand(STOP, [builder]));
        }
      }
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
      return totalDPSHealth + worldService.calculateDPSHealthOfTrainingUnits(world, [unitType], Alliance.SELF, enemyCombatUnits);
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