//@ts-check
"use strict"

const fs = require('fs');
const { UnitTypeId, Ability, UnitType } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, SMART, STOP } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance, WeaponTargetType, RaceId } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes, combatTypes, mineralFieldTypes, workerTypes, townhallTypes, constructionAbilities } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints, createPoint2D, getNeighbors } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes } = require("../helper/groups");
const { findPosition } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { balanceResources } = require("../systems/manage-resources");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { addEarmark, getBuildTimeElapsed } = require("./data-service");
const { formatToMinutesAndSeconds, getStringNameOfConstant } = require("./logging-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("../systems/unit-resource/unit-resource-service");
const { getUnitsById, getUnitTypeData, isRepairing, calculateSplashDamage, getThirdWallPosition } = require("../systems/unit-resource/unit-resource-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel, getEnemyMovementSpeed } = require("./unit-service");
const { GasMineRace, WorkerRace, SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { calculateHealthAdjustedSupply, getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { distanceByPath, getClosestUnitByPath, getClosestPositionByPath } = require("../helper/get-closest-by-path");
const { rallyWorkerToTarget } = require("./resource-manager-service");
const { getPathablePositionsForStructure } = require("./map-resource-service");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getOccupiedExpansions } = require("../helper/expansions");
const { existsInMap, getCombatRally } = require("../helper/location");
const { pointsOverlap, intersectionOfPoints } = require("../helper/utilities");
const wallOffNaturalService = require("../systems/wall-off-natural/wall-off-natural-service");
const { findWallOffPlacement } = require("../systems/wall-off-ramp/wall-off-ramp-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { SPAWNINGPOOL } = require("@node-sc2/core/constants/unit-type");
const scoutingService = require("../systems/scouting/scouting-service");
const { getTimeInSeconds } = require("./frames-service");
const scoutService = require("../systems/scouting/scouting-service");
const path = require('path');
const foodUsedService = require('./food-used-service');
const { keepPosition } = require('./placement-service');

const worldService = {
  /** @type {boolean} */
  outpowered: false,
  /** @type {number} */
  totalEnemyDPSHealth: 0,
  /** @type {number} */
  totalSelfDPSHealth: 0,
  /** @type {boolean} */
  unitProductionAvailable: true,
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
    const builder = unitService.selectBuilder(resources, position);
    if (builder) {
      if (!builder.isConstructing() && !isPendingContructing(builder)) {
        builder.labels.set('builder', true);
        const unitCommand = createUnitCommand(abilityId, [builder]);
        if (GasMineRace[agent.race] === unitType) {
          const [geyser] = map.freeGasGeysers();
          const moveCommand = createUnitCommand(MOVE, [builder]);
          moveCommand.targetWorldSpacePos = geyser.pos;
          collectedActions.push(moveCommand);
          unitCommand.targetUnitTag = geyser.tag;
          unitCommand.queueCommand = true;
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
        addEarmark(data, data.getUnitTypeData(unitType));
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
    const workerTypeId = WorkerRace[agent.race];
    if (worldService.canBuild(world, workerTypeId)) {
      if (agent.race === Race.ZERG) {
        if (units.getById(UnitType.LARVA).length > 0) {
          try { await actions.train(workerTypeId); } catch (error) { console.log(error) }
        }
      } else {
        const idleTownhalls = units.getById(townhallTypes, { alliance: Alliance.SELF, buildProgress: 1, noQueue: true })
          .filter(townhall => townhall.abilityAvailable(data.getUnitTypeData(workerTypeId).abilityId));
        if (idleTownhalls.length > 0) {
          try { await actions.train(workerTypeId); } catch (error) { console.log(error) }
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
   * Calculate DPS health base on ally units and enemy armor upgrades.
   * @param {World} world 
   * @param {Unit[]} units
   * @param {UnitTypeId[]} enemyUnitTypes 
   * @returns {number}
   */
  calculateNearDPSHealth: (world, units, enemyUnitTypes) => {
    return units.reduce((accumulator, unit) => {
      if (unit.isWorker() && unit.isHarvesting() && !unit.labels.has('retreating') && !unit.labels.has('defending')) {
        return accumulator;
      } else {
        return accumulator + worldService.getDPSHealth(world, unit, enemyUnitTypes);
      }
    }, 0);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitTypeId 
   * @returns {boolean}
   */
  canBuild: (world, unitTypeId) => {
    const { agent } = world;
    return agent.canAfford(unitTypeId) && agent.hasTechFor(unitTypeId) && (!worldService.isSupplyNeeded(world) || unitTypeId === UnitType.OVERLORD)
  },
  /**
  * Returns boolean on whether build step should be executed.
  * @param {World} world 
  * @param {UnitTypeId} unitType 
  * @param {number} targetCount 
  * @returns {boolean}
  */
  checkBuildingCount: (world, unitType, targetCount) => {
    return worldService.getUnitTypeCount(world, unitType) === targetCount;
  },
  /**
   * @param {World} world
   * @param {number} unitType
   * @param {Point2D[]} candidatePositions
   * @param {boolean} stepAhead
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  findAndPlaceBuilding: async (world, unitType, candidatePositions, stepAhead) => {
    const { agent, data, resources } = world
    const collectedActions = []
    const { actions, frame, units } = resources.get();
    if (candidatePositions.length === 0) { candidatePositions = await worldService.findPlacements(world, unitType); }
    planService.foundPosition = planService.foundPosition ? planService.foundPosition : await findPosition(resources, unitType, candidatePositions);
    if (planService.foundPosition) {
      // get unitTypes that can build the building
      const { abilityId } = data.getUnitTypeData(unitType);
      const unitTypes = data.findUnitTypesWithAbility(abilityId);
      if (!unitTypes.includes(UnitType.NYDUSNETWORK)) {
        if (agent.canAfford(unitType) && !stepAhead) {
          if (await actions.canPlace(unitType, [planService.foundPosition])) {
            await actions.sendAction(worldService.assignAndSendWorkerToBuild(world, unitType, planService.foundPosition));
            planService.pausePlan = false;
            worldService.setAndLogExecutedSteps(world, frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType), planService.foundPosition);
            planService.continueBuild = true;
            addEarmark(data, data.getUnitTypeData(unitType));
            planService.foundPosition = null;
          } else {
            planService.foundPosition = keepPosition(resources, unitType, planService.foundPosition) ? planService.foundPosition : null;
            if (planService.foundPosition) {
              collectedActions.push(...worldService.premoveBuilderToPosition(world, planService.foundPosition, unitType, stepAhead));
            }
            if (!stepAhead) {
              planService.pausePlan = true;
              planService.continueBuild = false;
            }
          }
        } else {
          collectedActions.push(...worldService.premoveBuilderToPosition(world, planService.foundPosition, unitType, stepAhead));
          if (!stepAhead) {
            const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
            await balanceResources(world, mineralCost / vespeneCost);
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      } else {
        collectedActions.push(...await buildWithNydusNetwork(world, unitType, abilityId));
      }
      const [pylon] = units.getById(UnitType.PYLON);
      if (pylon && pylon.buildProgress < 1) {
        collectedActions.push(...worldService.premoveBuilderToPosition(world, pylon.pos, pylon.unitType, stepAhead));
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  },
  /**
 *
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Promise<Point2D[]>}
 */
  findPlacements: async (world, unitType) => {
    const { agent, resources } = world;
    const { race } = agent;
    const { actions, map, units } = resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    /**
     * @type {Point2D[]}
     */
    let placements = [];
    if (race === Race.PROTOSS) {
      if (unitType === UnitType.PYLON) {
        const occupiedExpansions = getOccupiedExpansions(resources);
        const occupiedExpansionsPlacementGrid = [...occupiedExpansions.map(expansion => expansion.areas.placementGrid)];
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(...grid));
        placements = placementGrids
          .filter((point) => {
            return (
              (distance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
              (natural.areas.hull.every(hp => distance(hp, point) > 3)) &&
              (units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => distance(eb, point) > 3))
            );
          });
      } else {
        let pylonsNearProduction;
        if (units.getById(UnitType.PYLON).length === 1) {
          pylonsNearProduction = units.getById(UnitType.PYLON);
        } else {
          pylonsNearProduction = units.getById(UnitType.PYLON)
            .filter(u => u.buildProgress >= 1)
            .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);
        }
        pylonsNearProduction.forEach(pylon => {
          placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true }).filter(grid => existsInMap(map, grid) && distance(grid, pylon.pos) < 6.5));
        });
        const wallOffUnitTypes = [...countTypes.get(UnitType.GATEWAY), UnitType.CYBERNETICSCORE];
        /**
         * @type {Point2D[]}
         */
        const wallOffPositions = [];
        if (wallOffUnitTypes.includes(unitType) && units.getById(wallOffUnitTypes).length < 3) {
          const currentlyEnrouteConstructionGrids = worldService.getCurrentlyEnrouteConstructionGrids(world);
          const placeablePositions = wallOffNaturalService.threeByThreePositions.filter(position => {
            const footprint = cellsInFootprint(createPoint2D(position), getFootprint(unitType));
            return map.isPlaceableAt(unitType, position) && pointsOverlap([...footprint], [...placements]) && !pointsOverlap([...footprint], [...currentlyEnrouteConstructionGrids])
          });
          if (placeablePositions.length > 0) {
            wallOffPositions.push(...placeablePositions);
          } else {
            if (wallOffNaturalService.wall.length > 0) {
              const cornerGrids = wallOffNaturalService.wall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), wallOffNaturalService.wall).length === 1);
              const wallRadius = distance(cornerGrids[0], cornerGrids[1]) / 2;
              wallOffPositions.push(...gridsInCircle(avgPoints(wallOffNaturalService.wall), wallRadius, { normalize: true }).filter(grid => {
                let existsAndPlaceable = existsInMap(map, grid) && map.isPlaceable(grid);
                if (units.getById(wallOffUnitTypes).length === 2) {
                  const foundThirdWallPosition = getThirdWallPosition(units.getById(wallOffUnitTypes), grid, unitType);
                  return existsAndPlaceable && foundThirdWallPosition;
                } else {
                  return existsAndPlaceable;
                }
              }));
            }
          }
        }
        if (wallOffPositions.length > 0 && intersectionOfPoints(wallOffPositions, placements).some(position => map.isPlaceableAt(unitType, position))) {
          placements = intersectionOfPoints(wallOffPositions, placements);
        }
        placements = placements.filter((point) => {
          return (
            (distance(natural.townhallPosition, point) > 5) &&
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (wallOffPositions.length > 0 || (natural.areas.hull.every(hp => distance(hp, point) > 2))) &&
            map.isPlaceableAt(unitType, point)
          );
        });
      }
    } else if (race === Race.TERRAN) {
      const placementGrids = [];
      const wallOffUnitTypes = [UnitType.SUPPLYDEPOT, UnitType.BARRACKS];
      if (wallOffUnitTypes.includes(unitType)) {
        const wallOffPositions = findWallOffPlacement(unitType);
        if (wallOffPositions.length > 0 && await actions.canPlace(unitType, wallOffPositions)) {
          return wallOffPositions;
        }
      }
      getOccupiedExpansions(world.resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      placements = placementGrids
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements.push(...findZergPlacements(resources, unitType))
    }
    return placements;
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
   * @returns {Point2D[]}
   */
  getCurrentlyEnrouteConstructionGrids: (world) => {
    const { data, resources } = world;
    const contructionGrids = [];
    resources.get().units.getWorkers().forEach(worker => {
      if (worker.isConstructing()) {
        const foundOrder = worker.orders.find(order => constructionAbilities.includes(order.abilityId));
        if (foundOrder && foundOrder.targetWorldSpacePos) {
          const foundUnitTypeName = Object.keys(UnitType).find(unitType => data.getUnitTypeData(UnitType[unitType]).abilityId === foundOrder.abilityId);
          if (foundUnitTypeName) {
            contructionGrids.push(...cellsInFootprint(createPoint2D(foundOrder.targetWorldSpacePos), getFootprint(UnitType[foundUnitTypeName])));
          }
        }
      }
    });
    return contructionGrids;
  },
  /**
   * @param {World} world 
   * @param {Unit} unit
   * @param {UnitTypeId[]} enemyUnitTypes 
   */
  getDPSHealth: (world, unit, enemyUnitTypes) => {
    const { data, resources } = world;
    const { units } = resources.get();
    let dPSHealth = 0;
    if (unit.buildProgress >= 1) {
      const weapon = data.getUnitTypeData(unit.unitType).weapons[0];
      if (weapon) {
        const weaponUpgradeDamage = weapon.damage + (unit.attackUpgradeLevel * dataService.getUpgradeBonus(unit.alliance, weapon.damage));
        const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyUnitTypes);
        const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(unit.alliance) + weaponBonusDamage;
        const weaponSplashDamage = calculateSplashDamage(units, unit.unitType, enemyUnitTypes);
        const weaponDPS = (weaponDamage * weapon.attacks * weaponSplashDamage) / weapon.speed;
        // get unit speed minus cooldown plus range plus radius
        const { weaponCooldownMax } = getUnitTypeData(units, unit.unitType);
        setWeaponCooldownMax(units, unit);
        const speedRangeFactor = (unit.data().movementSpeed * 1.4 - getTimeInSeconds(weaponCooldownMax)) + weapon.range + unit.radius;
        dPSHealth = weaponDPS * (unit.health + unit.shield) * speedRangeFactor;
      } else {
        // if no weapon, ignore
      }
    } else {
      // if not finished, ignore
    }
    return dPSHealth;
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
    let dPSHealth = 0;
    const weapon = data.getUnitTypeData(unitType).weapons[0];
    const { movementSpeed } = data.getUnitTypeData(unitType);
    if (weapon) {
      const unitTypeData = getUnitTypeData(units, unitType);
      if (unitTypeData) {
        const { healthMax, shieldMax, weaponCooldownMax } = unitTypeData;
        const weaponUpgradeDamage = weapon.damage + (getAttackUpgradeLevel(alliance) * dataService.getUpgradeBonus(alliance, weapon.damage));
        const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyUnits.map(enemyUnit => enemyUnit.unitType));
        const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(alliance) + weaponBonusDamage;
        const weaponSplashDamage = calculateSplashDamage(units, unitType, enemyUnits.map(enemyUnit => enemyUnit.unitType));
        const weaponDPS = (weaponDamage * weapon.attacks * weaponSplashDamage) / weapon.speed;
        const speedRangeFactor = (movementSpeed * 1.4 - getTimeInSeconds(weaponCooldownMax)) + weapon.range + unitTypeData.radius;
        dPSHealth = weaponDPS * (healthMax + shieldMax) * speedRangeFactor;
        dPSHealth = unitType === UnitType.ZERGLING ? dPSHealth * 2 : dPSHealth;
      }
    }
    return dPSHealth;
  },
  /**
   * @param {World} world
   */
  getFoodUsed: (world) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const { foodUsed, race } = agent;
    const pendingFoodUsed = race === Race.ZERG ? units.getWorkers().filter(worker => worker.isConstructing()).length : 0;
    return foodUsed + planService.pendingFood - pendingFoodUsed;
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
    const combatTypesPlusQueens = [...combatTypes, UnitType.QUEEN];
    combatTypesPlusQueens.forEach(type => {
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
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {number}
   */
  getUnitTypeCount: (world, unitType) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
    const unitsWithCurrentOrders = worldService.getUnitsWithCurrentOrders(units, abilityIds);
    let count = unitsWithCurrentOrders.length;
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    unitTypes.forEach(type => {
      let unitsToCount = units.getById(type);
      if (agent.race === Race.TERRAN) {
        const completed = type === UnitType.ORBITALCOMMAND ? 0.998 : 1;
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= completed);
      }
      count += unitsToCount.length;
    });
    return count;
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
   */
  getZergEarlyBuild(world) {
    const { data, resources } = world;
    const { frame, map, units } = resources.get();
    const zerglings = enemyTrackingService.mappedEnemyUnits.filter(unit => unit.unitType === UnitType.ZERGLING);
    const spawningPool = units.getById(SPAWNINGPOOL, { alliance: Alliance.ENEMY }).sort((a, b) => b.buildProgress - a.buildProgress)[0];
    const spawningPoolExists = spawningPool || zerglings.length > 0;
    const spawningPoolStartTime = spawningPool ? frame.timeInSeconds() - getBuildTimeElapsed(data, spawningPool) : null;
    const enemyNaturalHatchery = map.getEnemyNatural().getBase();
    const enemyNaturalHatcheryStartTime = enemyNaturalHatchery ? frame.timeInSeconds() - getBuildTimeElapsed(data, enemyNaturalHatchery) : null;
    const naturalCommandCenter = map.getNatural().getBase();
    const naturalCommandCenterStartTime = naturalCommandCenter ? frame.timeInSeconds() - getBuildTimeElapsed(data, naturalCommandCenter) : null;
    const bothStructuresExist = spawningPoolExists && enemyNaturalHatchery;
    const spawningPoolBeforeEnemyNatural = bothStructuresExist && spawningPoolStartTime < enemyNaturalHatcheryStartTime;
    const naturalCommandCenterBeforeEnemyNatural = naturalCommandCenter && enemyNaturalHatchery && naturalCommandCenterStartTime < enemyNaturalHatcheryStartTime;
    const { lastSeen } = scoutService;
    // if spawningPoolStartTime is less than lastSeen['enemyNaturalTownhallFootprint'] with no enemy natural, then we can assume we can set earlyScout to false and enemyBuildType to 'cheese'
    if (spawningPoolStartTime && spawningPoolStartTime < lastSeen['enemyNaturalTownhallFootprint'] && !enemyNaturalHatchery) {
      scoutingService.earlyScout = false;
      scoutingService.enemyBuildType = 'cheese';
      scoutingService.scoutReport = 'Early scout set to false because Spawning Pool start time is less than time enemy natural position was last seen and no enemy natural was found';
      return;
    } else if (spawningPoolBeforeEnemyNatural) {
      scoutingService.enemyBuildType = 'standard';
      scoutingService.scoutReport = `Early scout cancelled: ${spawningPoolBeforeEnemyNatural ? 'spawning pool' : 'natural command center'} before enemy natural`;
      if (bothStructuresExist) {
        scoutingService.earlyScout = false;
      }
      return;
    } else if (naturalCommandCenterBeforeEnemyNatural) {
      scoutingService.enemyBuildType = 'cheese';
      scoutingService.scoutReport = `Early scout cancelled: ${naturalCommandCenterBeforeEnemyNatural ? 'natural command center' : 'natural hatchery'} before enemy natural`;
      if (naturalCommandCenter && enemyNaturalHatchery) {
        scoutingService.earlyScout = false;
      }
      return;
    }
  },
  /**
   * @param {World} world 
   * @param {number} buffer 
   * @returns {boolean} 
   */
  isSupplyNeeded: (world, buffer = 0) => {
    const { agent, data, resources } = world;
    const { foodCap, foodUsed } = agent;
    const { units } = resources.get()
    const supplyUnitId = SupplyUnitRace[agent.race];
    const buildAbilityId = data.getUnitTypeData(supplyUnitId).abilityId;
    const pendingSupply = (
      (units.inProgress(supplyUnitId).length * 8) +
      (units.withCurrentOrders(buildAbilityId).length * 8)
    );
    const pendingSupplyCap = foodCap + pendingSupply;
    const supplyLeft = foodCap - foodUsed;
    const pendingSupplyLeft = supplyLeft + pendingSupply;
    const conditions = [
      pendingSupplyLeft < pendingSupplyCap * buffer,
      !(foodCap == 200),
      agent.canAfford(supplyUnitId), // can afford to build a pylon
    ];
    return conditions.every(c => c);
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
      (unit.weaponCooldown > 8 || unit.unitType === UnitType.CYCLONE) &&
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
      const foundGroundRangedWeapon = data.getUnitTypeData(unit.unitType).weapons.find(weapon => weapon.type === WeaponTargetType.GROUND && weapon.range > 1);
      if (foundGroundRangedWeapon) {
        const enemyUnitsInRange = getInRangeUnits(unit, [...enemyTrackingService.mappedEnemyUnits], foundGroundRangedWeapon.range);
        const weakestEnemyUnitInRange = enemyUnitsInRange.reduce((weakest, enemyUnit) => {
          if (weakest) {
            return enemyUnit.health < weakest.health ? enemyUnit : weakest;
          } else {
            return enemyUnit;
          }
        }, null);
        if (weakestEnemyUnitInRange) {
          unitCommand.targetUnitTag = weakestEnemyUnitInRange.tag;
          collectedActions.push(unitCommand);
        } else {
          unitCommand.targetWorldSpacePos = targetUnit.pos;
          collectedActions.push(unitCommand);
        }
      } else {
        unitCommand.targetWorldSpacePos = targetUnit.pos;
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @param {boolean} stepAhead
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  premoveBuilderToPosition: (world, position, unitType, stepAhead = false) => {
    const { agent, data, resources } = world;
    const { frame, map, units } = resources.get();
    const collectedActions = [];
    const builder = unitResourceService.selectBuilder(resources, position);
    if (builder) {
      // get speed, distance and average collection rate
      const { movementSpeed } = builder.data();
      let distanceToPosition = distanceByPath(resources, builder.pos, position);
      let rallyBase = false;
      if (stepAhead) {
        const [closestBaseByPath] = getClosestUnitByPath(resources, position, resources.get().units.getBases())
        if (closestBaseByPath) {
          const pathablePositions = getPathablePositionsForStructure(map, closestBaseByPath);
          const [pathableStructurePosition] = getClosestPositionByPath(resources, position, pathablePositions);
          const distanceOfBaseToPosition = distanceByPath(resources, pathableStructurePosition, position);
          rallyBase = distanceToPosition > distanceOfBaseToPosition ? true : false;
          distanceToPosition = rallyBase ? distanceOfBaseToPosition : distanceToPosition;
        }
      }
      const unitCommand = builder ? createUnitCommand(MOVE, [builder]) : {};
      const { collectionRateMinerals } = frame.getObservation().score.scoreDetails;
      const timeToPosition = distanceToPosition / movementSpeed;
      addEarmark(data, data.getUnitTypeData(unitType));
      const mineralsLeft = data.getEarmarkTotals('stepAhead').minerals - agent.minerals;
      const timeToTargetCost = mineralsLeft / (collectionRateMinerals / 60);
      if (shouldPremoveNow(world, timeToTargetCost, timeToPosition)) {
        if (rallyBase) {
          collectedActions.push(...rallyWorkerToTarget(world, position));
        } else {
          unitCommand.targetWorldSpacePos = position;
          builder.labels.set('builder', true);
          collectedActions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, builder, position));
        }
      } else {
        collectedActions.push(...rallyWorkerToTarget(world, position, true));
        if (!stepAhead) {
          if (builder.orders.some(order => order.targetWorldSpacePos && order.targetWorldSpacePos.x === position.x && order.targetWorldSpacePos.y === position.y)) {
            collectedActions.push(createUnitCommand(STOP, [builder]));
          }
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {Point2D}
   */
  retreat: (world, unit, targetUnit, toCombatRally = true) => {
    const { resources } = world;
    const { units } = resources.get();
    // completed BUNKERS
    const closestBunkerPositionByPath = units.getById(UnitType.BUNKER)
      .filter((unit) => unit.buildProgress === 1)
      .map((unit) => unit.pos)
      .sort((a, b) => distanceByPath(resources, a, unit.pos) - distanceByPath(resources, b, unit.pos))[0];
    // get closest position to unit by path
    const combatRally = getCombatRally(resources);
    const combatRallyCloser = distanceByPath(resources, combatRally, unit.pos) < distanceByPath(resources, closestBunkerPositionByPath, unit.pos);
    if (
      toCombatRally &&
      combatRallyCloser &&
      distanceByPath(resources, targetUnit.pos, combatRally) > 16 &&
      distanceByPath(resources, unit.pos, combatRally) <= distanceByPath(resources, targetUnit.pos, combatRally)
    ) {
      return combatRally;
    } else if (closestBunkerPositionByPath) {
      return closestBunkerPositionByPath;
    } else {
      if (!unit['retreatCandidates']) { unit['retreatCandidates'] = new Map(); }
      if (!targetUnit['retreatCandidates']) { targetUnit['retreatCandidates'] = new Map(); }
      const retreatCandidates = getRetreatCandidates(world, unit, targetUnit);
      const [largestPathDifferenceRetreat] = retreatCandidates.filter((point) => {
        return distanceByPath(resources, unit.pos, point) > 16;
      }).sort((a, b) => {
        return distanceByPath(resources, unit.pos, a) - distanceByPath(resources, unit.pos, b);
      });
      return largestPathDifferenceRetreat ? largestPathDifferenceRetreat : findClosestSafePosition(resources, unit, targetUnit);
    }
  },
  /**
   * @param {World} world
   * @param {SC2APIProtocol.PlayerResult} selfResult
   */
  saveBuildOrder: (world, selfResult) => {
    const { agent } = world;
    let selfRace = RaceId[agent.race];
    let opponentRace = RaceId[scoutService.opponentRace];
    console.log('__dirname', __dirname);
    const plans = JSON.parse(fs.readFileSync(
      // path.join(__dirname, '../', 'data', `plans.json`)).toString()
      path.join(__dirname, 'data', `plans.json`)).toString()
    );
    if (!plans[selfRace]) {
      plans[selfRace] = {};
    }
    if (!plans[selfRace][opponentRace]) {
      plans[selfRace][opponentRace] = {};
    }
    const executedSteps = loggingService.executedSteps.map(step => {
      const convertedStep = [
        step[0],
        step[2],
      ];
      if (step[7]) {
        convertedStep.push(step[7]);
      }
      return convertedStep;
    });
    if (!plans[selfRace][opponentRace][planService.uuid]) {
      plans[selfRace][opponentRace][planService.uuid] = {};
      plans[selfRace][opponentRace][planService.uuid]['result'] = {wins: 0, losses: 0};
    }
    plans[selfRace][opponentRace][planService.uuid]['orders'] = executedSteps;
    if (selfResult.result === 1) {
      plans[selfRace][opponentRace][planService.uuid]['result'].wins++;
    } else {
      plans[selfRace][opponentRace][planService.uuid]['result'].losses++;
    }
    plans[selfRace][opponentRace][planService.uuid]['attackFood'] = foodUsedService.minimumAmountToAttackWith;
    fs.writeFileSync(
      // path.join(__dirname, '../', 'data', `plans.json`),
      path.join(__dirname, 'data', `plans.json`),
      JSON.stringify(plans, null, 2)
    );
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
    const { resources } = world;
    units.forEach(unit => {
      unit['enemyUnits'] = enemyUnits.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16)
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['enemyDPSHealth'] = worldService.calculateNearDPSHealth(world, unit['enemyUnits'], (closestEnemyUnit && closestEnemyUnit['selfUnits']) ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
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
    const { resources } = world;
    units.forEach(unit => {
      unit['selfUnits'] = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['selfDPSHealth'] = worldService.calculateNearDPSHealth(world, unit['selfUnits'], closestEnemyUnit ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },
  /**
   * @param {World} world 
   */
  setTotalEnemyDPSHealth: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const selfCombatUnits = [...units.getCombatUnits(), ...units.getById(UnitType.QUEEN)];
    const { enemyCombatUnits } = enemyTrackingService;
    worldService.totalEnemyDPSHealth = enemyCombatUnits.reduce((totalDPSHealth, unit) => {
      return totalDPSHealth + worldService.calculateNearDPSHealth(world, [unit], [...selfCombatUnits.map(selfCombatUnit => selfCombatUnit.unitType), ...worldService.getTrainingUnitTypes(world)]);
    }, 0);
  },
  /**
   * @param {World} world 
   */
  setTotalSelfDPSHealth: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const selfCombatUnits = [...units.getCombatUnits(), ...units.getById(UnitType.QUEEN)];
    const { enemyCombatUnits } = enemyTrackingService;
    worldService.totalSelfDPSHealth = selfCombatUnits.reduce((totalDPSHealth, unit) => {
      return totalDPSHealth + worldService.calculateNearDPSHealth(world, [unit], enemyCombatUnits.map(enemyCombatUnit => enemyCombatUnit.unitType));
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
/**
 * @param {World} world
 * @param {number} timeToTargetCost 
 * @param {number} timeToPosition 
 * @returns {boolean}
 */
function shouldPremoveNow(world, timeToTargetCost, timeToPosition) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const willHaveEnoughMineralsByArrival = timeToTargetCost <= timeToPosition;
  // if race is protoss
  if (agent.race === Race.PROTOSS) {
    const pylons = units.getById(UnitType.PYLON);
    // get time left for first pylon to warp in
    if (pylons.length === 1) {
      const [pylon] = pylons;
      if (pylon.buildProgress < 1) {
        const timeToFinish = calculateTimeToFinishStructure(data, pylon);
        // if time left for first pylon to warp in is less than time to target cost and time to position, then we should pre-move
        return willHaveEnoughMineralsByArrival && timeToFinish <= timeToPosition;
      } else {
        // ignore in progress pylons beyound first pylon
      }
    } else {
      // if there are more than one pylon or no pylon, then no need to calculate time to finish
    }
  }
  return timeToTargetCost > 0 && willHaveEnoughMineralsByArrival;
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 */
function calculateTimeToFinishStructure(data, unit) {
  const { buildProgress } = unit;
  const { buildTime } = data.getUnitTypeData(unit.unitType);
  const timeElapsed = buildTime * buildProgress;
  const timeLeft = getTimeInSeconds(buildTime - timeElapsed);
  return timeLeft;
}
/**
 * @param {ResourceManager} resources 
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findZergPlacements(resources, unitType) {
  const { map, units } = resources.get();
  // get all mineral line points
  const mineralLinePoints = map.getExpansions().reduce((mineralLines, expansion) => {
    const { mineralLine } = expansion.areas;
    return [...mineralLines, ...mineralLine];
  }, []);
  const candidatePositions = [];
  if (unitType !== UnitType.NYDUSCANAL) {
    // get all points with creep within 12.5 distance of ally structure
    const creepCandidates = map.getCreep().filter((point) => {
      const [closestMineralLine] = getClosestPosition(point, mineralLinePoints);
      const [closestStructure] = units.getClosest(point, units.getStructures());
      return (
        distance(point, closestMineralLine) > 1.5 &&
        distance(point, closestStructure.pos) > 3 &&
        distance(point, closestStructure.pos) <= 12.5
      );
    });
    candidatePositions.push(...creepCandidates);
  } else {
    // get all points in vision
    const visionPoints = map.getVisibility().filter((point) => {
      const [closestMineralLine] = getClosestPosition(point, mineralLinePoints);
      const [closestStructure] = units.getClosest(point, units.getStructures());
      return (
        distance(point, closestMineralLine) > 1.5 &&
        distance(point, closestStructure.pos) > 3
      );
    });
    candidatePositions.push(...visionPoints);
  }
  return candidatePositions;
}

module.exports = worldService;

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @param {AbilityId} abilityId
 * @return {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function buildWithNydusNetwork(world, unitType, abilityId) {
  const { agent, resources, data } = world;
  const { actions, units } = resources.get();
  const collectedActions = [];
  const nydusNetworks = units.getById(UnitType.NYDUSNETWORK, { alliance: Alliance.SELF });
  if (nydusNetworks.length > 0) {
    // randomly pick a nydus network
    const nydusNetwork = getRandom(nydusNetworks);
    if (agent.canAfford(unitType)) {
      if (await actions.canPlace(unitType, [planService.foundPosition])) {
        const unitCommand = createUnitCommand(abilityId, [nydusNetwork]);
        unitCommand.targetWorldSpacePos = planService.foundPosition;
        collectedActions.push(unitCommand);
        planService.pausePlan = false;
        planService.continueBuild = true;
        addEarmark(data, data.getUnitTypeData(unitType));
        planService.foundPosition = null;
      } else {
        planService.foundPosition = null;
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
  }
  return collectedActions;
}

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @returns {Point2D}
 */
function findClosestSafePosition(resources, unit, targetUnit) {
  const { map } = resources.get();
  // get points within 16 distance of target unit and filter out points that are not safe
  const safePoints = gridsInCircle(targetUnit.pos, 16).filter((point) => {
    // check is point is farther than unit from target unit
    const fartherThanUnit = distance(point, targetUnit.pos) > distance(point, unit.pos);
    if (existsInMap(map, point) && fartherThanUnit) {
      // get grid height of point in map
      const pointWithHeight = {
        ...point,
        z: map.getHeight(point),
      }
      return isSafePositionFromTarget(map, unit, targetUnit, pointWithHeight);
    } else {
      return false;
    }
  });
  // get closest point for flying unit, closest point by path distance for ground unit
  if (unit.isFlying) {
    const [closestPoint] = getClosestPosition(unit.pos, safePoints);
    return closestPoint;
  } else {
    const [closestPoint] = getClosestPositionByPath(resources, unit.pos, safePoints);
    return closestPoint;
  }
}
/**
 * @param {World} world
 * @param {Unit[]} units
 * @returns
 */
function getDamageDealingUnits(world, units) {
  return units.filter((/** @type {Unit} */ unit) => worldService.getDPSHealth(world, unit, unit['selfUnits'].map((/** @type {Unit} */ unit) => unit.unitType)) > 0)
}
/**
 * @param {MapResource} map
 * @param {Point2D} point
 * @returns {boolean}
 */
function isPointInMap(map, point) {
  return point.x >= 0 && point.x < map._mapSize.x && point.y >= 0 && point.y < map._mapSize.y;
}
/**
 * @param {MapResource} map
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @param {Point3D} point 
 * @returns {boolean}
 */
function isSafePositionFromTarget(map, unit, targetUnit, point) {
  // check if point is out or range of unit
  // if point.z is not greater than 2 of unit.pos.z, then check highest range of ground weapon
  // if point.z is greater than 2 of unit.pos.z, then check highest range of air weapon
  let weaponTargetType = null;
  if (point.z > unit.pos.z + 2) {
    weaponTargetType = WeaponTargetType.AIR;
    // return false if point is outside of map
    if (!isPointInMap(map, point)) {
      return false;
    }
  } else {
    weaponTargetType = WeaponTargetType.GROUND;
    // return false if point is outside of map and point is not pathable
    if (!isPointInMap(map, point) || !map.isPathable(point)) {
      return false;
    }
  }
  const weapon = getHighestRangeWeapon(unit, weaponTargetType);
  // return true if no weapon found
  if (!weapon) {
    return true;
  }
  const weaponRange = weapon.range;
  const distanceToTarget = distance(point, targetUnit.pos);
  const movementSpeed = getEnemyMovementSpeed(targetUnit);
  return distanceToTarget > weaponRange + unit.radius + targetUnit.radius + movementSpeed;
}
/**
 * @param {Unit} unit 
 * @param {WeaponTargetType} weaponTargetType 
 * @returns {SC2APIProtocol.Weapon}
 */
function getHighestRangeWeapon(unit, weaponTargetType) {
  const { weapons } = unit.data();
  const [highestRange] = weapons.filter((weapon) => {
    return weapon.type === weaponTargetType || weapon.type === WeaponTargetType.ANY;
  }).sort((a, b) => {
    return b.range - a.range;
  });
  return highestRange;
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {Point2D[]}
*/
function getRetreatCandidates(world, unit, targetUnit) {
  const { resources } = world;
  const { map } = resources.get();
  // all expansion locations
  const expansionLocations = map.getExpansions().map((expansion) => expansion.centroid);
  return [...expansionLocations].filter((point) => {
    const positionString = `${point.x},${point.y}`;
    const damageDealingEnemies = getDamageDealingUnits(world, targetUnit['selfUnits']);
    let [closestToRetreat] = getClosestUnitByPath(resources, point, damageDealingEnemies);
    if (closestToRetreat) {
      const closestToRetreatOrTargetUnit = closestToRetreat ? closestToRetreat : targetUnit;
      targetUnit['retreatCandidates'][positionString] = {
        'closestToRetreat': closestToRetreatOrTargetUnit,
        'distanceByPath': distanceByPath(resources, closestToRetreatOrTargetUnit.pos, point),
      }
      unit['retreatCandidates'][positionString] = {
        'distanceByPath': distanceByPath(resources, unit.pos, point),
      }
      const distanceByPathToRetreat = unit['retreatCandidates'][positionString]['distanceByPath'];
      return distanceByPathToRetreat <= targetUnit['retreatCandidates'][positionString]['distanceByPath'];
    } else {
      return false;
    }
  });
}
/**
 * @param {UnitResource} units
 * @param {Unit} unit 
 */
function setWeaponCooldownMax(units, unit) {
  const { unitType, weaponCooldown } = unit;
  const { weaponCooldownMax } = getUnitTypeData(units, unitType);
  if (weaponCooldown > weaponCooldownMax) {
    unitResourceService.unitTypeData[unitType].weaponCooldownMax = weaponCooldown;
  }
}

