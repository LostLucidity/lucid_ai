//@ts-check
"use strict"

const { GATEWAY, WARPGATE, NEXUS, FORGE, TWILIGHTCOUNCIL, TEMPLARARCHIVE, PYLON, PHOTONCANNON, HATCHERY, EVOLUTIONCHAMBER, HYDRALISKDEN, INFESTATIONPIT, LAIR } = require("@node-sc2/core/constants/unit-type")

const placementConfigs = {
  EVOLUTIONCHAMBER: { toBuild: EVOLUTIONCHAMBER, placement: EVOLUTIONCHAMBER, countTypes: [ EVOLUTIONCHAMBER ] },
  FORGE: { toBuild: FORGE, placement: FORGE, countTypes: [ FORGE ] },
  PYLON:  { toBuild: PYLON, placement: PYLON, countTypes: [ PYLON ] },
  GATEWAY: { toBuild: GATEWAY, placement: GATEWAY, countTypes: [ GATEWAY, WARPGATE ] },
  INFESTATIONPIT: { toBuild: INFESTATIONPIT, placement: INFESTATIONPIT, countTypes: [ INFESTATIONPIT ] },
  HATCHERY: { toBuild: HATCHERY, placement: HATCHERY, countTypes: [ HATCHERY, LAIR ] },
  HYDRALISKDEN: { toBuild: HYDRALISKDEN, placement: HYDRALISKDEN, countTypes: [ HYDRALISKDEN ] },
  NEXUS: { toBuild: NEXUS, placement: NEXUS, countTypes: [ NEXUS ] },
  PHOTONCANNON: { toBuild: PHOTONCANNON, placement: PHOTONCANNON, countTypes: [ PHOTONCANNON ] },
  TWILIGHTCOUNCIL: { toBuild: TWILIGHTCOUNCIL, placement: TWILIGHTCOUNCIL, countTypes: [ TWILIGHTCOUNCIL ] },
  TEMPLARARCHIVE: { toBuild: TEMPLARARCHIVE, placement: TEMPLARARCHIVE, countTypes: [ TEMPLARARCHIVE ] },
}

module.exports = placementConfigs;