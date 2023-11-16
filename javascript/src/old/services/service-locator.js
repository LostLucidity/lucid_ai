//@ts-check
"use strict";

/**
 * @fileoverview This file acts as a service locator for the application, 
 * providing a centralized point of configuration for service instantiation 
 * and dependency injection using Inversion of Control (IoC) principles.
 */

// Concrete implementations
const ArmyManagementServiceImpl = require('./army-management/army-management-service');
const RetreatManagementServiceImpl = require('./army-management/retreat-management/retreat-management-service');
const LoggingServiceImpl = require('../logging/logging-service');

/**
 * Represents a simple Inversion of Control (IoC) container.
 */
class ServiceLocator {
  constructor() {
    /** @private @type {Map<string, () => Object>} */
    this.serviceFactories = new Map();

    /** @private @type {Map<string, Object>} */
    this.serviceInstances = new Map();
  }

  /**
   * Registers a service with a factory function.
   * @param {string} name - The service name.
   * @param {() => Object} factoryFn - A factory function that returns the service instance.
   */
  register(name, factoryFn) {
    this.serviceFactories.set(name, factoryFn);
  }

  /**
   * Retrieves a service instance by name, instantiating it if necessary.
   * @param {string} name - The service name.
   * @returns {Object} The retrieved service instance.
   */
  get(name) {
    if (this.serviceInstances.has(name)) {
      return this.serviceInstances.get(name);
    }

    const factoryFn = this.serviceFactories.get(name);
    if (!factoryFn) {
      throw new Error(`Factory function for service ${name} not found.`);
    }

    // Instantiate the service
    const serviceInstance = factoryFn();
    this.serviceInstances.set(name, serviceInstance);

    return serviceInstance;
  }
}

const serviceLocator = new ServiceLocator();

// Register services with factory functions
serviceLocator.register('loggingService', () => new LoggingServiceImpl(serviceLocator.get('armyManagementService')));
serviceLocator.register('retreatManagementService', () => new RetreatManagementServiceImpl(serviceLocator.get('loggingService')));
serviceLocator.register('armyManagementService', () => new ArmyManagementServiceImpl(serviceLocator.get('retreatManagementService')));

// Export the service locator
module.exports = serviceLocator;