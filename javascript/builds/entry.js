//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { CANCEL_BUILDINPROGRESS } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const AssemblePlan = require("../helper/assemble-plan");
const { convertPlan } = require("../systems/salt-converter/salt-converter");
const { gatherOrMine } = require("../systems/manage-resources");
const plans = require("./plans");
const sharedService = require("../services/shared-service");

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
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    assemblePlan.onEnemyFirstSeen(seenEnemyUnit);
  },
  async onGameStart(world) {
    const { map, frame } = world.resources.get();
    console.log('frame.getGameInfo().playerInfo', frame.getGameInfo().playerInfo);
    console.log('Natural Wall:', !!map.getNatural().getWall());
    // get race.
    const race = world.agent.race;
    // get build
    // const plan = plans[race]['economicStalkerColossi'];
    const plan = this.getBuild(race);
    // load build
    assemblePlan = new AssemblePlan(plan);
    assemblePlan.onGameStart(world);
  },
  async onStep(world) {
    const { units } = world.resources.get();
    sharedService.removePendingOrders(units);
    const t0 = new Date().getTime();
    await assemblePlan.onStep(world, this.state);
    const t1 = new Date().getTime();
    longestTime = (t1 - t0) > longestTime ? t1 - t0 : longestTime;
  },
  async onUnitCreated(world, createdUnit) {
    await assemblePlan.onUnitCreated(world, createdUnit);
  },
  async onUnitDamaged({ resources }, damagedUnit) {
    const { actions } = resources.get();
    const totalHealthShield = damagedUnit.health + damagedUnit.shield;
    const maxHealthShield = damagedUnit.healthMax + damagedUnit.shieldMax;
    if ((totalHealthShield / maxHealthShield) < 1/3) {
      if (damagedUnit.isStructure() && damagedUnit.buildProgress < 1) {
        const unitCommand = {
          abilityId: CANCEL_BUILDINPROGRESS,
          unitTags: [ damagedUnit.tag ],
        };
        await actions.sendAction(unitCommand);
      }
    }
    await assemblePlan.onUnitDamaged(resources, damagedUnit)
  },
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker() && idleUnit.noQueue) {
      const { units } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) { await gatherOrMine(resources, idleUnit); }
    }
  },
  getBuild(race) {
    const racePlans = plans[race];
    var keys = Object.keys(racePlans);
    const selectedPlan = racePlans[keys[ keys.length * Math.random() << 0]];
    if (selectedPlan.buildType === 'two variable') {
      return convertPlan(selectedPlan);
    } else {
      return selectedPlan;
    }
  },
});

module.exports = entry;