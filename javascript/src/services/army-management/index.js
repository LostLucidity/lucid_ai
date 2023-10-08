// Existing import of the armyManagementService
const armyManagementService = require('./army-management-service');

// Export both the armyManagementService and the instantiated infoRetrievalService
module.exports = {
  armyManagementService,
};