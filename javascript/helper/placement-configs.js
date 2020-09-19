//@ts-check
"use strict"

const { GATEWAY, WARPGATE, NEXUS, FORGE, TWILIGHTCOUNCIL, TEMPLARARCHIVE, PYLON, PHOTONCANNON, HATCHERY, EVOLUTIONCHAMBER, HYDRALISKDEN, INFESTATIONPIT, LAIR, ARMORY, MISSILETURRET, BARRACKS, BARRACKSREACTOR, ENGINEERINGBAY, BARRACKSFLYING, COMMANDCENTER, COMMANDCENTERFLYING, ORBITALCOMMAND, ORBITALCOMMANDFLYING, SUPPLYDEPOT, ASSIMILATOR, CYBERNETICSCORE, STARGATE, SHIELDBATTERY } = require("@node-sc2/core/constants/unit-type")

const placementConfigs = {
  ARMORY: { toBuild: ARMORY, placement: ARMORY, countTypes: [ ARMORY ] },
  ASSIMILATOR: { toBuild: ASSIMILATOR, placement: ASSIMILATOR, countTypes: [ ASSIMILATOR ] },
  BARRACKS: { toBuild: BARRACKS, placement: BARRACKS, countTypes: [ BARRACKS, BARRACKSFLYING ] },
  BARRACKSREACTOR: { toBuild: BARRACKS, placement: BARRACKSREACTOR, countTypes: [ BARRACKS, BARRACKSFLYING ] },
  COMMANDCENTER: { toBuild: COMMANDCENTER, placement: COMMANDCENTER, countTypes: [ COMMANDCENTER, COMMANDCENTERFLYING, ORBITALCOMMAND, ORBITALCOMMANDFLYING ] },
  CYBERNETICSCORE: { toBuild: CYBERNETICSCORE, placement: CYBERNETICSCORE, countTypes: [ CYBERNETICSCORE ] },
  ENGINEERINGBAY: { toBuild: ENGINEERINGBAY, placement: ENGINEERINGBAY, countTypes: [ ENGINEERINGBAY ] },
  EVOLUTIONCHAMBER: { toBuild: EVOLUTIONCHAMBER, placement: EVOLUTIONCHAMBER, countTypes: [ EVOLUTIONCHAMBER ] },
  FORGE: { toBuild: FORGE, placement: FORGE, countTypes: [ FORGE ] },
  PYLON:  { toBuild: PYLON, placement: PYLON, countTypes: [ PYLON ] },
  GATEWAY: { toBuild: GATEWAY, placement: GATEWAY, countTypes: [ GATEWAY, WARPGATE ] },
  INFESTATIONPIT: { toBuild: INFESTATIONPIT, placement: INFESTATIONPIT, countTypes: [ INFESTATIONPIT ] },
  HATCHERY: { toBuild: HATCHERY, placement: HATCHERY, countTypes: [ HATCHERY, LAIR ] },
  MISSILETURRET: { toBuild: MISSILETURRET, placement: MISSILETURRET, countTypes: [ MISSILETURRET ] },
  HYDRALISKDEN: { toBuild: HYDRALISKDEN, placement: HYDRALISKDEN, countTypes: [ HYDRALISKDEN ] },
  NEXUS: { toBuild: NEXUS, placement: NEXUS, countTypes: [ NEXUS ] },
  PHOTONCANNON: { toBuild: PHOTONCANNON, placement: PHOTONCANNON, countTypes: [ PHOTONCANNON ] },
  SHIELDBATTERY: { toBuild: SHIELDBATTERY, placement: SHIELDBATTERY, countTypes: [ SHIELDBATTERY ] },
  STARGATE: { toBuild: STARGATE, placement: STARGATE, countTypes: [ STARGATE ] },
  SUPPLYDEPOT: { toBuild: SUPPLYDEPOT, placement: SUPPLYDEPOT, countTypes: [ SUPPLYDEPOT ] },
  TWILIGHTCOUNCIL: { toBuild: TWILIGHTCOUNCIL, placement: TWILIGHTCOUNCIL, countTypes: [ TWILIGHTCOUNCIL ] },
  TEMPLARARCHIVE: { toBuild: TEMPLARARCHIVE, placement: TEMPLARARCHIVE, countTypes: [ TEMPLARARCHIVE ] },
}

module.exports = placementConfigs;