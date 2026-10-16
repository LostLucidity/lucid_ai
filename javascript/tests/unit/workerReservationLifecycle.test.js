const {
  getWorkerReservedForPosition,
  isWorkerReservedForBuilding,
  releaseWorkerFromBuilding,
  reserveWorkerForBuilding,
} = require("../../src/gameLogic/economy/workerService");

describe("worker building reservation lifecycle", () => {
  const worker = { tag: "reservation-lifecycle-probe" };
  const position = { x: 24, y: 42 };

  afterEach(() => {
    releaseWorkerFromBuilding(worker);
  });

  it("releases both worker and position reservations", () => {
    reserveWorkerForBuilding(worker, position);

    expect(isWorkerReservedForBuilding(worker)).toBe(true);
    expect(getWorkerReservedForPosition(position)).toBe(worker.tag);

    releaseWorkerFromBuilding(worker);

    expect(isWorkerReservedForBuilding(worker)).toBe(false);
    expect(getWorkerReservedForPosition(position)).toBeUndefined();
  });
});
