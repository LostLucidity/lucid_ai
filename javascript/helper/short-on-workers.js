//@ts-check

function shortOnWorkers(resources) {
  const { units } = resources.get();
  let idealHarvesters = 0
  let assignedHarvesters = 0
  const townhalls = units.getBases();
    townhalls.forEach(townhall => {
      idealHarvesters += townhall.idealHarvesters
      assignedHarvesters += townhall.assignedHarvesters
    });
  return idealHarvesters >= assignedHarvesters;
}

module.exports = shortOnWorkers;