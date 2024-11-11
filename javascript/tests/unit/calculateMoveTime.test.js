// Import the function to be tested
const { UnitType } = require("@node-sc2/core/constants");

const { calculateMoveTime } = require("../../src/units/management/unitManagement");

// Mocking the Unit with all required properties to match the Unit type definition
const mockUnit = {
  unitType: UnitType.BARRACKS, // Grounded version of the unitType
  _availableAbilities: [],
  labels: new Map(),
  abilityAvailable: jest.fn(),
  availableAbilities: () => [],
  data: () => ({ movementSpeed: 0 }), // Stationary movement speed
  is: jest.fn(),
  isAttacking: () => false,
  isCloaked: () => false,
  isConstructing: () => false,
  isCombatUnit: () => false,
  isMelee: () => false,
  isEnemy: () => false,
  isFinished: () => true,
  isWorker: () => false,
  isTownhall: () => false,
  isGasMine: () => false,
  isMineralField: () => false,
  isStructure: () => false,
  isIdle: () => true,
  isCurrent: () => false,
  isHolding: () => false,
  isGathering: () => false,
  isReturning: () => false,
  isHarvesting: () => false,
  hasNoLabels: () => true,
  blink: jest.fn(),
  toggle: jest.fn(),
  canInject: jest.fn(),
  canBlink: jest.fn(),
  canMove: jest.fn(),
  hasReactor: () => false,
  hasTechLab: () => false,
  canShootGround: () => true,
  canShootUp: () => true,
  inject: jest.fn(),
  update: jest.fn(),
  burrow: jest.fn(),
  addLabel: jest.fn(),
  hasLabel: jest.fn(),
  getLabel: jest.fn(),
  removeLabel: jest.fn(),
  getLife: () => 100,
  buildProgress: 1,
  orders: [],
  pos: { x: 0, y: 0, z: 0 },
  displayType: undefined,
  addOnTag: "0",
  noQueue: true,
  health: 100,
  healthMax: 100,
  shield: 50,
  shieldMax: 50,
  energy: 50,
  energyMax: 50,
  isSelected: false,
  isFlying: false,
  cargoSpaceTaken: 0,
  cargoSpaceMax: 0,
  mineralContents: 0,
  vespeneContents: 0,
};

/**
 * Mock of DataStorage with necessary methods and structure.
 * Using `any` type to avoid strict type requirements.
 * @type {any}
 */
const mockData = {
  getUnitTypeData: jest.fn((unitType) => {
    // Return movementSpeed based on the specific unitType, grounded or flying
    if (unitType === UnitType.BARRACKS) {
      return { movementSpeed: 0 }; // Stationary speed for BARRACKS
    }
    if (unitType === UnitType.BARRACKSFLYING) {
      return { movementSpeed: 0.9375 }; // Movement speed for flying version
    }
    return { movementSpeed: undefined };
  }),
  register: jest.fn(),
  mineralCost: jest.fn(() => 0),
  getAbilityData: jest.fn(() => ({})),
  getEffectData: jest.fn(() => ({})),
  vespeneCost: jest.fn(() => 0),
  researchCost: jest.fn(() => 0),
  timeCost: jest.fn(() => 0),
  supplyCost: jest.fn(() => 0),
  getUpgradeData: jest.fn(() => ({})),
  getBuffData: jest.fn(() => ({})),
  getUnitData: jest.fn(() => ({})),
};

describe('calculateMoveTime', () => {
  it('should calculate the time accurately for the new game state', () => {
    const startPosition = { x: 88.5, y: 123.5, z: 11.9920654296875 };
    const endPosition = { x: 111.5, y: 135.5, z: 11.993120193481445 };
    const liftAndLandingTime = 2.857142857142857;

    const result = calculateMoveTime(mockUnit, startPosition, endPosition, liftAndLandingTime, /** @type {DataStorage} */(mockData));

    expect(result).toBeCloseTo(25.479804603539577, 10);
  });

  it('should return Infinity if unitType is undefined', () => {
    const unit = { ...mockUnit, unitType: undefined };
    const result = calculateMoveTime(unit, { x: 0, y: 0 }, { x: 1, y: 1 }, 2, /** @type {DataStorage} */(mockData));

    expect(result).toBe(Infinity);
  });

  it('should return Infinity if movementSpeed is undefined', () => {
    const unit = { ...mockUnit, unitType: 2 }; // UnitType 2 has no movementSpeed defined
    const result = calculateMoveTime(unit, { x: 0, y: 0 }, { x: 1, y: 1 }, 2, /** @type {DataStorage} */(mockData));

    expect(result).toBe(Infinity);
  });
});
