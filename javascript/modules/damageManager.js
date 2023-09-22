//@ts-check
"use strict"

// damageManager.js

let damageByTag = {};
let lastUpdatedStep = -1;  // A value that indicates it hasn't been updated yet.

/**
 * Sets the cumulative damage for a given unit tag and game step.
 *
 * @param {string | number} tag - The tag identifier of the unit.
 * @param {number} damage - The damage dealt to the unit.
 * @param {number} currentStep - The current game step.
 */
function setDamageForTag(tag, damage, currentStep) {
  if (lastUpdatedStep !== currentStep) {
    resetDamageByTag();
    lastUpdatedStep = currentStep;
  }

  // Accumulate damage for the tag
  if (Object.prototype.hasOwnProperty.call(damageByTag, tag)) {
    damageByTag[tag] += damage;
  } else {
    damageByTag[tag] = damage;
  }
}

/**
 * @param {string | number} tag
 * @param {number} currentStep
 */
function getDamageForTag(tag, currentStep) {
  if (lastUpdatedStep !== currentStep) {
    resetDamageByTag();
    lastUpdatedStep = currentStep;
  }
  return damageByTag[tag];
}

function resetDamageByTag() {
  damageByTag = {};
}

module.exports = {
  setDamageForTag,
  getDamageForTag,
  resetDamageByTag,
};
