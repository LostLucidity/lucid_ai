const fs = require('fs').promises;
const path = require('path');

const { interpretBuildOrderAction } = require('./buildOrderUtils');

const buildOrderDir = path.join(__dirname, '../');

/**
 * Recursively reads all JavaScript files in subdirectories asynchronously.
 * @param {string} dir - The directory path to read files from.
 * @returns {Promise<string[]>} A promise that resolves to an array of JavaScript file paths.
 */
async function getAllBuildOrderFiles(dir) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...await getAllBuildOrderFiles(itemPath));
    } else if (item.isFile() && item.name.endsWith('.js')) {
      files.push(itemPath);
    }
  }

  return files;
}

/**
 * Validates the structure of a build order.
 * @param {object} buildOrder - The build order object to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidBuildOrder(buildOrder) {
  return (
    buildOrder &&
    typeof buildOrder === 'object' &&
    'steps' in buildOrder &&
    Array.isArray(buildOrder.steps) &&
    buildOrder.steps.every(
      step => step && typeof step.action === 'string' && typeof step.comment === 'string'
    )
  );
}

/**
 * Processes and updates build orders with interpreted actions asynchronously.
 */
async function updateBuildOrders() {
  const files = await getAllBuildOrderFiles(buildOrderDir);

  for (const filePath of files) {
    try {
      const buildOrder = require(filePath);

      if (!isValidBuildOrder(buildOrder)) {
        console.warn(`Skipping file ${filePath}: Invalid build order format`);
        continue;
      }

      console.log(`Processing build order: ${buildOrder.title || path.basename(filePath)}`);

      buildOrder.steps.forEach((/** @type {{ action: string, comment: string, interpretedAction: Array<import('../../../src/core/globalTypes').InterpretedAction> }} */ step) => {
        const { action, comment } = step;
        step.interpretedAction = interpretBuildOrderAction(action, comment);
      });

      await fs.writeFile(filePath, `module.exports = ${JSON.stringify(buildOrder, null, 2)};\n`, 'utf8');
      console.log(`Updated build order saved: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }

  console.log('All build orders have been updated.');
}

// Run the update
updateBuildOrders().catch((error) => {
  console.error('Error updating build orders:', error);
});
