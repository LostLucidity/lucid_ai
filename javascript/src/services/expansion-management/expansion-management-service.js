//@ts-check
"use strict";

class ExpansionManagementService {
  /** @type {Expansion[]} */
  availableExpansions = [];

  /**
   * Retrieve all available expansions.
   * @returns {Expansion[]}
   */
  getAvailableExpansions() {
    return this.availableExpansions;
  }

  /**
   * Set available expansions.
   * @param {Expansion[]} expansions
   */
  setAvailableExpansions(expansions) {
    this.availableExpansions = expansions;
  }  
}

const expansionManagementService = new ExpansionManagementService();
module.exports = expansionManagementService;