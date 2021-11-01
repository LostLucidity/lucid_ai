//@ts-check
"use strict"

const { PYLON, WARPGATE, OVERLORD, SUPPLYDEPOT, SUPPLYDEPOTLOWERED, MINERALFIELD, BARRACKS, SPAWNINGPOOL, GATEWAY, ZERGLING, PHOTONCANNON, PROBE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { MOVE } = require("@node-sc2/core/constants/ability");
const canBuild = require("./can-afford");
const isSupplyNeeded = require("./supply");
const rallyUnits = require("./rally-units");
const shortOnWorkers = require("./short-on-workers");
const { WarpUnitAbility, UnitType, Upgrade, UnitTypeId } = require("@node-sc2/core/constants");
const continuouslyBuild = require("./continuously-build");
const { TownhallRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const { defend, attack, push } = require("./behavior/army-behavior");
const threats = require("./base-threats");
const { generalScouting, cancelEarlyScout } = require("../builds/scouting");
const { labelQueens, inject, spreadCreep, maintainQueens, spreadCreepByQueen } = require("../builds/zerg/queen-management");
const { overlordCoverage } = require("../builds/zerg/overlord-management");
const { moveAway } = require("../builds/helper");
const { salvageBunker } = require("../builds/terran/salvage-bunker");
const { expand } = require("./general-actions");
const { repairBurningStructures, repairDamagedMechUnits, repairBunker, finishAbandonedStructures } = require("../builds/terran/repair");
const { harass } = require("../builds/harass");
const { getMiddleOfNaturalWall, findPosition, inTheMain, getCandidatePositions, findPlacements } = require("./placement/placement-helper");
const locationHelper = require("./location");
const { restorePower, warpIn } = require("./protoss");
const { liftToThird, addAddOn, swapBuildings } = require("./terran");
const { balanceResources } = require("../systems/manage-resources");
const { addonTypes } = require("@node-sc2/core/constants/groups");
const runBehaviors = require("./behavior/run-behaviors");
const { haveAvailableProductionUnitsFor } = require("../systems/unit-training/unit-training-service");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { checkUnitCount } = require("../systems/track-units/track-units-service");
const mismatchMappings = require("../systems/salt-converter/mismatch-mapping");
const { getStringNameOfConstant } = require("../services/logging-service");
const { keepPosition } = require("../services/placement-service");
const { getEnemyWorkers, deleteLabel, premoveBuilderToPosition, setPendingOrders, getMineralFieldTarget } = require("../services/units-service");
const planService = require("../services/plan-service");
const { getNextPlanStep, getFoodUsed, unpauseAndLog } = require("../services/plan-service");
const scoutService = require("../systems/scouting/scouting-service");
const scoutingService = require("../systems/scouting/scouting-service");
const trackUnitsService = require("../systems/track-units/track-units-service");
const unitTrainingService = require("../systems/unit-training/unit-training-service");
const { getSupply } = require("../services/shared-service");
const { checkBuildingCount, getAbilityIdsForAddons, getUnitTypesWithAbilities, findAndPlaceBuilding, assignAndSendWorkerToBuild, setAndLogExecutedSteps } = require("../services/world-service");
const { getAvailableExpansions, getNextSafeExpansion } = require("./expansions");
const planActions = require("../systems/execute-plan/plan-actions");
const { addEarmark } = require("../services/data-service");

let actions;
let race;
let ATTACKFOOD = 194;

class AssemblePlan {
  constructor(plan) {
    this.collectedActions = [];
    this.foundPosition = null;
    planService.legacyPlan = plan.orders;
    this.mainCombatTypes = plan.unitTypes.mainCombatTypes;
    this.defenseTypes = plan.unitTypes.defenseTypes;
    this.defenseStructures = plan.unitTypes.defenseStructures;
    this.supportUnitTypes = plan.unitTypes.supportUnitTypes;
  }
  onEnemyFirstSeen(seenEnemyUnit) {
    scoutService.opponentRace = seenEnemyUnit.data().race;
  }
  onGameStart(world) {
    actions = world.resources.get().actions;
    race = world.agent.race;
    scoutService.opponentRace = world.agent.opponent.race;
  }
  /**
   * @param {World} world
   * @param {any} state
   */
  async onStep(world, state) {
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
    const trainUnitConditions = [
      scoutService.outsupplied,
      unitTrainingService.workersTrainingTendedTo && !planService.isPlanPaused,
      !shortOnWorkers(this.resources) && !planService.isPlanPaused,
    ];
    const { selfCombatSupply, inFieldSelfSupply } = trackUnitsService;
    if (trainUnitConditions.some(condition => condition)) {
      scoutService.outsupplied ? console.log('Scouted higher supply', selfCombatSupply, scoutingService.enemyCombatSupply) : console.log('Free build mode.');
      const nextStep = getNextPlanStep(this.foodUsed);
      const haveProductionAndTechForTypes = this.defenseTypes.filter(type => {
        return [
          haveAvailableProductionUnitsFor(world, type),
          this.agent.hasTechFor(type),
          nextStep ? this.data.getUnitTypeData(type).foodRequired <= nextStep[0] - this.foodUsed : true,
        ].every(condition => condition);
      });
      if (haveProductionAndTechForTypes.length > 0) {
        this.selectedTypeToBuild = this.selectedTypeToBuild ? this.selectedTypeToBuild : haveProductionAndTechForTypes[Math.floor(Math.random() * haveProductionAndTechForTypes.length)];
        let { mineralCost, vespeneCost } = this.data.getUnitTypeData(this.selectedTypeToBuild);
        if (this.selectedTypeToBuild === ZERGLING) {
          mineralCost += mineralCost;
          vespeneCost += vespeneCost;
        }
        const freeBuildThreshold = this.agent.minerals >= (mineralCost * 2) && this.agent.vespene >= (vespeneCost * 2);
        if (scoutService.outsupplied || freeBuildThreshold) {
          await this.train(this.foodUsed, this.selectedTypeToBuild, null);
        }
      }
    }
    await this.runPlan();
    if (this.foodUsed < ATTACKFOOD) {
      if (!this.state.pushMode) {
        if (this.state.defenseMode) {
          this.collectedActions.push(...await defend(world, this, this.mainCombatTypes, this.supportUnitTypes, this.threats));
        } else {
          this.collectedActions.push(...rallyUnits(world, this.supportUnitTypes, this.state.defenseLocation));
        }
      }
    } else {
      if (!scoutService.outsupplied || selfCombatSupply === inFieldSelfSupply) { this.collectedActions.push(...attack(this.world, this.mainCombatTypes, this.supportUnitTypes)); }
    }
    if (this.agent.minerals > 512) { this.manageSupply(); }
    if (getFoodUsed(this.foodUsed) >= 132 && !shortOnWorkers(this.resources)) { this.collectedActions.push(...await expand(world)); }
    this.checkEnemyBuild();
    let completedBases = this.units.getBases().filter(base => base.buildProgress >= 1);
    if (completedBases.length >= 3) {
      this.collectedActions.push(...salvageBunker(this.units));
      this.state.defendNatural = false;
      this.state.enemyBuildType = 'midgame';
    } else {
      this.state.defendNatural = true;
    }
    await this.raceSpecificManagement();
    this.collectedActions.push(...await runBehaviors(world));
    if (this.frame.getGameLoop() % 8 === 0) {
      this.units.getAlive().forEach(unit => delete unit['expansions']);
    }
    const label = 'pendingOrders';
    this.units.withLabel(label).forEach(unit => unit.labels.delete(label));
    this.data.get('earmarks').forEach(earmark => this.data.settleEarmark(earmark.name));
    await actions.sendAction(this.collectedActions);
  }

  async onUnitDamaged(resources, damagedUnit) {
    const { units } = resources.get();
    if (damagedUnit.labels.get('scoutEnemyMain') || damagedUnit.labels.get('scoutEnemyNatural')) {
      const [closestEnemyUnit] = units.getClosest(damagedUnit.pos, enemyTrackingService.enemyUnits);
      await actions.sendAction(moveAway(damagedUnit, closestEnemyUnit, 4));
    }
  }

  async ability(food, abilityId, conditions) {
    if (getFoodUsed(this.foodUsed) >= food) {
      if (conditions === undefined || conditions.targetType || conditions.targetCount === this.units.getById(conditions.countType).length + this.units.withCurrentOrders(abilityId).length) {
        if (conditions && conditions.targetType && conditions.continuous === false) { if (this.foodUsed !== food) { return; } }
        let canDoTypes = this.data.findUnitTypesWithAbility(abilityId);
        if (canDoTypes.length === 0) {
          canDoTypes = this.units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
        }
        const unitsCanDo = this.units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
        if (unitsCanDo.length > 0) {
          let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
          const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
          if (conditions && conditions.targetType) {
            let target;
            if (conditions.targetType === MINERALFIELD) {
              if ((conditions.controlled && this.agent.minerals <= 512) || !conditions.controlled) {
                target = getMineralFieldTarget(this.units, unitCanDo);
              } else { return; }
            } else {
              const targets = this.units.getById(conditions.targetType).filter(unit => !unit.noQueue && unit.buffIds.indexOf(281) === -1);
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
   * 
   * @param {number} food 
   * @param {UnitTypeId} unitType 
   * @param {number} targetCount 
   * @param {Point2D[]} candidatePositions 
   */
  async build(food, unitType, targetCount, candidatePositions = []) {
    if (getFoodUsed(this.foodUsed) >= food) {
      if (checkBuildingCount(this.world, unitType, targetCount)) {
        switch (true) {
          case GasMineRace[race] === unitType:
            try {
              if (this.map.freeGasGeysers().length > 0) {
                if (this.agent.canAfford(unitType)) {
                  await actions.buildGasMine();
                  planService.pausePlan = false;
                  setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType), );
                } else {
                  this.collectedActions.push(...premoveBuilderToPosition(this.units, this.map.freeGasGeysers()[0].pos));
                  const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
                  await balanceResources(this.world, mineralCost / vespeneCost);
                  planService.pausePlan = true;
                  planService.continueBuild = false;
                }

              }
            }
            catch (error) {
              console.log(error);
              planService.pausePlan = true;
              planService.continueBuild = false;
            }
            break;
          case TownhallRace[race].includes(unitType):
            if (TownhallRace[race].indexOf(unitType) === 0) {
              if (this.units.getBases().length === 2 && race === Race.TERRAN) {
                candidatePositions = await inTheMain(this.resources, unitType);
                this.collectedActions.push(...await findAndPlaceBuilding(this.world, unitType, candidatePositions));
              } else {
                const availableExpansions = getAvailableExpansions(this.resources);
                candidatePositions = availableExpansions.length > 0 ? [await getNextSafeExpansion(this.world, availableExpansions)] : [];
                this.collectedActions.push(...await findAndPlaceBuilding(this.world, unitType, candidatePositions));
              }
            } else {
              const actions = await planActions.ability(this.world, this.data.getUnitTypeData(unitType).abilityId);
              if (actions.length > 0) {
                unpauseAndLog(this.world, UnitTypeId[unitType]);
                addEarmark(this.data, this.data.getUnitTypeData(unitType));
                this.collectedActions.push(...actions);
              }
            }
            break;
          case addonTypes.includes(unitType):
            const abilityIds = getAbilityIdsForAddons(this.data, unitType);
            let canDoTypes = getUnitTypesWithAbilities(this.data, abilityIds);
            const addOnUnits = this.units.withLabel('addAddOn').filter(addOnUnit => {
              const addOnPosition = addOnUnit.labels.get('addAddOn');
              if (addOnPosition && distance(addOnUnit.pos, addOnPosition) < 1) { addOnUnit.labels.delete('addAddOn'); }
              else { return true; }
            });
            const unitsCanDo = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId))).length > 0 ? addOnUnits : this.units.getByType(canDoTypes).filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId)));
            if (unitsCanDo.length > 0) {
              let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
              await addAddOn(this.world, unitCanDo, unitType)
            } else {
              const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
              await balanceResources(this.world, mineralCost / vespeneCost);
              planService.pausePlan = true;
              planService.continueBuild = false;
            }
            break;
          case PHOTONCANNON === unitType:
            candidatePositions = this.map.getNatural().areas.placementGrid;
          default:
            if (candidatePositions.length === 0) { candidatePositions = await findPlacements(this.world, unitType); }
            await this.buildBuilding(unitType, candidatePositions);
        }
      }
    }
  }

  async buildBuilding(unitType, candidatePositions) {
    this.foundPosition = this.foundPosition ? this.foundPosition : await findPosition(this.resources, unitType, candidatePositions);
    if (this.foundPosition) {
      if (this.agent.canAfford(unitType)) {
        if (await actions.canPlace(unitType, [this.foundPosition])) {
          const unitTypeData = this.data.getUnitTypeData(unitType);
          await actions.sendAction(assignAndSendWorkerToBuild(this.world, unitType, this.foundPosition));
          planService.pausePlan = false;
          setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType), this.foundPosition);
          planService.continueBuild = false;
          this.foundPosition = null;
          addEarmark(this.data, unitTypeData);
        } else {
          this.foundPosition = keepPosition(this.resources, unitType, this.foundPosition) ? this.foundPosition : null;
          if (this.foundPosition) { this.collectedActions.push(...premoveBuilderToPosition(this.units, this.foundPosition)); }
          planService.pausePlan = true;
          planService.continueBuild = false;
        }
      } else {
        this.collectedActions.push(...premoveBuilderToPosition(this.units, this.foundPosition));
        const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
        await balanceResources(this.world, mineralCost / vespeneCost);
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
  }
  checkEnemyBuild() {
    const { frame } = this.resources.get();
    if (this.earlyScout) {
      if (frame.timeInSeconds() > 122) {
        this.earlyScout = false;
        console.log(this.scoutReport);
        cancelEarlyScout(this.units);
        return;
      }
      const suspiciousWorkerCount = getEnemyWorkers(this.world).filter(worker => distance(worker.pos, this.map.getEnemyMain().townhallPosition) > 16).length;
      if (suspiciousWorkerCount > 2) {
        this.state.enemyBuildType = 'cheese';
        this.scoutReport = `${this.state.enemyBuildType} detected:
          Worker Rush Detected: ${suspiciousWorkerCount} sus workers.`;
        this.earlyScout = false;
        console.log(this.scoutReport);
        cancelEarlyScout(this.units);
        return;
      }
      let conditions = [];
      const enemyFilter = { alliance: Alliance.ENEMY };
      switch (scoutService.opponentRace) {
        case Race.PROTOSS:
          const moreThanTwoGateways = this.units.getById(GATEWAY, enemyFilter).length > 2;
          if (moreThanTwoGateways) {
            console.log(frame.timeInSeconds(), 'More than two gateways');
            this.state.enemyBuildType = 'cheese';
            this.earlyScout = false;
          }
          conditions = [
            this.units.getById(GATEWAY, enemyFilter).length === 2,
          ];
          if (!conditions.every(c => c)) {
            this.state.enemyBuildType = 'cheese';
          } else {
            this.state.enemyBuildType = 'standard';
          }
          this.scoutReport = `${this.state.enemyBuildType} detected:
          Gateway Count: ${this.units.getById(GATEWAY, enemyFilter).length}.`;
          break;
        case Race.TERRAN:
          // scout alive, more than 1 barracks.
          const moreThanOneBarracks = this.units.getById(BARRACKS, enemyFilter).length > 1;
          if (this.state.enemyBuildType !== 'cheese') {
            if (moreThanOneBarracks) {
              console.log(frame.timeInSeconds(), 'More than one barracks');
              this.state.enemyBuildType = 'cheese';
            }
          }
          // 1 barracks and 1 gas, second command center
          conditions = [
            this.units.getById(BARRACKS, enemyFilter).length === 1,
            this.units.getById(GasMineRace[scoutService.opponentRace], enemyFilter).length === 1,
            !!this.map.getEnemyNatural().getBase()
          ];
          if (!conditions.every(c => c)) {
            this.state.enemyBuildType = 'cheese';
          } else {
            this.state.enemyBuildType = 'standard';
          }
          this.scoutReport = `${this.state.enemyBuildType} detected:
          Barracks Count: ${this.units.getById(BARRACKS, enemyFilter).length}.
          Gas Mine Count: ${this.units.getById(GasMineRace[scoutService.opponentRace], enemyFilter).length}.
          Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}.`;
          break;
        case Race.ZERG:
          const spawningPoolDetected = this.units.getById(SPAWNINGPOOL, enemyFilter).length > 0 || this.units.getById(ZERGLING, enemyFilter).length > 0;
          const enemyNaturalDetected = this.map.getEnemyNatural().getBase();
          if (this.state.enemyBuildType !== 'cheese') {
            if (spawningPoolDetected && !enemyNaturalDetected) {
              console.log(frame.timeInSeconds(), 'Pool first. Cheese detected');
              this.state.enemyBuildType = 'cheese';
              this.scoutReport = `${this.state.enemyBuildType} detected:
              Spawning Pool: ${this.units.getById(SPAWNINGPOOL, enemyFilter).length > 0}.
              Zerglings: ${this.units.getById(ZERGLING, enemyFilter).length > 0}
              Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}`;
              this.earlyScout = false;
            } else if (!spawningPoolDetected && enemyNaturalDetected) {
              console.log(frame.timeInSeconds(), 'Hatchery first. Standard.');
              this.state.enemyBuildType = 'standard';
              this.scoutReport = `${this.state.enemyBuildType} detected:
              Spawning Pool: ${this.units.getById(SPAWNINGPOOL, enemyFilter).length > 0}.
              Zerglings: ${this.units.getById(ZERGLING, enemyFilter).length > 0}
              Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}`;
              this.earlyScout = false;
            }
            if (!enemyNaturalDetected && !!this.map.getNatural().getBase()) {
              console.log(frame.timeInSeconds(), 'Enemy expanding slower. Cheese detected');
              this.state.enemyBuildType = 'cheese';
              this.scoutReport = `Enemy expanding slower. Cheese detected`;
              this.earlyScout = false;
            }
          }
          break;
      }
      if (!this.earlyScout) {
        console.log(this.scoutReport);
        cancelEarlyScout(this.units);
      }
    }
  }

  async getMiddleOfNaturalWall(unitType) {
    return await getMiddleOfNaturalWall(this.resources, unitType);
  };

  async inTheMain(unitType) {
    return await inTheMain(this.resources, unitType);
  }

  async manageSupply(foodRanges) {
    if (!foodRanges || foodRanges.indexOf(this.foodUsed) > -1) {
      if (isSupplyNeeded(this.agent, this.data, this.resources)) {
        switch (race) {
          // TODO: remove third parameter and handle undefined in train function.
          case Race.TERRAN:
            await this.build(this.foodUsed, SUPPLYDEPOT, this.units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).length);
            break;
          case Race.PROTOSS:
            await this.build(this.foodUsed, PYLON, this.units.getById(PYLON).length);
            break;
          case Race.ZERG:
            let abilityId = this.data.getUnitTypeData(OVERLORD).abilityId;
            await this.train(this.foodUsed, OVERLORD, this.units.getById(OVERLORD).length + this.units.withCurrentOrders(abilityId).length);
            break;
        }
      }
    }
  }

  async onUnitCreated(world, createdUnit) {
    await generalScouting(world, createdUnit);
    await world.resources.get().actions.sendAction(this.collectedActions);
  }
  async raceSpecificManagement() {
    switch (race) {
      case Race.ZERG:
        labelQueens(this.units);
        this.collectedActions.push(...inject(this.units));
        this.collectedActions.push(...overlordCoverage(this.units));
        this.collectedActions.push(...await spreadCreep(this.resources));
        this.collectedActions.push(...await spreadCreepByQueen(this.resources));
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
  async push(foodRanges) {
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
    if (this.units.withLabel(label).length > 0 && !this.state.cancelPush) {
      if (scoutService.outsupplied) {
        this.state.cancelPush = true;
        deleteLabel(this.units, label);
        console.log('cancelPush');
      } else {
        this.collectedActions.push(...await push(this.world, this.mainCombatTypes, this.supportUnitTypes));
      }
    } else if (this.state.pushMode === true) {
      this.state.pushMode = false;
      this.state.cancelPush = true;
      deleteLabel(this.units, label);
      console.log('cancelPush');
    }
  }
  scout(foodRanges, unitType, targetLocationFunction, conditions) {
    if (conditions && conditions.scoutType === 'earlyScout' && this.earlyScout === undefined) { this.earlyScout = true; }
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      const targetLocation = (this.map[targetLocationFunction] && this.map[targetLocationFunction]()) ? this.map[targetLocationFunction]().centroid : locationHelper[targetLocationFunction](this.map);
      const label = conditions && conditions.label ? conditions.label : 'scout';
      let labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      const hasOrderToTargetLocation = labelledScouts.filter(scout => scout.orders.find(order => order.targetWorldSpacePos && distance(order.targetWorldSpacePos, targetLocation) < 16)).length > 0;
      if (!hasOrderToTargetLocation) {
        if (conditions) {
          if (conditions.scoutType && !this[conditions.scoutType]) { return; }
          if (conditions.unitType) {
            if (this.units.getByType(conditions.unitType).length === conditions.unitCount) { this.setScout(unitType, label, targetLocation); }
          } else { this.setScout(unitType, label, targetLocation); }
        } else { this.setScout(unitType, label, targetLocation); }
        labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        const [scout] = labelledScouts;
        if (scout) {
          if (distance(scout.pos, targetLocation) > 16) {
            const unitCommand = {
              abilityId: MOVE,
              targetWorldSpacePos: targetLocation,
              unitTags: [scout.tag],
            }
            this.collectedActions.push(unitCommand);
            console.log('Scout sent');
            setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType),`scouting ${targetLocationFunction}`);
          }
        }
      }
    }
  }
  setScout(unitType, label, location) {
    let [unit] = this.units.getClosest(
      location,
      this.units.getById(unitType).filter(unit => {
        const condition = [
          unit.noQueue,
          unit.orders.findIndex(order => order.abilityId === MOVE) > -1,
          unit.isConstructing() && unit.unitType === PROBE,
          !unit.isWorker()
        ];
        return condition.some(condition => condition);
      })
    );
    if (!unit) { [unit] = this.units.getClosest(location, this.units.getById(unitType).filter(unit => unit.unitType === unitType && !unit.isConstructing() && unit.isGathering())); }
    if (unit) {
      console.log(unit.orders[0] && unit.orders[0].abilityId)
      unit.labels.clear();
      if (!unit.labels.get(label)) {
        unit.labels.set(label, location);
        console.log(`Set ${label}`);
      }
    }
  }
  /**
   * Collects training actions if conditions are met based on params.
   * @param {number} food
   * @param {number} unitType
   * @param {null|number} targetCount
   * @returns {Promise<void>}
   */
  async train(food, unitType, targetCount) {
    if (getFoodUsed(this.foodUsed) >= food) {
      let abilityId = this.data.getUnitTypeData(unitType).abilityId;
      if (checkUnitCount(this.world, unitType, targetCount) || targetCount === null) {
        if (canBuild(this.agent, this.world.data, unitType)) {
          const trainer = this.units.getProductionUnits(unitType).find(unit => {
            const pendingOrders = unit['pendingOrders'] ? unit['pendingOrders'] : [];
            const noQueue = unit.noQueue && pendingOrders.length === 0;
            return (
              noQueue ||
              (unit.hasReactor() && unit.orders.length + pendingOrders.length < 2)
            ) &&
              unit.abilityAvailable(abilityId);
          });
          const unitTypeData = this.data.getUnitTypeData(unitType);
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
              if (targetCount !== null) {
                planService.pausePlan = true;
              }
              return;
            }
          }
          planService.pausePlan = false;
          setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType));
          this.selectedTypeToBuild = null;
          console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`);
          addEarmark(this.data, unitTypeData);
        } else {
          if (!this.agent.canAfford(unitType)) {
            console.log(`Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.isPlanPaused);
            const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
            await balanceResources(this.world, mineralCost / vespeneCost);
          }
          if (targetCount !== null) {
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      }
    }
  }
  async upgrade(food, upgradeId) {
    if (getFoodUsed(this.foodUsed) >= food) {
      const upgradeName = getStringNameOfConstant(Upgrade, upgradeId)
      upgradeId = mismatchMappings[upgradeName] ? Upgrade[mismatchMappings[upgradeName]] : Upgrade[upgradeName];
      const upgraders = this.units.getUpgradeFacilities(upgradeId);
      const upgradeData = this.data.getUpgradeData(upgradeId);
      const { abilityId } = upgradeData;
      const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
      if (!this.agent.upgradeIds.includes(upgradeId) && foundUpgradeInProgress === undefined) {
        const upgrader = this.units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
        if (upgrader) {
          const unitCommand = { abilityId, unitTags: [upgrader.tag] };
          await actions.sendAction([unitCommand]);
          planService.pausePlan = false;
          setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), upgradeName);
          addEarmark(this.data, upgradeData);
          console.log(`Upgrading ${upgradeName}`);
        } else {
          const { mineralCost, vespeneCost } = this.data.getUpgradeData(upgradeId);
          await balanceResources(this.world, mineralCost / vespeneCost);
          planService.pausePlan = true;
          planService.continueBuild = false;
        }
      }
    }
  }

  async runPlan() {
    planService.continueBuild = true;
    planService.pendingFood = 0;
    for (let step = 0; step < planService.legacyPlan.length; step++) {
      planService.currentStep = step;
      if (planService.continueBuild) {
        const planStep = planService.legacyPlan[step];
        let targetCount = planStep[3];
        const foodTarget = planStep[0];
        let conditions;
        let unitType;
        switch (planStep[1]) {
          case 'ability':
            const abilityId = planStep[2];
            conditions = planStep[3];
            await this.ability(foodTarget, abilityId, conditions);
            break;
          case 'build':
            unitType = planStep[2];
            this.unitType = unitType;
            const enemyBuild = planStep[5];
            if (enemyBuild && this.state.enemyBuildType !== enemyBuild && !this.earlyScout) { break; }
            const candidatePositions = planStep[4] ? await getCandidatePositions(this.resources, planStep[4], unitType) : [];
            await this.build(foodTarget, unitType, targetCount, candidatePositions);
            break;
          case 'continuouslyBuild':
            const foodRanges = planStep[0];
            if (this.resourceTrigger && foodRanges.indexOf(this.foodUsed) > -1) { await continuouslyBuild(this.world, this, planStep[2], planStep[3]); } break;
          case 'harass': if (this.state.enemyBuildType === 'standard') { await harass(this.world, this.state); } break;
          case 'liftToThird': if (getFoodUsed(this.foodUsed) >= foodTarget) { await liftToThird(this.resources); break; }
          case 'maintainQueens': if (getFoodUsed(this.foodUsed) >= foodTarget) { await maintainQueens(this.resources, this.data, this.agent); } break;
          case 'manageSupply': await this.manageSupply(planStep[0]); break;
          case 'push': this.push(foodTarget); break;
          case 'scout':
            unitType = planStep[2];
            const targetLocationFunction = planStep[3];
            conditions = planStep[4];
            if (!conditions) { conditions = {}; }
            if (targetLocationFunction.includes('get')) {
              const label = targetLocationFunction.replace('get', 'scout')
              conditions.label = label;
            } else {
              conditions.label = targetLocationFunction
            }
            this.scout(foodTarget, unitType, targetLocationFunction, conditions);
            break;
          case 'train':
            unitType = planStep[2];
            try { await this.train(foodTarget, unitType, targetCount); } catch (error) { console.log(error) } break;
          case 'swapBuildings':
            conditions = planStep[2];
            if (getFoodUsed(this.foodUsed) >= foodTarget) { await swapBuildings(this.world, conditions); }
            break;
          case 'upgrade':
            const upgradeId = planStep[2];
            await this.upgrade(foodTarget, upgradeId);
            break;
        }
      } else {
        break;
      }
    }
  }
}

module.exports = AssemblePlan;