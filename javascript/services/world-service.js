//@ts-check
"use strict"

const fs = require('fs');
const { UnitTypeId, Ability, UnitType, Buff } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, SMART, STOP, CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance, WeaponTargetType, RaceId } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes, combatTypes, mineralFieldTypes, workerTypes, townhallTypes, constructionAbilities, liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints, createPoint2D, getNeighbors } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes, morphMapping } = require("../helper/groups");
const { findPosition } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { balanceResources, gatherOrMine } = require("../systems/manage-resources");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { formatToMinutesAndSeconds } = require("./logging-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("../systems/unit-resource/unit-resource-service");
const { getUnitTypeData, isRepairing, calculateSplashDamage, getThirdWallPosition, setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel, getWeaponThatCanAttack } = require("./unit-service");
const { GasMineRace, WorkerRace, SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { calculateHealthAdjustedSupply, getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { rallyWorkerToTarget } = require("./resource-manager-service");
const { getPathablePositionsForStructure, getClosestExpansion, getPathablePositions } = require("./map-resource-service");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getOccupiedExpansions } = require("../helper/expansions");
const { existsInMap, getCombatRally } = require("../helper/location");
const { pointsOverlap, intersectionOfPoints } = require("../helper/utilities");
const wallOffNaturalService = require("../systems/wall-off-natural/wall-off-natural-service");
const { findWallOffPlacement } = require("../systems/wall-off-ramp/wall-off-ramp-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { SPAWNINGPOOL, ADEPT } = require("@node-sc2/core/constants/unit-type");
const scoutingService = require("../systems/scouting/scouting-service");
const { getTimeInSeconds, getTravelDistancePerStep } = require("./frames-service");
const scoutService = require("../systems/scouting/scouting-service");
const path = require('path');
const foodUsedService = require('./food-used-service');
const { keepPosition } = require('./placement-service');
const trackUnitsService = require('../systems/track-units/track-units-service');
const { getClosestUnitByPath, getBuilder, distanceByPath, getClosestPositionByPath } = require('./resources-service');
const { getMiddleOfStructure, moveAwayPosition } = require('./position-service');
const { micro } = require('./micro-service');

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
    const builder = getBuilder(world, position);
    if (builder) {
      dataService.addEarmark(data, data.getUnitTypeData(unitType));
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
        return totalDPSHealth + worldService.getDPSHealthOfTrainingUnit(world, unitType, alliance, enemyUnits.map(enemyUnit => enemyUnit.unitType));
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
    const { resources } = world;
    const { map } = resources.get();
    return units.reduce((accumulator, unit) => {
      if (unit.isWorker()) {
        if (unit.alliance === Alliance.SELF) {
          if (unit.isHarvesting() && !unit.labels.has('retreating') && !unit.labels.has('defending')) {
            return accumulator;
          }
        } else if (unit.alliance === Alliance.ENEMY) {
          const [closestExpansion] = getClosestExpansion(map, unit.pos);
          if (closestExpansion) {
            if (pointsOverlap(closestExpansion.areas.mineralLine, [unit.pos])) {
              return accumulator;
            }
          }
        }
      }
      return accumulator + worldService.getDPSHealth(world, unit, enemyUnitTypes);
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
  findAndPlaceBuilding: async (world, unitType, candidatePositions, stepAhead = false) => {
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
            planService.continueBuild = true;
            dataService.addEarmark(data, data.getUnitTypeData(unitType));
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
                const footprint = cellsInFootprint(createPoint2D(grid), getFootprint(unitType));
                let existsAndPlaceable = existsInMap(map, grid) && map.isPlaceable(grid) && pointsOverlap([...footprint], [...placements]) && !pointsOverlap([...footprint], [...currentlyEnrouteConstructionGrids]);
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
    const { units } = resources.get();
    const contructionGrids = [];
    units.getWorkers().forEach(worker => {
      if (worker.isConstructing() || isPendingContructing(worker)) {
        const orders = [...worker.orders, ...worker['pendingOrders']];
        const foundOrder = orders.find(order => constructionAbilities.includes(order.abilityId));
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
   * @param {Unit[]} units
   * @returns
   */
  getDamageDealingUnits: (world, units) => {
    return units.filter((/** @type {Unit} */ unit) => worldService.getDPSHealth(world, unit, unit['selfUnits'].map((/** @type {Unit} */ unit) => unit.unitType)) > 0)
  },
  /**
   * @param {World} world 
   * @param {Unit} unit
   * @param {UnitTypeId[]} enemyUnitTypes 
   * @returns {number}
   */
  getDPSHealth: (world, unit, enemyUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    let dPSHealth = 0;
    // if unit.unitType is an ADEPTPHASESHIFT, use values of ADEPT assigned to it
    let { alliance, buffIds, health, buildProgress, shield, unitType } = unit;
    if (alliance === undefined || buffIds === undefined || health === undefined || buildProgress === undefined || shield === undefined || unitType === undefined) return 0;
    unitType = unitType !== UnitType.ADEPTPHASESHIFT ? unitType : ADEPT;
    unit = getUnitForDPSCalculation(resources, unit);
    let healthAndShield = 0;
    if (unit && buildProgress >= 1) {
      healthAndShield = health + shield;
    } else {
      const unitTypeData = getUnitTypeData(units, unitType);
      if (unitTypeData) {
        const { healthMax, shieldMax } = unitTypeData;
        healthAndShield = healthMax + shieldMax;
      }
    }
    dPSHealth = worldService.getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * healthAndShield * (buffIds.includes(Buff.STIMPACK) ? 1.5 : 1);
    return dPSHealth;
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @param {Alliance} alliance
   * @param {UnitTypeId[]} enemyUnitTypes
   */
  getDPSHealthOfTrainingUnit: (world, unitType, alliance, enemyUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    let dPSHealth = 0;
    const unitTypeData = getUnitTypeData(units, unitType);
    if (unitTypeData) {
      const { healthMax, shieldMax } = unitTypeData;
      dPSHealth = worldService.getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * (healthMax + shieldMax);
      dPSHealth = unitType === UnitType.ZERGLING ? dPSHealth * 2 : dPSHealth;
    }
    return dPSHealth;
  },
  /**
   * @param {World} world
   */
  getFoodUsed: (world) => {
    const {  agent, resources } = world;
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
      return totalDPSHealth + worldService.getDPSHealthOfTrainingUnit(world, unitType, Alliance.SELF, enemyCombatUnits.map(enemyUnit => enemyUnit.unitType));
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
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Alliance} alliance
   * @param {UnitTypeId[]} enemyUnitTypes
   * @returns {number}
  */
  getWeaponDPS(world, unitType, alliance, enemyUnitTypes) {
    const { data, resources } = world;
    const { units } = resources.get();
    const { weapons } = data.getUnitTypeData(unitType);
    if (weapons === undefined) return 0;
    const weaponsDPS = weapons.map(weapon => {
      const weaponAverageDPSAgainstTypes = enemyUnitTypes.reduce((totalDPS, enemyUnitType) => {
        const { attacks, damage, speed } = weapon;
        if (!attacks || !damage || !speed) return totalDPS;
        if (canWeaponAttackType(units, weapon, enemyUnitType)) {
          const weaponUpgradeDamage = damage + (getAttackUpgradeLevel(alliance) * dataService.getUpgradeBonus(alliance, weapon.damage));
          const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, [enemyUnitType]);
          const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(alliance) + weaponBonusDamage;
          const weaponSplashDamage = calculateSplashDamage(units, unitType, enemyUnitTypes);
          return totalDPS + (weaponDamage * attacks * weaponSplashDamage) / (speed / 1.4);
        }
        return totalDPS;
      }, 0);
      return weaponAverageDPSAgainstTypes / enemyUnitTypes.length;
    });
    // return max of weaponsDPS, if no value found in weaponsDPS, return 0
    if (weaponsDPS.length === 0) return 0;
    return Math.max.apply(Math, weaponsDPS);
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
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {number}
   */
  getUnitCount: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const { abilityId, attributes } = data.getUnitTypeData(unitType);
    if (abilityId === undefined || attributes === undefined) return 0;
    if (attributes.includes(Attribute.STRUCTURE)) {
      return worldService.getUnitTypeCount(world, unitType);
    } else {
      let unitTypes = [];
      if (morphMapping.has(unitType)) {
        // @ts-ignore
        unitTypes = morphMapping.get(unitType);
      } else {
        unitTypes = [unitType];
      }
      // get orders from units with current orders that match the abilityId
      const orders = units.withCurrentOrders(abilityId).reduce((/** @type {SC2APIProtocol.UnitOrder[]} */ matchingOrders, unit) => {
        const { orders } = unit;
        if (orders === undefined) return matchingOrders;
        orders.forEach(order => {
          if (order.abilityId === abilityId) {
            matchingOrders.push(order);
          }
        });
        return matchingOrders;
      }, []);
      const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => u['pendingOrders'] && u['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ o) => o.abilityId === abilityId));
      const pendingOrders = unitsWithPendingOrders.map(u => u['pendingOrders']).reduce((a, b) => a.concat(b), []);
      return units.getById(unitTypes).length + orders.length + pendingOrders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    }
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
    const spawningPoolStartTime = spawningPool ? frame.timeInSeconds() - dataService.getBuildTimeElapsed(data, spawningPool) : null;
    const enemyNaturalHatchery = map.getEnemyNatural().getBase();
    const enemyNaturalHatcheryStartTime = enemyNaturalHatchery ? frame.timeInSeconds() - dataService.getBuildTimeElapsed(data, enemyNaturalHatchery) : null;
    const naturalCommandCenter = map.getNatural().getBase();
    const naturalCommandCenterStartTime = naturalCommandCenter ? frame.timeInSeconds() - dataService.getBuildTimeElapsed(data, naturalCommandCenter) : null;
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
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    const { radius, tag, unitType, weaponCooldown } = unit;
    if (radius === undefined || tag === undefined || unitType === undefined || weaponCooldown === undefined) return collectedActions;
    const weaponCooldownOverStepSize = weaponCooldown > 8;
    const enemyWeapon = getWeapon(data, targetUnit, unit);
    if ((weaponCooldownOverStepSize || unit.unitType === UnitType.CYCLONE) && enemyWeapon) {
      const microPosition = worldService.getPositionVersusTargetUnit(world, unit, targetUnit);
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: microPosition,
        unitTags: [tag],
      });
    } else {
      const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
      const enemyUnitsInRange = [];
      const { weapons } = unit.data();
      if (weapons === undefined) return collectedActions;
      weapons.forEach(weapon => {
        const { range } = weapon;
        if (range === undefined || targetUnit.radius === undefined) return;
        const weaponRange = range + radius + targetUnit.radius;
        if (weapon.type === WeaponTargetType.ANY) {
          enemyUnitsInRange.push(...getInRangeUnits(unit, [...enemyTrackingService.mappedEnemyUnits], weaponRange));
          return;
        }
        if (weapon.type === WeaponTargetType.GROUND) {
          const groundEnemyUnits = enemyTrackingService.mappedEnemyUnits.filter(unit => !unit.isFlying);
          enemyUnitsInRange.push(...getInRangeUnits(unit, groundEnemyUnits, weaponRange));
          return;
        }
        if (weapon.type === WeaponTargetType.AIR) {
          const airEnemyUnits = enemyTrackingService.mappedEnemyUnits.filter(unit => unit.isFlying);
          enemyUnitsInRange.push(...getInRangeUnits(unit, airEnemyUnits, weaponRange));
          return;
        }
      });
      if (enemyUnitsInRange.length > 0) {
        const weakestEnemyUnitInRange = enemyUnitsInRange.reduce((weakest, enemyUnit) => {
          if (weakest === undefined) return enemyUnit;
          return weakest.health < enemyUnit.health ? weakest : enemyUnit;
        }, undefined);
        if (weakestEnemyUnitInRange) {
          unitCommand.targetUnitTag = weakestEnemyUnitInRange.tag;
        }
      } else {
        unitCommand.targetWorldSpacePos = targetUnit.pos;
      }
      collectedActions.push(unitCommand);
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
    const { map, units } = resources.get();
    const collectedActions = [];
    position = getMiddleOfStructure(position, unitType);
    const builder = getBuilder(world, position);
    if (builder) {
      // get speed, distance and average collection rate
      const { movementSpeed } = builder.data();
      const pathablePositions = getPathablePositions(map, position);
      const [closestPositionByPath] = getClosestPositionByPath(resources, builder.pos, pathablePositions);
      let builderDistanceToPosition = distanceByPath(resources, builder.pos, closestPositionByPath);
      let timeToPosition = builderDistanceToPosition / movementSpeed;
      let rallyBase = false;
      let buildTimeLeft = 0;
      if (stepAhead) {
        const completedBases = units.getBases().filter(base => base.buildProgress >= 1);
        const [closestBaseByPath] = getClosestUnitByPath(resources, position, completedBases);
        if (closestBaseByPath) {
          const pathablePositions = getPathablePositionsForStructure(map, closestBaseByPath);
          const [pathableStructurePosition] = getClosestPositionByPath(resources, position, pathablePositions);
          const baseDistanceToPosition = distanceByPath(resources, pathableStructurePosition, position);
          // check if closestBaseByPath is training a worker
          const { unitTypeTrainingAbilities } = dataService;
          const workerCurrentlyTraining = closestBaseByPath.orders.findIndex(order => workerTypes.includes(unitTypeTrainingAbilities.get(order.abilityId))) === 0;
          if (workerCurrentlyTraining) {
            const { buildTime } = data.getUnitTypeData(WorkerRace[agent.race]);
            const { progress } = closestBaseByPath.orders[0];
            buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * progress));
            let baseTimeToPosition = (baseDistanceToPosition / movementSpeed) + buildTimeLeft;
            rallyBase = timeToPosition > baseTimeToPosition;
            timeToPosition = rallyBase ? baseTimeToPosition : timeToPosition;
          }
        }
      }
      const unitCommand = builder ? createUnitCommand(MOVE, [builder]) : {};
      const timeToTargetCost = getTimeToTargetCost(world, unitType);
      if (shouldPremoveNow(world, timeToTargetCost, timeToPosition) && buildTimeLeft <= timeToPosition) {
        if (rallyBase) {
          collectedActions.push(...rallyWorkerToTarget(world, position));
        } else {
          console.log(`Is builder returning: ${builder.isReturning()}`);
          unitCommand.targetWorldSpacePos = position;
          builder.labels.set('builder', true);
          builder.labels.delete('mineralField');
          collectedActions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, builder, position));
        }
      } else {
        collectedActions.push(...rallyWorkerToTarget(world, position, true));
        if (
          builder.orders.length === 1 &&
          builder.orders.some(order => order.targetWorldSpacePos && order.targetWorldSpacePos.x === position.x && order.targetWorldSpacePos.y === position.y)
        ) {
          collectedActions.push(createUnitCommand(STOP, [builder]));
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {Unit} worker 
   * @param {Unit} targetUnit 
   * @param {Unit[]} enemyUnits 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  pullWorkersToDefend: (world, worker, targetUnit, enemyUnits) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const inRangeEnemySupply = calculateHealthAdjustedSupply(world, getInRangeUnits(targetUnit, [...enemyTrackingService.mappedEnemyUnits]));
    const amountToFightWith = Math.ceil(inRangeEnemySupply / data.getUnitTypeData(WorkerRace[agent.race]).foodRequired);
    const workers = units.getById(WorkerRace[agent.race]).filter(worker => {
      return (
        filterLabels(worker, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy', 'builder']) &&
        !isRepairing(worker) &&
        !worker.isReturning()
      );
    });
    const fighters = units.getClosest(targetUnit.pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), amountToFightWith);
    if (fighters.find(fighter => fighter.tag === worker.tag)) {
      const candidateMinerals = units.getByType(mineralFieldTypes).filter(mineralField => distance(worker.pos, mineralField.pos) < distance(targetUnit.pos, mineralField.pos));
      const [closestCandidateMineral] = units.getClosest(worker.pos, candidateMinerals);
      if (closestCandidateMineral) {
        collectedActions.push(...micro(units, worker, targetUnit, enemyUnits));
      }
    } else if (worker.isAttacking() && worker.orders.find(order => order.abilityId === ATTACK_ATTACK).targetUnitTag === targetUnit.tag) {
      collectedActions.push(gatherOrMine(resources, worker));
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  repositionBuilding: (world) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const repositionUnits = units.withLabel('reposition');
    const collectedActions = [];
    if (repositionUnits.length > 0) {
      repositionUnits.forEach(unit => {
        const { orders, pos } = unit;
        if (orders === undefined || pos === undefined) return;
        if (unit.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !unit.labels.has('pendingOrders')) {
          if (distance(pos, unit.labels.get('reposition')) > 1) {
            const unitCommand = createUnitCommand(Ability.LIFT, [unit]);
            collectedActions.push(unitCommand);
            setPendingOrders(unit, unitCommand);
          } else {
            unit.labels.delete('reposition');
            const { addOnTag } = unit;
            if (addOnTag === undefined) return collectedActions;
            const addOn = units.getByTag(addOnTag);
            if (addOn) addOn.labels.delete('reposition');
          }
        }
        if (unit.availableAbilities().find(ability => landingAbilities.includes(ability))) {
          const unitCommand = createUnitCommand(Ability.LAND, [unit]);
          unitCommand.targetWorldSpacePos = unit.labels.get('reposition');
          collectedActions.push(unitCommand);
          planService.pausePlan = false;
          setPendingOrders(unit, unitCommand);
        }
        // cancel training orders
        if (dataService.isTrainingUnit(data, unit)) {
          orders.forEach(() => {
            collectedActions.push(createUnitCommand(CANCEL_QUEUE5, [unit]));
          });
        }
      });
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
    const closestSafePosition = findClosestSafePosition(resources, unit, targetUnit);
    const travelDistancePerStep = getTravelDistancePerStep(unit);
    if (closestSafePosition) {
      if (distance(unit.pos, closestSafePosition) < travelDistancePerStep) {
        const closestBunkerPositionByPath = units.getById(UnitType.BUNKER)
          .filter((unit) => unit.buildProgress === 1)
          .map((unit) => unit.pos)
          .sort((a, b) => distanceByPath(resources, a, unit.pos) - distanceByPath(resources, b, unit.pos))[0];
        // get closest position to unit by path
        const combatRally = getCombatRally(resources);
        const unitToCombatRallyDistance = distanceByPath(resources, unit.pos, combatRally);
        const targetUnitToCombatRallyDistance = distanceByPath(resources, targetUnit.pos, combatRally);
        const combatRallyCloser = distanceByPath(resources, combatRally, unit.pos) < distanceByPath(resources, closestBunkerPositionByPath, unit.pos);
        if (
          toCombatRally &&
          combatRallyCloser &&
          unitToCombatRallyDistance > 16 && unitToCombatRallyDistance !== Infinity &&
          unitToCombatRallyDistance <= targetUnitToCombatRallyDistance
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
          return largestPathDifferenceRetreat ? largestPathDifferenceRetreat : closestSafePosition;
        }
      } else {
        const closestSafePosition = findClosestSafePosition(resources, unit, targetUnit, travelDistancePerStep);
        if (closestSafePosition) {
          return closestSafePosition;
        } else {
          moveAwayPosition(targetUnit.pos, unit.pos, travelDistancePerStep);
        }
      }
    } else {
      return moveAwayPosition(targetUnit.pos, unit.pos, travelDistancePerStep);
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
    const isStructure = UnitType[name] && data.getUnitTypeData(UnitType[name]).attributes.includes(Attribute.STRUCTURE);
    // set foodCount to foodUsed plus 1 if it's a structure and race is zerg
    const foodCount = (isStructure && agent.race === Race.ZERG) ? foodUsed + 1 : foodUsed;
    const buildStepExecuted = [foodCount, formatToMinutesAndSeconds(time), name, planService.currentStep, worldService.outpowered, `${minerals}/${vespene}`];
    const count = UnitType[name] ? worldService.getUnitCount(world, UnitType[name]) : 0;
    if (count) buildStepExecuted.push(count);
    if (notes) buildStepExecuted.push(notes);
    console.log(buildStepExecuted);
    const lastElement = loggingService.executedSteps.length - 1;
    const lastStep = loggingService.executedSteps[lastElement];
    let matchingLastStep = false;
    if (lastStep) {
      matchingLastStep = buildStepExecuted[2] === lastStep[2] && buildStepExecuted[6] === lastStep[6];
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
    // get array of unique unitTypes from enemyUnits
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
    const { agent, resources } = world;
    const { frame } = resources.get();
    planService.pausePlan = false;
    planService.continueBuild = true;
    if (!(WorkerRace[agent.race] === UnitType[name])) {
      worldService.setAndLogExecutedSteps(world, frame.timeInSeconds(), name, extra);
    }
  },
}

module.exports = worldService;

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
  return willHaveEnoughMineralsByArrival;
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
        dataService.addEarmark(data, data.getUnitTypeData(unitType));
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
 * @param {number} radius
 * @returns {Point2D|undefined}
 */
function findClosestSafePosition(resources, unit, targetUnit, radius = 0) {
  const { map } = resources.get();
  const safePositions = getSafePositions(map, unit, targetUnit, radius);
  // get closest point for flying unit, closest point by path distance for ground unit
  if (unit.isFlying) {
    const [closestPoint] = getClosestPosition(unit.pos, safePositions);
    return closestPoint;
  } else {
    const [closestPoint] = getClosestPositionByPath(resources, unit.pos, safePositions);
    return closestPoint;
  }
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {SC2APIProtocol.Weapon | undefined}
 **/
function getWeapon(data, unit, targetUnit) {
  const { unitType } = unit;
  if (!unitType) return undefined;
  if (unitType === UnitType.SENTRY) {
    return {
      attacks: 1,
      damage: 6,
      damageBonus: [],
      range: 5,
      speed: 1,
      type: WeaponTargetType.ANY,
    }
  } else {
    return getWeaponThatCanAttack(data, unitType, targetUnit);
  }
}
/**
 * @param {MapResource} map
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {Point2D[]}
 **/
function getSafePositions(map, unit, targetUnit, radius = 0) {
  let safePositions = [];
  while (safePositions.length === 0 && radius <= 16) {
    const ringOfCircle = gridsInCircle(unit.pos, radius).filter((point) => {
      return distance(point, unit.pos) > (radius - 1);
    });
    safePositions = ringOfCircle.filter((point) => {
      // check is point is farther than unit from target unit
      const fartherThanUnit = distance(point, targetUnit.pos) > distance(point, unit.pos);
      if (existsInMap(map, point) && map.isPathable(point) && fartherThanUnit) {
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
    radius += 1;
  }
  return safePositions;
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
  if (!existsInMap(map, point)) {
    return false;
  }
  let weaponTargetType = null;
  // @ts-ignore
  if (point.z > unit.pos.z + 2) {
    weaponTargetType = WeaponTargetType.AIR;
  } else {
    weaponTargetType = WeaponTargetType.GROUND;
    // return false if point is outside of map and point is not pathable
    if (!map.isPathable(point)) {
      return false;
    }
  }
  const weapon = getHighestRangeWeapon(targetUnit, weaponTargetType);
  // return true if no weapon found
  if (!weapon) {
    return true;
  }
  const weaponRange = weapon.range;
  // @ts-ignore
  const distanceToTarget = distance(point, targetUnit.pos);
  // @ts-ignore
  return distanceToTarget > weaponRange + unit.radius + targetUnit.radius + getTravelDistancePerStep(targetUnit) + getTravelDistancePerStep(unit);
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
  // @ts-ignore
  return [...expansionLocations].filter((point) => {
      // @ts-ignore
      const positionString = `${point.x},${point.y}`;
      const damageDealingEnemies = worldService.getDamageDealingUnits(world, targetUnit['selfUnits']);
      // @ts-ignore
      let [closestToRetreat] = getClosestUnitByPath(resources, point, damageDealingEnemies);
      if (closestToRetreat) {
        const closestToRetreatOrTargetUnit = closestToRetreat ? closestToRetreat : targetUnit;
        targetUnit['retreatCandidates'][positionString] = {
          'closestToRetreat': closestToRetreatOrTargetUnit,
          // @ts-ignore
          'distanceByPath': distanceByPath(resources, closestToRetreatOrTargetUnit.pos, point),
        }
        unit['retreatCandidates'][positionString] = {
          // @ts-ignore
          'distanceByPath': distanceByPath(resources, unit.pos, point),
        }
        const distanceByPathToRetreat = unit['retreatCandidates'][positionString]['distanceByPath'];
        if (distanceByPathToRetreat === Infinity) return false;
        return distanceByPathToRetreat <= targetUnit['retreatCandidates'][positionString]['distanceByPath'];
      } else {
        return false;
      }
  });
}
/**
 * @param {ResourceManager} resources
 * @param {Unit} unit 
 * @returns {Unit}
 */
function getUnitForDPSCalculation(resources, unit) {
  const { units } = resources.get();
  if (unit.unitType === UnitType.ADEPTPHASESHIFT) {
    const label = 'ADEPT';
    if (unit.hasLabel(label)) {
      unit = getByTag(unit.getLabel(label));
    } else {
      // find the closest ADEPT that has not been assigned to unit
      const [closestAdept] = getUnitsByAllianceAndType(unit.alliance, ADEPT).filter(adept => {
        // return true if adept.tag does not exist in units.withLabel('ADEPT');
        return !units.withLabel(label).some(unit => unit.labels.get(label) === adept.tag);
      }).sort((a, b) => distanceByPath(resources, a.pos, unit.pos) - distanceByPath(resources, b.pos, unit.pos));
      if (closestAdept) {
        unit.labels.set(label, closestAdept.tag);
        console.log(`${unit.unitType} ${unit.tag} assigned to ${closestAdept.unitType} ${closestAdept.tag}`);
      }
      return closestAdept;
    }
  }
  return unit;
}
/**
 * 
 * @param {SC2APIProtocol.Alliance} alliance
 * @param {UnitTypeId} unitType 
 * @returns {Unit[]}
 */
function getUnitsByAllianceAndType(alliance, unitType) {
  if (alliance === Alliance.SELF) {
    return trackUnitsService.selfUnits.filter(unit => unit.unitType === unitType);
  } else if (alliance === Alliance.ENEMY) {
    return enemyTrackingService.mappedEnemyUnits.filter(unit => unit.unitType === unitType);
  } else {
    return [];
  }
}
/**
 * @param {string} tag 
 * @returns {Unit}
 */
function getByTag(tag) {
  return enemyTrackingService.mappedEnemyUnits.find(unit => unit.tag === tag);
}
/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 **/
function getTimeToTargetCost(world, unitType) {
  const { agent, data, resources } = world;
  const { frame } = resources.get();
  const { collectionRateMinerals, collectionRateVespene } = frame.getObservation().score.scoreDetails;
  dataService.addEarmark(data, data.getUnitTypeData(unitType));
  const mineralsLeft = data.getEarmarkTotals('stepAhead').minerals - agent.minerals;
  const vespeneLeft = data.getEarmarkTotals('stepAhead').vespene - agent.vespene;
  const timeToTargetMinerals = mineralsLeft / (collectionRateMinerals / 60);
  const { vespeneCost } = data.getUnitTypeData(unitType);
  const timeToTargetVespene = vespeneCost > 0 ? vespeneLeft / (collectionRateVespene / 60) : 0;
  return Math.max(timeToTargetMinerals, timeToTargetVespene);
}
/**
 * @param {UnitResource} units
 * @param {SC2APIProtocol.Weapon} weapon
 * @param {UnitTypeId} targetUnitType
 * @returns {boolean}
 **/
function canWeaponAttackType(units, weapon, targetUnitType) {
  const { isFlying } = getUnitTypeData(units, targetUnitType);
  return weapon.type === WeaponTargetType.ANY || (weapon.type === WeaponTargetType.GROUND && !isFlying) || (weapon.type === WeaponTargetType.AIR && isFlying || targetUnitType === UnitType.COLOSSUS);
}