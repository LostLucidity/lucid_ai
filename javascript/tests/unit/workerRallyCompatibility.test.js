const { Ability, UnitType } = require("@node-sc2/core/constants");

jest.mock("../../src/services/sharedServices", () => ({
  getPendingOrders: jest.fn(() => []),
}));

jest.mock("../../src/utils/coreUtils", () => ({
  getWorkerSourceByPath: jest.fn(),
}));

jest.mock("../../src/utils/resourceUtils", () => ({
  getNeediestMineralField: jest.fn((_units, mineralFields) => mineralFields[0]),
}));

const { RALLY_WORKER_ABILITIES } = require("../../src/core/constants");
const { rallyWorkerToTarget } = require("../../src/gameLogic/economy/workerService");
const { getWorkerSourceByPath } = require("../../src/utils/coreUtils");

describe("worker rally node-sc2 compatibility", () => {
  it("owns a defined worker-rally ability list outside dependency groups", () => {
    expect(RALLY_WORKER_ABILITIES).toEqual([
      Ability.RALLY_WORKERS,
      Ability.RALLY_COMMANDCENTER,
      Ability.RALLY_HATCHERY_WORKERS,
      Ability.RALLY_NEXUS,
    ]);
    expect(RALLY_WORKER_ABILITIES.every(Number.isInteger)).toBe(true);
  });

  it("rallies a Nexus worker source through the installed generic ability", () => {
    const nexus = {
      abilityAvailable: jest.fn(ability => ability === Ability.RALLY_WORKERS),
      orders: [],
      pos: { x: 10, y: 10 },
      tag: "nexus-1",
      unitType: UnitType.NEXUS,
    };
    const mineralField = {
      pos: { x: 11, y: 10 },
      tag: "mineral-1",
    };
    const units = {
      getMineralFields: () => [mineralField],
    };
    const world = {
      data: {},
      resources: { get: () => ({ units }) },
    };
    getWorkerSourceByPath.mockReturnValue(nexus);

    expect(rallyWorkerToTarget(world, { x: 12, y: 10 }, units => units)).toEqual([{
      abilityId: Ability.SMART,
      queueCommand: false,
      targetUnitTag: "mineral-1",
      unitTags: ["nexus-1"],
    }]);
    expect(nexus.abilityAvailable).toHaveBeenCalledWith(Ability.RALLY_WORKERS);
  });
});
