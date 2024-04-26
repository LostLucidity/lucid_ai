// Import the required modules if necessary, e.g., if using in a Node.js environment
// const { Map } = require('global');

/** @type {Map<string, any>} */
const instances = new Map();

/**
 * Retrieves or creates a singleton instance of the specified class.
 * Ensures that only one instance of a class exists within the application context.
 *
 * @template T
 * @param {new (...args: any[]) => T} Class - The class for which to retrieve/create a singleton instance.
 * @param {any[]} [constructorArgs=[]] - Arguments to pass to the class constructor if instance needs to be created.
 * @returns {T} The singleton instance of the class.
 * 
 * @example
 * // Define a class
 * class ConfigManager {
 *   constructor(config) {
 *     this.config = config;
 *   }
 * }
 * 
 * // Retrieve or create a singleton instance
 * const configManager = getSingletonInstance(ConfigManager, [{ apikey: "12345" }]);
 * console.log(configManager.config); // Output the config
 */
function getSingletonInstance(Class, constructorArgs = []) {
  const className = Class.name;
  if (!instances.has(className)) {
    try {
      instances.set(className, new Class(...constructorArgs));
    } catch (error) {
      console.error(`Error creating instance of ${className}: ${error}`);
      throw error;
    }
  }
  return instances.get(className);
}

module.exports = { getSingletonInstance };
