// Import the required modules if necessary, e.g., if using in a Node.js environment
// const { Map } = require('global');

/** @type {Map<string, any>} */
const instances = new Map();

/**
 * Retrieves or creates a singleton instance of the specified class.
 * Ensures that only one instance of a class exists within the application context.
 *
 * This assumes that classes passed to this function are either instantiable with `new`
 * or have a static `getInstance` method if they follow the singleton pattern.
 *
 * @template T
 * @param {{ new (...args: any[]): T; getInstance?: (...args: any[]) => T }} Class - The class for which to retrieve/create a singleton instance.
 * @param {any[]} [constructorArgs=[]] - Arguments to pass to the class constructor if instance needs to be created.
 * @returns {T} The singleton instance of the class.
 *
 * @example
 * // Define a class
 * class ConfigManager {
 *   constructor(config) {
 *     this.config = config;
 *   }
 *   static getInstance() {
 *     if (!this.instance) {
 *       this.instance = new this({apikey: "default"});
 *     }
 *     return this.instance;
 *   }
 * }
 * 
 * // Retrieve or create a singleton instance
 * const configManager = getSingletonInstance(ConfigManager);
 * console.log(configManager.config); // Output the config
 */
function getSingletonInstance(Class, constructorArgs = []) {
  const className = Class.name;
  if (!instances.has(className)) {
    try {
      // Check if Class has a static getInstance method and call it if available
      if (typeof Class.getInstance === 'function') {
        instances.set(className, Class.getInstance(...constructorArgs));
      } else {
        instances.set(className, new Class(...constructorArgs));
      }
    } catch (error) {
      console.error(`Error creating instance of ${className}: ${error}`);
      throw error;
    }
  }
  return instances.get(className);
}

module.exports = { getSingletonInstance };
