//@ts-check

function shortOnWorkers(resources) {
  const { units } = resources.get();
  let idealHarvesters = 0
  let assignedHarvesters = 0
  const townhalls = units.getBases();
  townhalls.forEach(townhall => {
    idealHarvesters += townhall.idealHarvesters;
    assignedHarvesters += townhall.assignedHarvesters;
    if (townhall.buildProgress < 1) { idealHarvesters += 3; }
  });
  return idealHarvesters >= assignedHarvesters;
}

module.exports = shortOnWorkers;