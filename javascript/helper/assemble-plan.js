//@ts-check
"use strict"

const { WARPGATE, OVERLORD, MINERALFIELD, BARRACKS, GATEWAY, PHOTONCANNON } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const rallyUnits = require("./rally-units");
const { WarpUnitAbility, UnitType, Upgrade } = require("@node-sc2/core/constants");
const continuouslyBuild = require("./continuously-build");
const { TownhallRace, GasMineRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { attack } = require("./behavior/army-behavior");
const threats = require("./base-threats");
const { generalScouting, cancelEarlyScout } = require("../builds/scouting");
const { labelQueens, inject, spreadCreep, maintainQueens } = require("../builds/zerg/queen-management");
const { overlordCoverage } = require("../builds/zerg/overlord-management");
const { salvageBunker } = require("../builds/terran/salvage-bunker");
const { expand } = require("./general-actions");
const { repairBurningStructures, repairDamagedMechUnits, repairBunker, finishAbandonedStructures } = require("../builds/terran/repair");
const { getMiddleOfNaturalWall, getCandidatePositions, getInTheMain } = require("./placement/placement-helper");
const { restorePower } = require("./protoss");
const { liftToThird } = require("./terran");
const { balanceResources } = require("../systems/manage-resources");
const { addonTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const runBehaviors = require("./behavior/run-behaviors");
const mismatchMappings = require("../systems/salt-converter/mismatch-mapping");
const { getStringNameOfConstant } = require("../services/logging-service");
const { keepPosition } = require("../services/placement-service");
const { getEnemyWorkers, deleteLabel, getMineralFieldTarget } = require("../systems/unit-resource/unit-resource-service");
const planService = require("../services/plan-service");
const scoutingService = require("../systems/scouting/scouting-service");
const trackUnitsService = require("../systems/track-units/track-units-service");
const unitTrainingService = require("../systems/unit-training/unit-training-service");
const { getAvailableExpansions, getNextSafeExpansions } = require("./expansions");
const { getSupply, hasEarmarks, clearEarmarks } = require("../services/data-service");
const worldService = require("../services/world-service");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { pointsOverlap } = require("./utilities");
const resourceManagerService = require("../services/resource-manager-service");
const { getTargetLocation } = require("../services/map-resource-service");
const scoutService = require("../systems/scouting/scouting-service");
const { creeperBehavior } = require("./behavior/labelled-behavior");
const { convertLegacyStep, convertLegacyPlan, setPlan } = require("../services/plan-service");
const { warpIn } = require("../services/resource-manager-service");
const { createUnitCommand } = require("../services/actions-service");
const { setPendingOrders } = require("../services/unit-service");
const MapResourceService = require("../services/map-resource-service");
const { requiresPylon } = require("../services/agent-service");

let ATTACKFOOD = 194;

class AssemblePlan {
  /**
   * @param {{ orders: any; unitTypes: { mainCombatTypes: any; defenseTypes: [UnitTypeId]; defenseStructures: any; supportUnitTypes: any; }; harass: any; }} plan
   */
  constructor(plan) {
    this.collectedActions = [];
    /** @type {false | Point2D} */
    planService.legacyPlan = plan.orders;
    planService.harass = plan.harass || null;
    planService.convertedLegacyPlan = convertLegacyPlan(plan.orders);
    planService.trainingTypes = getLegacyPlanTrainingTypes();
    setPlan(planService.convertedLegacyPlan);
    this.mainCombatTypes = plan.unitTypes.mainCombatTypes;
    this.defenseTypes = plan.unitTypes.defenseTypes;
    this.defenseStructures = plan.unitTypes.defenseStructures;
    this.supportUnitTypes = plan.unitTypes.supportUnitTypes;
  }
  /**
   * @param {World} world
   * @param {any} state
   */
  async onStep(world, state) {
    const { data, resources } = world;
    const { actions } = resources.get();
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    this.collectedActions = [];
    this.state = state;
    this.state.defenseStructures = this.defenseStructures;
    this.world = world;
    this.agent = world.agent;
    this.data = world.data;
    if (this.foodUsed > this.world.agent.foodUsed) {
      planService.pausePlan = false;
    }
    this.foodUsed = this.world.agent.foodUsed;
    this.resources = world.resources;
    this.frame = this.resources.get().frame;
    this.map = this.resources.get().map;
    this.units = this.resources.get().units;
    this.resourceTrigger = this.agent.minerals > 512 && this.agent.vespene > 256;
    this.threats = threats(this.resources, this.state);
    const { defend, getFoodUsed, shortOnWorkers } = worldService;
    await this.runPlan(world);
    if (this.foodUsed < ATTACKFOOD) {
      if (!this.state.pushMode) {
        if (this.state.defenseMode) {
          this.collectedActions.push(...await defend(world, this.mainCombatTypes, this.supportUnitTypes, this.threats));
        } else {
          this.collectedActions.push(...rallyUnits(world, this.supportUnitTypes, this.state.defenseLocation));
        }
      }
    } else {
      const { selfCombatSupply, inFieldSelfSupply } = trackUnitsService;
      if (!worldService.outpowered || selfCombatSupply === inFieldSelfSupply) { this.collectedActions.push(...attack(this.world, this.mainCombatTypes, this.supportUnitTypes)); }
    }
    if (getFoodUsed() >= 132 && !shortOnWorkers(world)) { this.collectedActions.push(...await expand(world)); }
    this.checkEnemyBuild();
    let completedBases = this.units.getBases().filter(base => base.buildProgress >= 1);
    if (completedBases.length >= 3) {
      this.collectedActions.push(...salvageBunker(this.units));
      this.state.defendNatural = false;
      scoutingService.enemyBuildType = 'midgame';
    } else {
      this.state.defendNatural = true;
    }
    await this.raceSpecificManagement(world);
    this.collectedActions.push(...await runBehaviors(world));
    const label = 'pendingOrders';
    this.units.withLabel(label).forEach(unit => unit.labels.delete(label));
    clearEarmarks(data);
    await actions.sendAction(this.collectedActions);
  }

  /**
   * @param {World} world
   * @param {number} food
   * @param {AbilityId} abilityId
   * @param {{ targetType?: UnitTypeId; targetCount?: number; countType?: UnitTypeId; continuous?: boolean; }} conditions
   * @returns {Promise<void>}
   */
  async ability(world, food, abilityId, conditions) {
    const { agent, data, resources } = world;
    const { foodUsed } = agent;
    const { actions, units } = resources.get();
    const { getFoodUsed } = worldService;
    if (getFoodUsed() >= food) {
      if (conditions === undefined || conditions.targetType || conditions.targetCount === units.getById(conditions.countType).length + units.withCurrentOrders(abilityId).length) {
        if (conditions && conditions.targetType && conditions.continuous === false) { if (foodUsed !== food) { return; } }
        let canDoTypes = data.findUnitTypesWithAbility(abilityId);
        if (canDoTypes.length === 0) {
          canDoTypes = units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
        }
        const unitsCanDo = units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
        if (unitsCanDo.length > 0) {
          let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
          const unitCommand = createUnitCommand(abilityId, [unitCanDo]);
          if (conditions && conditions.targetType) {
            let target;
            if (conditions.targetType === MINERALFIELD) {
              if ((conditions.controlled && agent.minerals <= 512) || !conditions.controlled) {
                target = getMineralFieldTarget(units, unitCanDo);
              } else { return; }
            } else {
              const targets = units.getById(conditions.targetType).filter(unit => !unit.noQueue && unit.buffIds.indexOf(281) === -1);
              target = targets[Math.floor(Math.random() * targets.length)];
            }
            if (target) { unitCommand.targetUnitTag = target.tag; }
            else { return; }
          }
          await actions.sendAction([unitCommand]);
          planService.pausePlan = false;
        } else {
          if (conditions === undefined || conditions.targetType === undefined) {
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      }
    }
  }
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType 
   * @param {number} targetCount 
   * @param {Point2D[]} candidatePositions
   * @returns {Promise<void>}
   */
  async build(world, unitType, targetCount, candidatePositions = []) {
    const { addAddOn, getUnitCount, getUnitTypeCount, morphStructureAction } = worldService;
    const { agent, data, resources } = world;
    const { race } = agent;
    const { actions, map, units } = resources.get();
    const unitTypeCount = getUnitTypeCount(world, unitType);
    const unitCount = getUnitCount(world, unitType);
    if (unitTypeCount <= targetCount && unitCount <= targetCount) {
      switch (true) {
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            if (units.getBases().length === 2 && race === Race.TERRAN) {
              candidatePositions = await getInTheMain(resources, unitType);
              await this.buildBuilding(world, unitType, candidatePositions);
            } else {
              resourceManagerService.availableExpansions = resourceManagerService.availableExpansions.length === 0 ? getAvailableExpansions(resources) : resourceManagerService.availableExpansions;
              const { availableExpansions } = resourceManagerService;
              candidatePositions.push(getNextSafeExpansions(world, availableExpansions)[0]);
              await this.buildBuilding(world, unitType, candidatePositions);
            }
          } else {
            await actions.sendAction(await morphStructureAction(world, unitType));
          }
          break;
        case addonTypes.includes(unitType): {
          const { addEarmark, getAbilityIdsForAddons, getUnitTypesWithAbilities } = worldService;
          if (agent.canAfford(unitType)) {
            const abilityIds = getAbilityIdsForAddons(data, unitType);
            let canDoTypes = getUnitTypesWithAbilities(data, abilityIds);
            const addOnUnits = units.withLabel('addAddOn').filter(addOnUnit => {
              const addOnPosition = addOnUnit.labels.get('addAddOn');
              if (addOnPosition && distance(addOnUnit.pos, addOnPosition) < 1) { addOnUnit.labels.delete('addAddOn'); }
              else { return true; }
            });
            const availableAddOnUnits = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId) && (!unit['pendingOrders'] || unit['pendingOrders'].length === 0)));
            const unitsCanDo = availableAddOnUnits.length > 0 ? addOnUnits : units.getByType(canDoTypes).filter(unit => {
              return abilityIds.some(abilityId => unit.abilityAvailable(abilityId) && (!unit['pendingOrders'] || unit['pendingOrders'].length === 0));
            });
            if (unitsCanDo.length > 0) {
              let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
              await addAddOn(world, unitCanDo, unitType);
            } else {
              const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
              await balanceResources(world, mineralCost / vespeneCost);
              planService.pausePlan = true;
              planService.continueBuild = false;
            }
          }       
          addEarmark(data, data.getUnitTypeData(unitType));
          break;
        }
        default:
          if (PHOTONCANNON === unitType) { 
            candidatePositions = map.getNatural().areas.placementGrid;
          }
          await this.buildBuilding(world, unitType, candidatePositions);
      }
    }
  }

  /**
   * @param {World} world
   * @param {UnitTypeId} unitType 
   * @param {Point2D[]} candidatePositions 
   */
  async buildBuilding(world, unitType, candidatePositions) {
    const { findPlacements, premoveBuilderToPosition } = worldService;
    const { agent, resources } = world;
    const { actions } = resources.get();
    let buildingPosition = await getBuildingPosition(world, unitType, candidatePositions);
    candidatePositions = buildingPosition ? [buildingPosition] : findPlacements(world, unitType);
    planService.buildingPosition = buildingPosition;
    if (buildingPosition) {
      if (agent.canAfford(unitType)) {
        if (await actions.canPlace(unitType, [buildingPosition])) {
          const { assignAndSendWorkerToBuild } = worldService;
          await actions.sendAction(assignAndSendWorkerToBuild(world, unitType, buildingPosition));
          planService.pausePlan = false;
          planService.continueBuild = true;
        } else {
          buildingPosition = keepPosition(world, unitType, buildingPosition) ? buildingPosition : false;
          planService.buildingPosition = buildingPosition;
          if (buildingPosition) {
            this.collectedActions.push(...premoveBuilderToPosition(world, buildingPosition, unitType));
          }
        }
      } else {
        this.collectedActions.push(...premoveBuilderToPosition(world, buildingPosition, unitType));
      }
    }
  }
  checkEnemyBuild() {
    const { frame } = this.resources.get();
    if (scoutingService.earlyScout) {
      if (frame.timeInSeconds() > 122) {
        scoutingService.earlyScout = false;
        console.log(scoutingService.scoutReport);
        cancelEarlyScout(this.units);
        return;
      } else {
        const suspiciousWorkerCount = getEnemyWorkers(this.world).filter(worker => distance(worker.pos, this.map.getEnemyMain().townhallPosition) > 16).length;
        if (suspiciousWorkerCount > 2) {
          scoutingService.enemyBuildType = 'cheese';
          scoutingService.scoutReport = `${scoutingService.enemyBuildType} detected:
            Worker Rush Detected: ${suspiciousWorkerCount} sus workers.`;
          scoutingService.earlyScout = false;
          console.log(scoutingService.scoutReport);
          cancelEarlyScout(this.units);
          return;
        }
        let conditions = [];
        const enemyFilter = { alliance: Alliance.ENEMY };
        switch (scoutingService.opponentRace) {
          case Race.PROTOSS: {
            const moreThanTwoGateways = this.units.getById(GATEWAY, enemyFilter).length > 2;
            if (moreThanTwoGateways) {
              console.log(frame.timeInSeconds(), 'More than two gateways');
              scoutingService.enemyBuildType = 'cheese';
              scoutingService.earlyScout = false;
            }
            conditions = [
              this.units.getById(GATEWAY, enemyFilter).length === 2,
            ];
            if (!conditions.every(c => c)) {
              scoutingService.enemyBuildType = 'cheese';
            } else {
              scoutingService.enemyBuildType = 'standard';
            }
            scoutingService.scoutReport = `${scoutingService.enemyBuildType} detected:
            Gateway Count: ${this.units.getById(GATEWAY, enemyFilter).length}.`;
            break;
          }
          case Race.TERRAN:
            // scout alive, more than 1 barracks.
            const moreThanOneBarracks = this.units.getById(BARRACKS, enemyFilter).length > 1;
            if (scoutingService.enemyBuildType !== 'cheese') {
              if (moreThanOneBarracks) {
                console.log(frame.timeInSeconds(), 'More than one barracks');
                scoutingService.enemyBuildType = 'cheese';
              }
            }
            // 1 barracks and 1 gas, second command center
            conditions = [
              this.units.getById(BARRACKS, enemyFilter).length === 1,
              this.units.getById(GasMineRace[scoutingService.opponentRace], enemyFilter).length === 1,
              !!this.map.getEnemyNatural().getBase()
            ];
            if (!conditions.every(c => c)) {
              scoutingService.enemyBuildType = 'cheese';
            } else {
              scoutingService.enemyBuildType = 'standard';
            }
            scoutingService.scoutReport = `${scoutingService.enemyBuildType} detected:
            Barracks Count: ${this.units.getById(BARRACKS, enemyFilter).length}.
            Gas Mine Count: ${this.units.getById(GasMineRace[scoutingService.opponentRace], enemyFilter).length}.
            Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}.`;
            break;
        }
      }
      if (!scoutingService.earlyScout) {
        console.log(scoutingService.scoutReport);
        cancelEarlyScout(this.units);
      }
    }
  }

  async getMiddleOfNaturalWall(unitType) {
    return await getMiddleOfNaturalWall(this.resources, unitType);
  }

  /**
   * @param {World} world 
   * @param {Unit} createdUnit 
   */
  async onUnitCreated(world, createdUnit) {
    await generalScouting(world, createdUnit);
    await world.resources.get().actions.sendAction(this.collectedActions);
  }
  /**
   * @param {World} world
   */
  async raceSpecificManagement(world) {
    const { agent } = world;
    const { race } = agent;
    switch (race) {
      case Race.ZERG:
        labelQueens(this.units);
        this.collectedActions.push(...inject(this.world));
        this.collectedActions.push(...overlordCoverage(this.units));
        this.collectedActions.push(...await spreadCreep(world));
        this.collectedActions.push(...creeperBehavior(world));
        break;
      case Race.TERRAN:
        this.collectedActions.push(...repairBurningStructures(this.resources));
        this.collectedActions.push(...repairDamagedMechUnits(this.resources));
        this.collectedActions.push(...repairBunker(this.resources));
        this.collectedActions.push(...finishAbandonedStructures(this.resources));
        break;
      case Race.PROTOSS:
        this.collectedActions.push(...await restorePower(this.world));
        break;
    }
  }
  
  /**
   * @param {UnitResource} units
   * @param {number[]} foodRanges
   * @returns {Promise<void>}
   */
  async push(units, foodRanges) {
    const { push } = worldService;
    const label = 'pusher';
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (this.state.pushMode === false && !this.state.cancelPush) {
        [...this.mainCombatTypes, ...this.supportUnitTypes].forEach(type => {
          this.units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')).forEach(unit => unit.labels.set(label, true));
        });
        console.log('getSupply(this.units.withLabel(label), this.data)', getSupply(this.data, this.units.withLabel(label)));
        this.state.pushMode = true;
      }
    }
    if (units.withLabel(label).length > 0 && !this.state.cancelPush) {
      if (worldService.outpowered) {
        this.state.cancelPush = true;
        deleteLabel(this.units, label);
        console.log('cancelPush');
      } else {
        this.collectedActions.push(...await push(this.world, this.mainCombatTypes, this.supportUnitTypes));
      }
    } else if (this.state && this.state.pushMode === true) {
      this.state.pushMode = false;
      this.state.cancelPush = true;
      deleteLabel(this.units, label);
      console.log('cancelPush');
    }
  }
  /**
   * @param {World} world
   * @param {number[]} foodRanges 
   * @param {UnitTypeId} unitType 
   * @param {string} targetLocation
   * @param {{scoutType: string, label: string, unitType: UnitTypeId, unitCount: number}} conditions 
   * @returns {void}
   */
  scout(world, foodRanges, unitType, targetLocation, conditions) {
    const { getFoodUsed, getUnitCount } = worldService;
    const { resources } = world;
    const { map, units } = resources.get();
    const label = conditions && conditions.label ? conditions.label : 'scout';
    const isScoutTypeActive = conditions && conditions.scoutType ? scoutingService[conditions.scoutType] : true;
    const requiredUnitCount = conditions && conditions.unitCount ? getUnitCount(world, conditions.unitType) >= conditions.unitCount : true;
    if (foodRanges.indexOf(getFoodUsed()) > -1 && isScoutTypeActive && requiredUnitCount) {
      const location = getTargetLocation(map, `get${targetLocation}`);
      let labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length === 0) {
        scoutService.setScout(units, location, unitType, label);      }
    } else {
      if (!isScoutTypeActive) {
        const labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        if (labelledScouts.length > 0) {
          labelledScouts.forEach(scout => {
            scout.removeLabel(label);
            scout.labels.set('clearFromEnemy', true);
          });
        }
      }
    }
  }
  /**
   * @param {World} world
   * @param {number} food
   * @param {number} unitType
   * @param {null|number} targetCount
   * @returns {Promise<void>}
   */
  async train(world, food, unitType, targetCount) {
    const { addEarmark, canBuild, getFoodUsed, getUnitCount, isSupplyNeeded, setAndLogExecutedSteps } = worldService;
    const { data, resources } = world;
    const { actions } = resources.get();
    if (getFoodUsed() >= food) {
      let abilityId = this.data.getUnitTypeData(unitType).abilityId;
      const unitTypeData = data.getUnitTypeData(unitType);
      if (targetCount === null || getUnitCount(world, unitType) <= targetCount) {
        if (canBuild(this.world, unitType)) {
          const trainer = this.units.getProductionUnits(unitType).find(unit => {
            const pendingOrders = unit['pendingOrders'] ? unit['pendingOrders'] : [];
            const noQueue = unit.noQueue && pendingOrders.length === 0;
            return (
              noQueue ||
              (unit.hasReactor() && unit.orders.length + pendingOrders.length < 2)
            ) &&
              unit.abilityAvailable(abilityId);
          });
          if (trainer) {
            const unitCommand = {
              abilityId,
              unitTags: [trainer.tag],
            }
            await actions.sendAction([unitCommand]);
            setPendingOrders(trainer, unitCommand);
            planService.pendingFood += unitTypeData.foodRequired;
          } else {
            abilityId = WarpUnitAbility[unitType];
            const warpGates = this.units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
            if (warpGates.length > 0) {
              warpIn(this.resources, this, unitType);
            } else {
              addEarmark(data, unitTypeData);
              return;
            }
          }
          planService.pausePlan = false;
          setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType));
          unitTrainingService.selectedTypeToBuild = null;
          console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`);
          addEarmark(data, unitTypeData);
        } else {
          if (isSupplyNeeded(this.world) && unitType !== OVERLORD) {
          } else if (!this.agent.canAfford(unitType)) {
            addEarmark(data, unitTypeData);
            console.log(`Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.isPlanPaused);
          }
        }
      } 
    }
  }
  /**
   * @param {World} world
   * @param {number} food
   * @param {number} upgradeId
   */
  async upgrade(world, food, upgradeId) {
    const { addEarmark, getFoodUsed, setAndLogExecutedSteps } = worldService;
    const { agent, data, resources } = world;
    const { upgradeIds } = agent; if (upgradeIds === undefined) return;
    const { actions, frame, units } = resources.get();
    if (upgradeIds.includes(upgradeId)) return;
    const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
    const upgradeData = data.getUpgradeData(upgradeId);
    const { abilityId } = data.getUpgradeData(upgradeId); if (abilityId === undefined) return;
    const upgradeInProgress = upgraders.find(upgrader => upgrader.orders && upgrader.orders.find(order => order.abilityId === abilityId));
    if (upgradeInProgress) return;
    if (getFoodUsed() >= food) {
      const upgradeName = getStringNameOfConstant(Upgrade, upgradeId)
      upgradeId = mismatchMappings[upgradeName] ? Upgrade[mismatchMappings[upgradeName]] : Upgrade[upgradeName];
      const { abilityId } = upgradeData;
      const { mineralCost, vespeneCost } = data.getUpgradeData(upgradeId);
      if (mineralCost === undefined || vespeneCost === undefined) return;
      if (agent.canAffordUpgrade(upgradeId)) {
        const upgrader = units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
        if (upgrader) {
          const unitCommand = { abilityId, unitTags: [upgrader.tag] };
          await actions.sendAction([unitCommand]);
          planService.pausePlan = false;
          setAndLogExecutedSteps(world, frame.timeInSeconds(), upgradeName);
          console.log(`Upgrading ${upgradeName}`);
        } else {
          console.log(`${upgradeName} not available`);
          await balanceResources(world, mineralCost / vespeneCost);
        }
      } else {
        console.log(`Cannot afford ${upgradeName}`);
      }
    }
    addEarmark(data, upgradeData);
  }

  /**
   * @param {World} world
   */
  async runPlan(world) {
    const { addEarmark, buildSupplyOrTrain, setFoodUsed, swapBuildings, train } = worldService;
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return;
    if (planService.currentStep > -1) return;
    planService.continueBuild = true;
    planService.pendingFood = 0;
    const { legacyPlan } = planService;
    for (let step = 0; step < legacyPlan.length; step++) {
      planService.currentStep = step;
      if (planService.continueBuild) {
        let setEarmark = !hasEarmarks(data);
        const trueActions = ['build', 'train', 'upgrade'];
        const trueStep = legacyPlan.slice(step).find(step => trueActions.includes(step[1]));
        if (trueStep) {
          const convertedLegacyStep = convertLegacyStep(trueStep);
          await buildSupplyOrTrain(world, convertedLegacyStep);
        } 
        const planStep = legacyPlan[step];
        let targetCount = planStep[3];
        const foodTarget = planStep[0];
        let conditions;
        let unitType;
        let foodUsed = worldService.getFoodUsed();
        switch (planStep[1]) {
          case 'ability':
            const abilityId = planStep[2];
            conditions = planStep[3];
            await this.ability(world, foodTarget, abilityId, conditions);
            break;
          case 'build': {
            unitType = planStep[2];
            this.unitType = unitType;
            // Check if the unitType requires a Pylon for power
            if (requiresPylon(agent, unitType)) {
              // Check if there is a Pylon available
              const pylons = units.getAlive(Alliance.SELF).filter(unit => unit.unitType === UnitType.PYLON);
              if (pylons.length === 0) {
                // If there's no Pylon, we break from the switch statement to prevent the build command
                break;
              }
            }
            if (planStep[5]) {
              const { enemyBuildType, races } = planStep[5];
              if (enemyBuildType && scoutingService.enemyBuildType !== enemyBuildType && !scoutingService.earlyScout) { break; }
              if (races && !races.includes(scoutingService.opponentRace)) { break; }
            }
            const candidatePositions = planStep[4] ? await getCandidatePositions(resources, planStep[4], unitType) : [];
            await this.build(world, unitType, targetCount, candidatePositions);
            break;
          }
          case 'continuouslyBuild':
            const foodRanges = planStep[0];
            if (this.resourceTrigger && foodRanges.indexOf(this.foodUsed) > -1) { await continuouslyBuild(this.world, this, planStep[2], planStep[3]); } break;
          case 'liftToThird': if (foodUsed >= foodTarget) { await liftToThird(this.resources); } break;
          case 'maintainQueens': if (foodUsed >= foodTarget) { await maintainQueens(this.world); } break;
          case 'push': this.push(units, foodTarget); break;
          case 'scout': {
            unitType = planStep[2];
            const targetLocation = planStep[3];
            conditions = planStep[4];
            if (!conditions) { conditions = {}; }
            const label = `scout${targetLocation}`
            conditions.label = label;
            this.scout(world, foodTarget, unitType, targetLocation, conditions);
            break;
          }
          case 'train':
            unitType = planStep[2];
            // try { await this.train(world, foodTarget, unitType, targetCount); } catch (error) { console.log(error) } break;
            await train(world, unitType, targetCount);
            break;
          case 'swapBuildings':
            conditions = planStep[2];
            if (foodUsed >= foodTarget) { await swapBuildings(this.world, conditions); }
            break;
          case 'upgrade':
            const upgradeId = planStep[2];
            await this.upgrade(world, foodTarget, upgradeId);
            break;
        }
        setFoodUsed(world);
        if (setEarmark && hasEarmarks(data)) {
          const earmarkTotals = data.getEarmarkTotals('');
          const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
          const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
          const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
          balanceResources(world, mineralsNeeded / vespeneNeeded);
        }
      } else {
        break;
      }
    }
    if (!hasEarmarks(data)) {
      addEarmark(data, data.getUnitTypeData(WorkerRace[agent.race]));
      const earmarkTotals = data.getEarmarkTotals('');
      const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
      const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
      const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
      balanceResources(world, mineralsNeeded / vespeneNeeded);
    }
    planService.latestStep = planService.currentStep;
    planService.currentStep = -1;
    if (!planService.pausedThisRound) {
      planService.pausePlan = false;
    }
  }
  
}

module.exports = AssemblePlan;

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @param {Point2D[]} candidatePositions 
 * @returns {Promise<Point2D | false>}
 */
async function getBuildingPosition(world, unitType, candidatePositions) {
  const { findPosition, isStrongerAtPosition } = worldService;
  const { agent, resources } = world;
  const { race } = agent;
  let position = planService.buildingPosition;
  if (position) {
    const { map, units } = resources.get();
    const areEnemyUnitsInWay = checkIfEnemyUnitsInWay(units, unitType, position);
    const enemyBlockingExpansion = areEnemyUnitsInWay && TownhallRace[race][0] === unitType;
    const strongerAtFoundPosition = isStrongerAtPosition(world, position);
    if (
      (gasMineTypes.includes(unitType) ? MapResourceService.isGeyserFree(map, position) : map.isPlaceableAt(unitType, position))
      && !enemyBlockingExpansion
      && strongerAtFoundPosition
    ) {
      return position;
    }
  }
  return findPosition(world, unitType, candidatePositions.filter(pos => isStrongerAtPosition(world, pos)));
}

/**
 * @param {UnitResource} units
 * @param {UnitTypeId} unitType
 * @param {Point2D} position
 * @returns {boolean}
 */
function checkIfEnemyUnitsInWay(units, unitType, position) {
  const footprint = getFootprint(unitType);
  if (footprint === undefined) return false;
  const enemyUnitCoverage = units.getAlive(Alliance.ENEMY)
    .filter(enemyUnit => enemyUnit.pos && distance(enemyUnit.pos, position) < 16)
    .map(enemyUnit => {
      const { pos, radius, unitType } = enemyUnit;
      if (pos === undefined || radius === undefined) return [];
      if (!enemyUnit.isStructure()) {
        return [pos, ...gridsInCircle(pos, radius)];
      } else {
        const footprint = getFootprint(unitType);
        if (footprint === undefined) return [];
        return cellsInFootprint(pos, footprint);
      }
    }).flat();
  return pointsOverlap(enemyUnitCoverage, cellsInFootprint(position, footprint));
}

/**
 * return {number[]} - array of unit types that are trained in the plan
 */
function getLegacyPlanTrainingTypes() {
  return planService.convertedLegacyPlan.reduce((/** @type {UnitTypeId[]} */ acc, step) => {
    const { unitType } = step; if (unitType === null || unitType === undefined) { return acc; }
    if (step.orderType === 'train') {
      acc.push(unitType);
    }
    return acc;
  }, []);
}

