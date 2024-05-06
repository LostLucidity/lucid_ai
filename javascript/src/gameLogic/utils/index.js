const economy = require("./economy");
const gameMechanics = require("./gameMechanics");
const scoutingUtils = require("./scouting/scoutingUtils");
const shared = require("./shared");

module.exports = {
  economy,
  gameMechanics,
  scouting: scoutingUtils,
  shared
};
