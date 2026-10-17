//@ts-check
"use strict";

/** @type {WeakMap<object, string>} */
const actionProvenance = new WeakMap();

/**
 * Associates local diagnostic provenance with an action without adding a
 * serializable protocol field.
 * @param {object} action
 * @param {string} source
 * @returns {void}
 */
function setActionProvenance(action, source) {
  actionProvenance.set(action, source);
}

/**
 * Returns the local diagnostic source associated with an action.
 * @param {object} action
 * @returns {string}
 */
function getActionProvenance(action) {
  return actionProvenance.get(action) || "unattributed";
}

module.exports = {
  getActionProvenance,
  setActionProvenance,
};
