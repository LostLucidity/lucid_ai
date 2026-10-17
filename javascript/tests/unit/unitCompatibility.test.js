const { Ability } = require("@node-sc2/core/constants");

const { isAttacking, isHarvesting } = require("../../src/utils/unitCompatibility");

describe("node-sc2 unit compatibility", () => {
  describe("isAttacking", () => {
    it.each([
      Ability.ATTACK,
      Ability.ATTACK_ATTACK,
    ])("recognizes attack order %s", abilityId => {
      expect(isAttacking({ orders: [{ abilityId }] })).toBe(true);
    });

    it("rejects missing and unrelated orders", () => {
      expect(isAttacking({})).toBe(false);
      expect(isAttacking({ orders: [{ abilityId: Ability.MOVE }] })).toBe(false);
    });
  });

  describe("isHarvesting", () => {
    it("recognizes gathering and returning units", () => {
      expect(isHarvesting({
        isGathering: () => true,
        isReturning: () => false,
      })).toBe(true);
      expect(isHarvesting({
        isGathering: () => false,
        isReturning: () => true,
      })).toBe(true);
    });

    it("rejects units with neither harvesting order", () => {
      expect(isHarvesting({
        isGathering: () => false,
        isReturning: () => false,
      })).toBe(false);
    });
  });
});
