# Core Module

This directory contains core utilities and foundational logic that support the main functionalities of the project. Each file here has a specific role and purpose, which contributes to a modular and maintainable codebase.

## Files Overview

- **addonUtils.js**  
  Provides utility functions for handling add-ons in the game environment, such as managing add-on buildings and related behaviors.

- **builderUtils.js**  
  Contains functions related to constructing and managing structures within the game, supporting efficient building logic.

- **buildingUtils.js**  
  General utilities for handling various aspects of building construction and management.

- **buildUtils.js**  
  Utilities focused on building management, including shared functions to support building operations across modules.

- **cache.js**  
  Implements caching strategies to optimize data retrieval and reduce redundant computations.

- **common.js**  
  A collection of general-purpose utilities used across different game modules, including helper functions for common tasks.

- **commonUnitUtils.js**  
  Contains reusable functions specifically for managing unit behaviors and interactions, applicable across various unit types.

- **constants.js**  
  Defines global constants for the project, centralizing key values and reducing hardcoded elements.

- **earmarkManager.js**  
  Manages earmarks or reserved resources, supporting efficient resource allocation and utilization.

- **gameData.js**  
  Handles data related to game states, properties, and entities, providing a central place for managing game data.

- **globalTypes.js**  
  Provides type definitions and global types used across core modules, ensuring type consistency throughout the codebase.

- **logger.js & logging.js**  
  Implements logging functions to track application behavior, errors, and other relevant events for debugging and monitoring.

- **pathfindingCore.js**  
  Core pathfinding functions and utilities for navigating game units and determining optimal paths.

- **resourceEarmarkManager.js**  
  Manages earmarked resources specifically for the game’s resource economy, ensuring resources are reserved appropriately.

- **strategyUtils.js**  
  Contains strategy-related utilities for managing game actions, AI behavior, and higher-level strategic decisions.

- **upgradeUtils.js**  
  Utilities for handling unit and building upgrades, supporting the implementation of upgrade paths and actions.

Each file in this directory supports core functionalities, making it easier to maintain and enhance the project by encapsulating key logic in reusable modules.
