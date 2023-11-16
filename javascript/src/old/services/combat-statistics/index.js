// Import functionalities from combat-statistics-service.js
const combatStatisticsService = require('./combat-statistics-service');


// Export the functionalities to be accessible to other parts of the application
module.exports = {
  ...combatStatisticsService,
};