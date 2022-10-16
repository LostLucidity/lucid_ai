//@ts-check
"use strict"

const fs = require('fs');
const { UnitTypeId, Ability, UnitType, Buff } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, STOP, CANCEL_QUEUE5, TRAIN_ZERGLING, RALLY_BUILDING, SMART } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance, WeaponTargetType, RaceId } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes, combatTypes, mineralFieldTypes, workerTypes, townhallTypes, constructionAbilities, liftingAbilities, landingAbilities, gasMineTypes, rallyWorkersAbilities } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints, createPoint2D, getNeighbors } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes, morphMapping } = require("../helper/groups");
const { findPosition, getCandidatePositions } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { balanceResources, gatherOrMine } = require("../systems/manage-resources");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { formatToMinutesAndSeconds } = require("./logging-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("../systems/unit-resource/unit-resource-service");
const { getUnitTypeData, isRepairing, calculateSplashDamage, getThirdWallPosition, setPendingOrders, getBuilders, getOrderTargetPosition, getNeediestMineralField } = require("../systems/unit-resource/unit-resource-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel, getWeaponThatCanAttack, getMovementSpeed, isMoving } = require("./unit-service");
const { GasMineRace, WorkerRace, SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { calculateHealthAdjustedSupply, getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { getClosestUnitPositionByPath, getClosestUnitByPath, getDistanceByPath, getClosestPositionByPath, getClosestPathablePositionsBetweenPositions, gather } = require("./resource-manager-service");
const { getPathablePositionsForStructure, getClosestExpansion, getPathablePositions } = require("./map-resource-service");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getOccupiedExpansions } = require("../helper/expansions");
const { existsInMap, getCombatRally } = require("../helper/location");
const { pointsOverlap, intersectionOfPoints } = require("../helper/utilities");
const wallOffNaturalService = require("../systems/wall-off-natural/wall-off-natural-service");
const { findWallOffPlacement } = require("../systems/wall-off-ramp/wall-off-ramp-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { SPAWNINGPOOL, ADEPT, EGG, DRONE, ZERGLING, PROBE, BARRACKS, SUPPLYDEPOT } = require("@node-sc2/core/constants/unit-type");
const scoutingService = require("../systems/scouting/scouting-service");
const { getTimeInSeconds, getTravelDistancePerStep } = require("./frames-service");
const scoutService = require("../systems/scouting/scouting-service");
const path = require('path');
const foodUsedService = require('./food-used-service');
const { keepPosition } = require('./placement-service');
const trackUnitsService = require('../systems/track-units/track-units-service');
const { canAttack } = require('./resources-service');
const { getMiddleOfStructure, moveAwayPosition } = require('./position-service');
const { micro } = require('./micro-service');
const MapResourceService = require('./map-resource-service');
const { getPathCoordinates } = require('./path-service');
const wallOffRampService = require('../systems/wall-off-ramp/wall-off-ramp-service');

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
    position = getMiddleOfStructure(position, unitType);
    const builder = worldService.getBuilder(world, position);
    if (builder) {
      const { pos } = builder;
      if (pos === undefined) return collectedActions;
      dataService.addEarmark(data, data.getUnitTypeData(unitType));
      if (!builder.isConstructing() && !isPendingContructing(builder)) {
        setBuilderLabel(builder);
        const unitCommand = createUnitCommand(abilityId, [builder]);
        if (GasMineRace[agent.race] === unitType) {
          const [closestGasGeyser] = units.getClosest(position, units.getGasGeysers());
          if (closestGasGeyser === undefined) return collectedActions;
          unitCommand.targetUnitTag = closestGasGeyser.tag;
          collectedActions.push(unitCommand);
          if (builder.unitType === PROBE) {
            const [closestBase] = getClosestUnitByPath(resources, pos, units.getBases());
            if (closestBase) {
              const { pos } = closestBase;
              if (pos === undefined) return collectedActions;
              const [closestExpansion] = getClosestExpansion(map, pos);
              const { mineralFields } = closestExpansion.cluster;
              const neediestMineralField = getNeediestMineralField(units, mineralFields);
              if (neediestMineralField) {
                const unitCommand = gather(resources, builder, neediestMineralField, true);
                collectedActions.push(unitCommand);
                builder.labels.set('mineralField', neediestMineralField);
                neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
              }
            }
          }
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
      const { abilityId } = data.getUnitTypeData(workerTypeId);
      if (abilityId === undefined) { return; }
      let trainers = [];
      if (agent.race === Race.ZERG) {
        trainers = units.getById(UnitType.LARVA).filter(larva => !larva['pendingOrders'] || larva['pendingOrders'].length === 0);
      } else {
        trainers = units.getById(townhallTypes, { alliance: Alliance.SELF, buildProgress: 1, noQueue: true })
          .filter(townhall => townhall.abilityAvailable(abilityId) && !townhall['pendingOrders'] || townhall['pendingOrders'].length === 0);
      }
      if (trainers.length > 0) {
        const trainer = getRandom(trainers);
        const unitCommand = createUnitCommand(abilityId, [trainer]);
        setPendingOrders(trainer, unitCommand);
        try { await actions.sendAction(unitCommand); } catch (error) { console.log(error) }
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
    const { actions, units } = resources.get();
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
    if (gasMineTypes.includes(unitType)) {
      const geyserPositions = map.freeGasGeysers().map(geyser => geyser.pos).filter(pos => pos !== undefined);
      // @ts-ignore
      return geyserPositions;
    }
    /**
     * @type {Point2D[]}
     */
    let placements = [];
    if (race === Race.PROTOSS) {
      if (unitType === UnitType.PYLON) {
        if (worldService.getUnitTypeCount(world, unitType) === 0) {
          if (planService.naturalWallPylon) {
            return getCandidatePositions(resources, 'NaturalWallPylon', unitType);
          }
        }
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
      const { barracksWallOffPosition, supplyWallOffPositions } = wallOffRampService;
      const wallOffPositions = [];
      if (barracksWallOffPosition) {
        const barracksFootprint = getFootprint(BARRACKS);
        if (barracksFootprint === undefined) return [];
        const barracksCellInFootprints = cellsInFootprint(barracksWallOffPosition, barracksFootprint);
        wallOffPositions.push(...barracksCellInFootprints);
      }
      if (supplyWallOffPositions.length > 0) {
        const supplyFootprint = getFootprint(SUPPLYDEPOT);
        if (supplyFootprint === undefined) return [];
        const supplyCellInFootprints = supplyWallOffPositions.map(position => cellsInFootprint(position, supplyFootprint));
        wallOffPositions.push(...supplyCellInFootprints.flat());
      }
      const unitTypeFootprint = getFootprint(unitType);
      if (unitTypeFootprint === undefined) return [];
      placements = placementGrids
        .filter(grid => !pointsOverlap(cellsInFootprint(grid, unitTypeFootprint), [...wallOffPositions]))
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
   * @param {Point2D} position 
   * @returns {Unit|null}
   */
  getBuilder: (world, position) => {
    const { data, resources } = world;
    const { units } = resources.get();
    let builderCandidates = getBuilders(units);
    builderCandidates.push(...units.getWorkers().filter(worker => {
      const doesNotExist = !builderCandidates.some(builder => builder.tag === worker.tag);
      const available = (
        worker.noQueue ||
        worker.isGathering() && getOrderTargetPosition(units, worker) && distance(worker.pos, getOrderTargetPosition(units, worker)) > 1.62 ||
        worker.orders.findIndex(order => order.targetWorldSpacePos && (distance(order.targetWorldSpacePos, position) < 1)) > -1
      );
      return doesNotExist && available;
    }));
    const movingProbes = builderCandidates.filter(builder => isMoving(builder));
    builderCandidates = builderCandidates.filter(builder => !movingProbes.some(probe => probe.tag === builder.tag));
    const movingProbesTimeToPosition = movingProbes.map(movingProbe => {
      const { orders, pos } = movingProbe;
      if (orders === undefined || pos === undefined) return;
      const movingPosition = orders[0].targetWorldSpacePos;
      const movementSpeed = getMovementSpeed(movingProbe);
      if (movingPosition === undefined || movementSpeed === undefined) return;
      const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
      const movingProbeTimeToMovePosition = getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeed;
      const pathablePremovingPosition = getClosestUnitPositionByPath(resources, pathableMovingPosition, position);
      const targetTimeToPremovePosition = getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeed;
      return { unit: movingProbe, timeToPosition: movingProbeTimeToMovePosition + targetTimeToPremovePosition };
    });
    const candidateWorkersTimeToPosition = []
    const [movingProbe] = movingProbesTimeToPosition.sort((a, b) => {
      if (a === undefined || b === undefined) return 0;
      return a.timeToPosition - b.timeToPosition;
    });
    if (movingProbe !== undefined) {
      candidateWorkersTimeToPosition.push(movingProbe);
    }
    const [closestBuilder] = getClosestUnitByPath(resources, position, builderCandidates);
    if (closestBuilder !== undefined) {
      const { pos } = closestBuilder;
      if (pos === undefined) return null;
      const movementSpeed = getMovementSpeed(closestBuilder);
      if (movementSpeed === undefined) return null;
      const closestPathablePositionsBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, position);
      const closestBuilderWithDistance = {
        unit: closestBuilder,
        timeToPosition: closestPathablePositionsBetweenPositions.distance / movementSpeed
      };
      candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
    }
    const constructingWorkers = units.getConstructingWorkers();
    // calculate build time left plus distance to position by path
    const [closestConstructingWorker] = constructingWorkers.map(worker => {
      // get unit type of building in construction
      const constructingOrder = worker.orders.find(order => constructionAbilities.includes(order.abilityId));
      const unitType = dataService.unitTypeTrainingAbilities.get(constructingOrder.abilityId);
      const { buildTime } = data.getUnitTypeData(unitType);
      // get closest unit type to worker position if within unit type radius
      const closestUnitType = units.getClosest(worker.pos, units.getById(unitType)).filter(unit => distance(unit.pos, worker.pos) < 3)[0];
      let timeToPosition = Infinity;
      if (closestUnitType) {
        const { buildProgress } = closestUnitType;
        const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
        const distanceToPositionByPath = getDistanceByPath(resources, worker.pos, position);
        const { movementSpeed } = worker.data();
        timeToPosition = buildTimeLeft + (distanceToPositionByPath / movementSpeed);
      }
      return {
        unit: worker,
        timeToPosition
      };
    }).sort((a, b) => a.timeToPosition - b.timeToPosition);
    if (closestConstructingWorker !== undefined) {
      candidateWorkersTimeToPosition.push(closestConstructingWorker);
    }
    const [closestWorker] = candidateWorkersTimeToPosition.sort((a, b) => {
      if (a === undefined || b === undefined) return 0;
      return a.timeToPosition - b.timeToPosition;
    });
    if (closestWorker === undefined) return null;
    return closestWorker.unit;
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
   * @param {Unit} unit
   * @param {Unit[]} enemyUnits
   * @returns {Unit[]}
   */
  getDamageDealingUnits: (world, unit, enemyUnits) => {
    const { data, resources } = world;
    return enemyUnits.filter(enemyUnit => {
      if (canAttack(resources, enemyUnit, unit) && inCombatRange(data, enemyUnit, unit)) {
        return true;
      } else {
        return false;
      }
    });
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
    if (buildProgress > 0.90) {
      dPSHealth = worldService.getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * healthAndShield * (buffIds.includes(Buff.STIMPACK) ? 1.5 : 1);
    }
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
   *
   * @param {World} world
   * @param {Unit} unit
   * @returns
   */
  getDPSOfInRangeAntiAirUnits: (world, unit) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const { pos, radius, unitType } = unit;
    if (pos === undefined || radius === undefined || unitType === undefined) { return 0 }
    return enemyUnits.reduce((accumulator, enemyUnit) => {
      let dPS = 0;
      const { alliance, pos: enemyPos, radius: enemyRadius, unitType: enemyUnitType } = enemyUnit;
      if (alliance === undefined || enemyPos === undefined || enemyRadius === undefined || enemyUnitType === undefined) { return accumulator }
      const weaponThatCanAttack = getWeaponThatCanAttack(data, enemyUnitType, unit);
      if (weaponThatCanAttack === undefined) { return accumulator }
      const { range } = weaponThatCanAttack;
      if (range === undefined) { return accumulator }
      if (distance(pos, enemyPos) <= range + radius + enemyRadius) {
        dPS = worldService.getWeaponDPS(world, enemyUnitType, alliance, [unitType]);
      }
      return accumulator + dPS;
    }, 0);
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
   * @param {UnitTypeId} unitType
   * @returns {Unit[]}
   */
  getUnitsTrainingTargetUnitType: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    let { abilityId } = data.getUnitTypeData(unitType);
    if (abilityId === undefined) return [];
    return worldService.getUnitsWithCurrentOrders(units, [abilityId]);
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
      /** @type {SC2APIProtocol.UnitOrder[]} */
      const pendingOrders = unitsWithPendingOrders.map(u => u['pendingOrders']).reduce((a, b) => a.concat(b), []);
      const ordersLength = orders.some(order => order.abilityId === TRAIN_ZERGLING) ? orders.length * 2 : orders.length;
      let pendingOrdersLength = pendingOrders.some(order => order.abilityId === TRAIN_ZERGLING) ? pendingOrders.length * 2 : pendingOrders.length;
      let totalOrdersLength = ordersLength + pendingOrdersLength;
      if (totalOrdersLength > 0) {
        totalOrdersLength = unitType === ZERGLING ? totalOrdersLength - 1 : totalOrdersLength;
      }
      return units.getById(unitTypes).length + totalOrdersLength + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
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
    if (zerglings.length > 0 && !enemyNaturalHatchery) {
      scoutingService.earlyScout = false;
      scoutingService.enemyBuildType = 'cheese';
      scoutService.scoutReport = 'Early scout cancelled. Zerglings detected before natural hatchery scouted.';
    }
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
    const { debug, map, units } = resources.get();
    const { rallyWorkerToTarget } = worldService;
    const collectedActions = [];
    position = getMiddleOfStructure(position, unitType);
    const builder = worldService.getBuilder(world, position);
    if (builder) {
      // get speed, distance and average collection rate
      const { movementSpeed } = builder.data();
      const pathablePositions = getPathablePositions(map, position);
      const { pos } = builder;
      if (pos === undefined || movementSpeed === undefined) return collectedActions;
      const [closestPositionByPath] = getClosestPositionByPath(resources, pos, pathablePositions);
      let builderDistanceToPosition = getDistanceByPath(resources, pos, closestPositionByPath);
      if (debug !== undefined) {
        debug.setDrawCells('prmv', getPathCoordinates(MapResourceService.getMapPath(map, pos, closestPositionByPath)).map(point => ({ pos: point })), { size: 1, cube: false });
      }
      let timeToPosition = builderDistanceToPosition / movementSpeed;
      let rallyBase = false;
      let buildTimeLeft = 0;
      if (stepAhead) {
        const completedBases = units.getBases().filter(base => base.buildProgress >= 1);
        const [closestBaseByPath] = getClosestUnitByPath(resources, closestPositionByPath, completedBases);
        if (closestBaseByPath) {
          const pathablePositions = getPathablePositionsForStructure(map, closestBaseByPath);
          const [pathableStructurePosition] = getClosestPositionByPath(resources, closestPositionByPath, pathablePositions);
          const baseDistanceToPosition = getDistanceByPath(resources, pathableStructurePosition, closestPositionByPath);
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
      const timeToTargetTech = getTimeToTargetTech(world, unitType);
      const timeToTargetCostOrTech = timeToTargetTech > timeToTargetCost ? timeToTargetTech : timeToTargetCost;
      if (shouldPremoveNow(world, timeToTargetCostOrTech, timeToPosition) && buildTimeLeft <= timeToPosition) {
        if (rallyBase) {
          collectedActions.push(...rallyWorkerToTarget(world, position));
          collectedActions.push(...stopUnitFromMovingToPosition(builder, position));
        } else {
          console.log(`Is builder returning: ${builder.isReturning()}`);
          unitCommand.targetWorldSpacePos = position;
          setBuilderLabel(builder);
          collectedActions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, builder, position));
          if (agent.race === Race.ZERG) {
            const { foodRequired } = data.getUnitTypeData(unitType);
            if (foodRequired === undefined) return collectedActions;
            planService.pendingFood -= foodRequired;
          }
          collectedActions.push(...rallyWorkerToTarget(world, position, true));
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
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
  rallyWorkerToTarget: (world, position, mineralTarget = false) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const workerSourceByPath = worldService.getWorkerSourceByPath(world, position);
    let rallyAbility = null;
    if (workerSourceByPath) {
      const { orders, pos } = workerSourceByPath;
      if (pos === undefined) return collectedActions;
      if (workerSourceByPath.unitType === EGG) {
        rallyAbility = orders.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? RALLY_BUILDING : null;
      } else {
        rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
      }
      if (rallyAbility) {
        const unitCommand = createUnitCommand(rallyAbility, [workerSourceByPath]);
        if (mineralTarget) {
          const [closestExpansion] = getClosestExpansion(map, pos);
          const { mineralFields } = closestExpansion.cluster;
          const neediestMineralField = getNeediestMineralField(units, mineralFields);
          if (neediestMineralField === undefined) return collectedActions;
          unitCommand.targetUnitTag = neediestMineralField.tag;
        } else {
          unitCommand.targetWorldSpacePos = position;
        }
        collectedActions.push(unitCommand);
      }
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
   * @returns {Point2D|undefined}
   */
  retreat: (world, unit, targetUnit, toCombatRally = true) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const { pos } = unit;
    if (pos === undefined) return;
    const closestSafePosition = findClosestSafePosition(resources, unit);
    const travelDistancePerStep = getTravelDistancePerStep(unit);
    if (closestSafePosition) {
      if (distance(pos, closestSafePosition) < travelDistancePerStep) {
        const closestBunkerPositionByPath = units.getById(UnitType.BUNKER)
          .filter((unit) => unit.buildProgress === 1)
          .map((unit) => unit.pos)
          .sort((a, b) => getDistanceByPath(resources, a, unit.pos) - getDistanceByPath(resources, b, unit.pos))[0];
        // get closest position to unit by path
        const combatRally = getCombatRally(resources);
        let combatRallyCloser = true;
        if (closestBunkerPositionByPath) {
          combatRallyCloser = getDistanceByPath(resources, combatRally, unit.pos) < getDistanceByPath(resources, closestBunkerPositionByPath, unit.pos);
        }
        const unitToCombatRallyDistance = getDistanceByPath(resources, pos, combatRally);
        const targetUnitToCombatRallyDistance = getDistanceByPath(resources, targetUnit.pos, combatRally);
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
            const [closestPathablePosition] = getClosestPositionByPath(resources, pos, getPathablePositions(map, point));
            return getDistanceByPath(resources, pos, closestPathablePosition) > 16;
          }).sort((a, b) => {
            const [closestPathablePositionA] = getClosestPositionByPath(resources, pos, getPathablePositions(map, a));
            const [closestPathablePositionB] = getClosestPositionByPath(resources, pos, getPathablePositions(map, b));
            return getDistanceByPath(resources, pos, closestPathablePositionA) - getDistanceByPath(resources, pos, closestPathablePositionB);
          });
          if (largestPathDifferenceRetreat) {
            return largestPathDifferenceRetreat;
          } else {
            return findClosestSafePosition(resources, unit, travelDistancePerStep) || moveAwayPosition(targetUnit.pos, unit.pos, travelDistancePerStep);
          }
        }
      } else {
        return closestSafePosition;
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
      unit['enemyUnits'] = setUnitsProperty(unit, enemyUnits);
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
      unit['selfUnits'] = setUnitsProperty(unit, units);
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
   * @param {World} world
   * @returns {Boolean}
   */
  shortOnWorkers: (world) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    let idealHarvesters = 0
    let assignedHarvesters = 0
    const mineralCollectors = [...units.getBases(), ...units.getById(gasMineTypes)]
    mineralCollectors.forEach(mineralCollector => {
      const { buildProgress, assignedHarvesters: assigned, idealHarvesters: ideal, unitType } = mineralCollector;
      if (buildProgress === undefined || assigned === undefined || ideal === undefined || unitType === undefined) return;
      if (buildProgress === 1) {
        assignedHarvesters += assigned;
        idealHarvesters += ideal;
      } else {
        if (townhallTypes.includes(unitType)) {
          const mineralFields = units.getMineralFields().filter(mineralField => {
            const { pos } = mineralField;
            const { pos: townhallPos } = mineralCollector;
            if (pos === undefined || townhallPos === undefined) return false;
            if (distance(pos, townhallPos) < 16) {
              const closestPositionByPath = getClosestUnitPositionByPath(resources, townhallPos, pos);
              if (closestPositionByPath === undefined) return false;
              const closestByPathDistance = getDistanceByPath(resources, pos, closestPositionByPath);
              return closestByPathDistance <= 16;
            } else {
              return false;
            }
          });
          idealHarvesters += mineralFields.length * 2 * buildProgress;
        } else {
          idealHarvesters += 3 * buildProgress;
        }
      }
    });
    // count workers that are training
    const unitsTrainingTargetUnitType = worldService.getUnitsTrainingTargetUnitType(world, WorkerRace[agent.race]);
    return idealHarvesters > (assignedHarvesters + unitsTrainingTargetUnitType.length);
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
  /**
   * @param {World} world
   * @param {Point2D} position
   */
  getWorkerSourceByPath: (world, position) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    // worker source is base or larva.
    let closestUnitByPath = null;
    if (agent.race === Race.ZERG) {
      [closestUnitByPath] = getClosestUnitByPath(resources, position, units.getById(EGG));
    } else {
      [closestUnitByPath] = getClosestUnitByPath(resources, position, units.getBases());
    }
    return closestUnitByPath;
  }
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
 * @param {number} radius
 * @returns {Point2D|undefined}
 */
function findClosestSafePosition(resources, unit, radius = 1) {
  const safePositions = getSafePositions(resources, unit, radius);
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
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @returns {Point2D[]}
 **/
function getSafePositions(resources, unit, radius = 1) {
  const { map, units } = resources.get();
  let safePositions = [];
  const { pos } = unit;
  if (pos === undefined) return safePositions;
  const enemyUnits = units.getAlive({ alliance: Alliance.ENEMY }).filter(enemyUnit => enemyUnit.pos && distance(pos, enemyUnit.pos) <= 16);
  while (safePositions.length === 0 && radius <= 16) {
    const ringOfCircle = gridsInCircle(pos, radius).filter((point) => {
      return distance(point, pos) > (radius - 1);
    });
    safePositions = ringOfCircle.filter((point) => {
      // check is point is farther than unit from target unit
      if (existsInMap(map, point) && map.isPathable(point)) {
        const fartherThanEnemyUnits = enemyUnits.every(enemyUnit => enemyUnit.pos && (distance(point, enemyUnit.pos) > distance(point, pos)))
        if (fartherThanEnemyUnits) {
          // get grid height of point in map
          const pointWithHeight = {
            ...point,
            z: map.getHeight(point),
          }
          return isSafePositionFromTargets(map, unit, enemyUnits, pointWithHeight);
        } else {
          return false;
        }
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
 * @param {Unit[]} targetUnits
 * @param {Point3D} point 
 * @returns {boolean}
 */
function isSafePositionFromTargets(map, unit, targetUnits, point) {
  if (!existsInMap(map, point)) return false;
  let weaponTargetType = null;
  const { pos, radius } = unit;
  if (pos === undefined || radius === undefined) return false;
  if (point.z === undefined || pos === undefined || pos.z === undefined) return false;
  if (point.z > pos.z + 2) {
    weaponTargetType = WeaponTargetType.AIR;
  } else {
    weaponTargetType = WeaponTargetType.GROUND;
    // return false if point is outside of map and point is not pathable
    if (!map.isPathable(point)) return false;
  }
  return targetUnits.every((targetUnit) => {
    const { pos } = targetUnit;
    if (pos === undefined || targetUnit.radius === undefined) return true;
    const weapon = getHighestRangeWeapon(targetUnit, weaponTargetType);
    if (weapon === undefined || weapon.range === undefined) return true;
    const weaponRange = weapon.range;
    const distanceToTarget = distance(point, pos);
    return distanceToTarget > weaponRange + radius + targetUnit.radius + getTravelDistancePerStep(targetUnit) + getTravelDistancePerStep(unit);
  });
}
/**
 * @param {Unit} unit 
 * @param {WeaponTargetType} weaponTargetType 
 * @returns {SC2APIProtocol.Weapon|undefined}
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
 * @returns {(Point2D | undefined)[]}
*/
function getRetreatCandidates(world, unit, targetUnit) {
  const { resources } = world;
  const { map } = resources.get();
  const expansionLocations = map.getExpansions().map((expansion) => expansion.centroid);
  return [...expansionLocations].filter((point) => {
    if (point === undefined) return false;
    const positionString = `${point.x},${point.y}`;
    const damageDealingEnemies = worldService.getDamageDealingUnits(world, unit, targetUnit['selfUnits']);
    let [closestToRetreat] = getClosestUnitByPath(resources, point, damageDealingEnemies);
    if (closestToRetreat) {
      const closestToRetreatOrTargetUnit = closestToRetreat ? closestToRetreat : targetUnit;
      if (closestToRetreatOrTargetUnit.pos === undefined) return false;
      const pathablePositions = getPathablePositions(map, point);
      const [closestToRetreatOrTargetUnitPosition] = getClosestPositionByPath(resources, closestToRetreatOrTargetUnit.pos, pathablePositions);
      targetUnit['retreatCandidates'][positionString] = {
        'closestToRetreat': closestToRetreatOrTargetUnit,
        'getDistanceByPath': getDistanceByPath(resources, closestToRetreatOrTargetUnit.pos, closestToRetreatOrTargetUnitPosition),
      }
      const { pos } = unit;
      if (pos === undefined) return false;
      const [closestToUnitByPath] = getClosestPositionByPath(resources, pos, pathablePositions);
      unit['retreatCandidates'][positionString] = {
        'getDistanceByPath': getDistanceByPath(resources, pos, closestToUnitByPath),
      }
      const getDistanceByPathToRetreat = unit['retreatCandidates'][positionString]['getDistanceByPath'];
      if (getDistanceByPathToRetreat === Infinity) return false;
      return getDistanceByPathToRetreat <= targetUnit['retreatCandidates'][positionString]['getDistanceByPath'];
    } else {
      return true;
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
      }).sort((a, b) => getDistanceByPath(resources, a.pos, unit.pos) - getDistanceByPath(resources, b.pos, unit.pos));
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

/**
 * @param {Unit} unit
 * @param {Unit[]} units
 * @returns {Unit[]}
 */
function setUnitsProperty(unit, units) {
  return units.filter(toFilterUnit => {
    if (unit.pos === undefined || toFilterUnit.pos === undefined || unit.radius === undefined || toFilterUnit.radius === undefined) return false;
    const { weapons } = toFilterUnit.data();
    if (weapons === undefined) return false;
    const weaponRange = weapons.reduce((acc, weapon) => {
      if (weapon.range === undefined) return acc;
      return weapon.range > acc ? weapon.range : acc;
    }, 0);
    
    return distance(unit.pos, toFilterUnit.pos) <= weaponRange + unit.radius + toFilterUnit.radius + getTravelDistancePerStep(toFilterUnit) + getTravelDistancePerStep(unit);
  });
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 */
function inCombatRange(data, unit, targetUnit) {
  const { pos, radius, unitType } = unit;
  if (pos === undefined || radius === undefined || unitType === undefined) return false;
  const { pos: targetPos, radius: targetRadius } = targetUnit;
  if (targetPos === undefined || targetRadius === undefined) return false;
  const { weapons } = targetUnit.data();
  if (weapons === undefined) return false;
  const weapon = getWeaponThatCanAttack(data, unitType, targetUnit);
  if (weapon === undefined) return false;
  const { range } = weapon;
  if (range === undefined) return false;
  return distance(pos, targetPos) <= range + radius + targetRadius + getTravelDistancePerStep(targetUnit) + getTravelDistancePerStep(unit);
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
function getTimeToTargetTech(world, unitType) {
  const { data, resources } = world;
  const { units } = resources.get();
  const unitTypeData = data.getUnitTypeData(unitType);
  const { techRequirement } = unitTypeData;
  if (techRequirement === undefined || techRequirement === 0) return 0;
  const { buildTime } = data.getUnitTypeData(techRequirement);
  if (buildTime === undefined) return 0;
  const [techUnit] = units.getById(techRequirement).sort((a, b) => {
    const { buildProgress: buildProgressA } = a;
    const { buildProgress: buildProgressB } = b;
    if (buildProgressA === undefined || buildProgressB === undefined) return 0;
    return buildProgressB - buildProgressA;
  });
  if (techUnit === undefined) return 0;
  const { buildProgress } = techUnit;
  if (buildProgress === undefined) return 0;
  return getTimeInSeconds((1 - buildProgress) * buildTime);
}

/**
 * @param {Unit} builder
 */
function setBuilderLabel(builder) {
  builder.labels.set('builder', true);
  if (builder.labels.has('mineralField')) {
    const mineralField = builder.labels.get('mineralField');
    if (mineralField) {
      mineralField.labels.set('workerCount', mineralField.labels.get('workerCount') - 1);
      builder.labels.delete('mineralField');
    }
  }
}

/**
 * 
 * @param {Unit} unit 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopUnitFromMovingToPosition(unit, position) {
  const collectedActions = [];
  const { orders } = unit;
  if (orders === undefined) return collectedActions;
  if (orders.length > 0) {
    const { targetWorldSpacePos } = orders[0];
    if (targetWorldSpacePos === undefined) return collectedActions;
    const distanceToTarget = distance(targetWorldSpacePos, position);
    if (distanceToTarget < 1) {
      collectedActions.push(createUnitCommand(STOP, [unit]));
    }
  }
  return collectedActions;
}
