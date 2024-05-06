/** @type {Map<string, any>} */
const instances = new Map();

/**
 * Retrieves or creates a singleton instance of the specified class.
 * Ensures that only one instance of a class exists within the application context.
 * This function supports classes with a static getInstance method or those instantiable using `new`.
 *
 * @template T
 * @param {{ new(...args: any[]): T; getInstance?: (...args: any[]) => T }} Class - The class for which to retrieve or create a singleton instance.
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
      // Use the custom singleton handler if available, otherwise instantiate normally
      const instance = typeof Class.getInstance === 'function'
        ? Class.getInstance(...constructorArgs)
        : new Class(...constructorArgs);
      instances.set(className, instance);
    } catch (error) {
      console.error(`Error creating instance of ${className}: ${error}`);
      throw error; // Ensures the error is handled appropriately outside this function
    }
  } else if (constructorArgs.length && process.env.NODE_ENV !== 'production') {
    console.warn(`Instance of ${className} already created. Constructor arguments were ignored.`);
  }
  return instances.get(className);
}

module.exports = { getSingletonInstance };
