//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { CANCEL_BUILDINPROGRESS } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const AssemblePlan = require("../helper/assemble-plan");
const { convertPlan } = require("../systems/salt-converter/salt-converter");
const { gatherOrMine } = require("../systems/manage-resources");
const plans = require("./plans");
const wallOffNaturalService = require("../systems/wall-off-natural/wall-off-natural-service");
const { setUnitTypeTrainingAbilityMapping } = require("../services/data-service");
const { getPendingOrders } = require("../services/unit-service");
const { PYLON } = require("@node-sc2/core/constants/unit-type");
const { clearUnsettledBuildingPositions } = require("../services/world-service");
const scoutingService = require("../systems/scouting/scouting-service");
const { setOpponentRace } = require("../systems/scouting/scouting-service");

let assemblePlan = null;
let longestTime = 0;

const entry = createSystem({
  name: 'main',
  type: 'agent',
  defaultOptions: {
    state: {
      defenseMode: false,
      defenseLocation: null,
      enemyBuildType: 'standard',
      cancelPush: false,
      pushMode: false,
    },
  },
  async onEnemyFirstSeen(_world, seenEnemyUnit) {
    setOpponentRace(seenEnemyUnit);
  },
  async onGameStart(world) {
    const { agent, data, resources } = world;
    const { race, opponent } = agent;
    const { map, frame } = resources.get();
    console.log('frame.getGameInfo().playerInfo', frame.getGameInfo().playerInfo);
    console.log('Natural Wall:', !!map.getNatural().getWall());
    console.log('Backup Wall', wallOffNaturalService.wall.length > 0);
    // get build
    // const plan = plans[race]['economicStalkerColossi'];
    const plan = this.getBuild(race);
    // load build
    assemblePlan = new AssemblePlan(plan);
    scoutingService.opponentRace = opponent ? opponent.race : undefined;
    setUnitTypeTrainingAbilityMapping(data);
    await assemblePlan.runPlan(world);
  },
  async onStep(world) {
    const t0 = new Date().getTime();
    await assemblePlan.onStep(world, this.state);
    const t1 = new Date().getTime();
    longestTime = (t1 - t0) > longestTime ? t1 - t0 : longestTime;
  },
  async onUnitCreated(world, createdUnit) {
    await assemblePlan.onUnitCreated(world, createdUnit);
  },
  async onUnitDamaged({ resources }, damagedUnit) {
    const { health, healthMax, shield, shieldMax } = damagedUnit; if (health === undefined || healthMax === undefined || shield === undefined || shieldMax === undefined) return;
    const { buildProgress, pos } = damagedUnit; if (buildProgress === undefined || pos === undefined) return;
    const { actions } = resources.get();
    const totalHealthShield = health + shield;
    const maxHealthShield = healthMax + shieldMax;
    if ((totalHealthShield / maxHealthShield) < 1 / 3) {
      if (damagedUnit.isStructure() && buildProgress < 1) {
        const unitCommand = {
          abilityId: CANCEL_BUILDINPROGRESS,
          unitTags: [damagedUnit.tag],
        };
        await actions.sendAction(unitCommand);
      }
    }
  },
  async onUnitFinished(world, finishedUnit) {
    const { resources } = world;
    const { units } = resources.get();
    if (finishedUnit.unitType === PYLON) {
      if (units.getById(PYLON).length > 1) {
        clearUnsettledBuildingPositions(world);
      }
    }
  },
  /**
   * 
   * @param {World} param0 
   * @param {Unit} idleUnit 
   * @returns {Promise<SC2APIProtocol.ResponseAction|void>}
   */
  async onUnitIdle(world, idleUnit) {
    const { resources } = world;
    const pendingOrders = getPendingOrders(idleUnit);
    if (idleUnit.isWorker() && idleUnit.noQueue && pendingOrders.length === 0) {
      const { actions, units } = resources.get();
      const unitCommands = gatherOrMine(resources, idleUnit);
      if (units.getBases(Alliance.SELF).length > 0 && unitCommands.length > 0) {
        return actions.sendAction(unitCommands);
      }
    }
    // delete combatPoint label if idle
    if (idleUnit.labels.has('combatPoint')) {
      idleUnit.labels.delete('combatPoint');
    }
    if (idleUnit.isStructure()) {
      await assemblePlan.runPlan(world);
    }
  },
  /**
   * @param {Race} race 
   * @returns {any}
   */
  getBuild(race) {
    const racePlans = plans[race];
    var keys = Object.keys(racePlans);
    const selectedPlan = racePlans[keys[keys.length * Math.random() << 0]];
    if (selectedPlan.buildType === 'two variable') {
      return convertPlan(selectedPlan, race);
    } else {
      return selectedPlan;
    }
  },
});

module.exports = entry;