//@ts-check
"use strict"

// damageManager.js

let damageByTag = {};
let lastUpdatedStep = -1;  // A value that indicates it hasn't been updated yet.

/**
 * @param {string | number} tag
 * @param {any} damage
 * @param {number} currentStep
 */
function setDamageForTag(tag, damage, currentStep) {
  if (lastUpdatedStep !== currentStep) {
    resetDamageByTag();
    lastUpdatedStep = currentStep;
  }
  damageByTag[tag] = damage;
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
