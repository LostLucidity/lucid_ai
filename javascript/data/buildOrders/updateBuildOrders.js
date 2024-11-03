const fs = require('fs').promises;
const path = require('path');

const { interpretBuildOrderAction } = require('./buildOrderUtils');

// Directory containing the build order files
const buildOrderDir = path.join(__dirname, '../buildOrders'); // Root build order directory

/**
 * Recursively reads all files in subdirectories asynchronously.
 * @param {string} dir - The directory path to read files from.
 * @returns {Promise<string[]>} A promise that resolves to an array of file paths.
 */
async function getAllBuildOrderFiles(dir) {
  const files = [];

  const subDirs = await fs.readdir(dir);
  for (const subDir of subDirs) {
    const subDirPath = path.join(dir, subDir);
    const stat = await fs.lstat(subDirPath);

    if (stat.isDirectory()) {
      const subDirFiles = await fs.readdir(subDirPath);
      for (const file of subDirFiles) {
        files.push(path.join(subDirPath, file));
      }
    }
  }
  return files;
}

/**
 * Processes and updates build orders with interpreted actions asynchronously.
 */
async function updateBuildOrders() {
  const files = await getAllBuildOrderFiles(buildOrderDir);

  for (const filePath of files) {
    const buildOrder = require(filePath);

    console.log(`Processing build order: ${buildOrder.title}`);

    buildOrder.steps.forEach((/** @type {{ action: string, comment: string, interpretedAction: Array<import('../../src/core/globalTypes').InterpretedAction> }} */ step) => {
      const { action, comment } = step;
      step.interpretedAction = interpretBuildOrderAction(action, comment);
    });

    await fs.writeFile(filePath, `module.exports = ${JSON.stringify(buildOrder, null, 2)};\n`, 'utf8');
    console.log(`Updated build order saved: ${path.basename(filePath)}`);
  }
  console.log('All build orders have been updated.');
}

// Run the update
updateBuildOrders().catch((error) => {
  console.error('Error updating build orders:', error);
});
