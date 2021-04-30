//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { CANCEL_BUILDINPROGRESS } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const AssemblePlan = require("../helper/assemblePlan");
const { gatherOrMine } = require("../systems/balance-resources");
const plans = require("./plans");

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
    const { frame } = world.resources.get();
    console.log('frame.getGameInfo().playerInfo', frame.getGameInfo().playerInfo);
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
        actions.sendAction(unitCommand);
      }
    }
    await assemblePlan.onUnitDamaged(resources, damagedUnit)
  },
  async onUnitDestroyed({}, destroyedUnit) {
    await assemblePlan.onUnitDestroyed(destroyedUnit);
  },
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker() && idleUnit.noQueue) {
      const { units } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        await gatherOrMine(resources, idleUnit);
      }
    }
  },
  getBuild(race) {
    const racePlans = plans[race];
    var keys = Object.keys(racePlans);
    const selectedBuild = racePlans[keys[ keys.length * Math.random() << 0]];
    if (selectedBuild.buildType === 'two variable') {
      return this.convertBuild(selectedBuild);
    } else {
      return selectedBuild;
    }
  },
  convertBuild(build) {
    const convertedBuild = [];
    build.forEach(order => {
      const convertedBuild = []
      const actions = order[1].split(',').map(item => item.replace(' ','').toUpperCase())
      actions.forEach(action => {

      });
      convertedBuild.push([
        order[0],
        UnitType[order[1].replace(' ','').toUpperCase()],
      ]);
    })
    return convertedBuild;
  }
});

module.exports = entry;