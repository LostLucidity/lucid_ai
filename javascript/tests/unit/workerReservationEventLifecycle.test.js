let bot;
let workerService;

beforeEach(() => {
  jest.resetModules();
  jest.doMock("../../src/runtime/nodeSc2Core", () => ({
    createAgent: blueprint => blueprint,
    createEngine: () => ({}),
    createPlayer: () => ({}),
  }));
  jest.isolateModules(() => {
    bot = require("../../src/starcraftBot");
    workerService = require("../../src/gameLogic/economy/workerService");
  });
});

afterEach(() => {
  jest.dontMock("../../src/runtime/nodeSc2Core");
});

function reserveWorker(tag, position = { x: 24, y: 42 }) {
  const worker = {
    isConstructing: jest.fn(() => false),
    isWorker: jest.fn(() => true),
    tag,
  };
  workerService.reserveWorkerForBuilding(worker, position);
  return { position, worker };
}

describe("worker reservation event lifecycle", () => {
  it("releases a reserved worker when it is destroyed", async () => {
    const { worker } = reserveWorker("destroyed-worker");

    await bot.onUnitDestroyed({}, worker);

    expect(workerService.isWorkerReservedForBuilding(worker)).toBe(false);
  });

  it("releases a reserved worker when it becomes idle", async () => {
    const { worker } = reserveWorker("idle-worker");

    await bot.onUnitIdle({}, worker);

    expect(workerService.isWorkerReservedForBuilding(worker)).toBe(false);
  });

  it("releases the reserved worker when its structure finishes", async () => {
    const { position, worker } = reserveWorker("completed-worker");
    const structure = {
      isStructure: jest.fn(() => true),
      pos: position,
    };
    const world = {
      resources: {
        get: () => ({ units: { getByTag: tag => tag === worker.tag ? worker : undefined } }),
      },
    };

    await bot.onUnitFinished(world, structure);

    expect(workerService.isWorkerReservedForBuilding(worker)).toBe(false);
  });
});
