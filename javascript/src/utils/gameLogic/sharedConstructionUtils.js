// sharedConstructionUtils.js

// Import necessary dependencies and constants
const { logMessageStorage } = require("./loggingUtils");

function logNoFreeGeysers() {
  if (!logMessageStorage.noFreeGeysers) {
    console.error('No free geysers available for gas collector');
    logMessageStorage.noFreeGeysers = true;
  } else {
    logMessageStorage.noFreeGeysers = false;
  }
}

// Export the shared functionalities
module.exports = {
  logNoFreeGeysers,
};
