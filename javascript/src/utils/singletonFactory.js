// singletonFactory.js

/**
 * @template T
 * @typedef {new (...args: any[]) => T} Constructor
 */

/** @type {Map<string, any>} */
const instances = new Map();

/**
 * Retrieves or creates a singleton instance of the specified class.
 * @template T
 * @param {Constructor<T>} Class - The class for which to retrieve/create a singleton instance.
 * @param {any[]} [constructorArgs=[]] - Arguments to pass to the class constructor.
 * @returns {T} The singleton instance of the class.
 */
function getSingletonInstance(Class, constructorArgs = []) {
  const className = Class.name;
  if (!instances.has(className)) {
    instances.set(className, new Class(...constructorArgs)); // Spread operator for constructor arguments
  }
  return instances.get(className);
}

module.exports = { getSingletonInstance };
