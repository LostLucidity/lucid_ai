// https://lotv.spawningtool.com/build/121488/
// https://www.youtube.com/watch?v=4GM2c0aJNoM&feature=emb_title

const { createSystem, taskFunctions } = require("@node-sc2/core");

const {
  EFFECT_CHRONOBOOSTENERGYCOST: CHRONOBOOST,
  HALLUCINATION_PHOENIX
} = require('@node-sc2/core/constants/ability');
const {
  ADEPT,
  ASSIMILATOR,
  COLOSSUS,
  CYBERNETICSCORE,
  FORGE,
  GATEWAY,
  NEXUS,
  OBSERVER,
  PYLON,
  ROBOTICSBAY,
  ROBOTICSFACILITY,
  SENTRY,
  SHIELDBATTERY,
  STALKER,
  TWILIGHTCOUNCIL,
  ZEALOT
} = require("@node-sc2/core/constants/unit-type");
const {
  EXTENDEDTHERMALLANCE,
  RESEARCH_PROTOSSGROUNDWEAPONSLEVEL1,
  WARPGATERESEARCH
} = require('@node-sc2/core/constants/upgrade');

const { ability, build, train, upgrade } = taskFunctions;

const macroColossus = createSystem({
  name: 'macroColossus',
  type: 'build',
  buildOrder: [
    [14, build(PYLON, 2)],
    [15, build(GATEWAY)],
    [16, build(ASSIMILATOR)],
    [19, build(NEXUS)],
    [19, build(CYBERNETICSCORE)],
    [19, build(ASSIMILATOR)],
    [21, build(PYLON)],
    [22, train(ADEPT)], // chronoboost
    [24, ability(CHRONOBOOST, { target: GATEWAY })],
    [24, upgrade(WARPGATERESEARCH)],
    [25, train(STALKER)], // chronoboost
    [25, ability(CHRONOBOOST, { target: GATEWAY })],
    [29, build(ROBOTICSFACILITY)],
    [29, train(SENTRY)], // chronoboost
    [29, ability(CHRONOBOOST, { target: GATEWAY })],
    [37, train(STALKER)],
    [40, build(GATEWAY)],
    [41, build(GATEWAY)],
    [42, train(OBSERVER)],
    [42, build(PYLON)],
    [45, build(PYLON)],
    [45, build(ASSIMILATOR, 2)],
    [45, ability(HALLUCINATION_PHOENIX)],
    [47, build(OBSERVER)],
    [47, train(STALKER)],
    [54, build(ROBOTICSBAY)],
    [57, build(NEXUS)],
    [60, build(SHIELDBATTERY)],
    [60, train(COLOSSUS)], // chronoboost
    [60, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [62, build(FORGE)],
    [69, upgrade(EXTENDEDTHERMALLANCE)],
    [69, train(STALKER)],
    [72, train(STALKER)],
    [76, build(RESEARCH_PROTOSSGROUNDWEAPONSLEVEL1, { target: FORGE })],
    [78, build(TWILIGHTCOUNCIL)],
    [78, build(SHIELDBATTERY)],
    [78, train(OBSERVER)],
    [79, train(COLOSSUS)], // chronoboost
    [79, ability(CHRONOBOOST, { target: ROBOTICSFACILITY })],
    [85, train(SENTRY, 2)], // chronoboost
    [85, build(ZEALOT)],
    // [95, build(Charge (Chrono Boost))],
    // [97, build(Gateway x2)],
    // [97, build(Gateway x2)],
    // [97, build(Gateway)],
    // [97, build(Colossus)],
    // [106, build(Assimilator x2)],
    // [106, build(Templar Archives)],
    // [106, build(Zealot x3)],
    // [112, build(Zealot x3)],
    // [112, build(Photon Cannon)],
    // [119, build(Protoss Ground Weapons Level 2 (Chrono Boost))],
    // [119, build(Blink (Chrono Boost))],
    // [119, build(Zealot x3)],
    // [129, build(Disruptor)],
    // [142, build(High Templar)],
    // [142, build(Warp Prism)],
    // [136, build(High Templar)],
    // [142, build(Gateway, Nexus)],
    // [142, build(Forge)],
    // [142, build(Archon)],
    // [143, build(Disruptor (Chrono Boost))],
    // [143, build(Stalker x4)],
    // [151, build(Protoss Ground Armor Level 1 (Chrono Boost))],
    // [151, build(Disruptor (Chrono Boost))],
    // [168, build(High Templar x6)],
    // [168, build(Archon x3)],
    // [180, build(Assimilator)],
    // [180, build(Dark Shrine)],
    // [180, build(Warp Prism)],
  ],
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker()) {
      const { actions } = resources.get();
      return actions.gather(idleUnit);
    }
  },
  async onUnitCreated({ resources }, newUnit) {
    const { actions, map } = resources.get();

    if (newUnit.isWorker()) {
        return actions.gather(newUnit);
    }
},
  async onUnitFinished({ resources }, newBuilding) {
    if (newBuilding.isGasMine()) {
      const { units, actions } = resources.get();
      const threeWorkers = units.getClosest(newBuilding.pos, units.getMineralWorkers(), 3);
      threeWorkers.forEach(worker => worker.labels.set('gasWorker', true));
      return actions.mine(threeWorkers, newBuilding);
    }
  },
});

module.exports = macroColossus;