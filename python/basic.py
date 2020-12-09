import random

from sc2.constants import AbilityId, BuffId, abilityid_to_unittypeid
from sc2.data import Race
from sc2.ids.unit_typeid import UnitTypeId
from sc2.position import Point2

from helper import select_random_point, short_on_workers, calculate_building_amount, train_or_research, get_closest_unit, try_placement_ranges

def should_build_workers(self):
  return True if short_on_workers(self) and self.minerals < 1024 else False
  
async def build_worker(self):
  collectedActions = []
  idle_townhalls = self.townhalls.idle
  if (idle_townhalls):
    units_abilities = await self.get_available_abilities(idle_townhalls)
    for index, abilities in enumerate(units_abilities):
      ability = AbilityId.NEXUSTRAIN_PROBE
      if ability in abilities:
        collectedActions.append(idle_townhalls[index](ability))
        self.build_order.append({'supply': self.supply_used, 'time':  self.time, 'unit':  abilityid_to_unittypeid[ability].value})
      ability = AbilityId.COMMANDCENTERTRAIN_SCV
      if ability in abilities:
        collectedActions.append(idle_townhalls[index](ability))
        self.build_order.append({'supply': self.supply_used, 'time':  self.time, 'unit':  abilityid_to_unittypeid[ability].value})
  if self.larva:
    units_abilities = await self.get_available_abilities(self.larva)
    for index, abilities in enumerate(units_abilities):
      ability = AbilityId.LARVATRAIN_DRONE
      if ability in abilities:
        collectedActions.append(self.larva[index](ability))
        self.build_order.append({'supply': self.supply_used, 'time': self.time, 'unit': abilityid_to_unittypeid[ability].value})
  return collectedActions

async def build_supply(self):
  collectedActions = []
  idle_townhalls = self.townhalls.idle
  if (idle_townhalls):
    random_townhall = random.choice(idle_townhalls)
    if self.workers:
      abilities = random.choice(self.workers).abilities
      if AbilityId.PROTOSSBUILD_PYLON in abilities:
        return await build_structure(self, UnitTypeId.PYLON, random_townhall.position, AbilityId.PROTOSSBUILD_PYLON, True)
      if AbilityId.TERRANBUILD_SUPPLYDEPOT in abilities:
        position = await self.find_placement(UnitTypeId.SUPPLYDEPOT, random_townhall.position, 28, False, 6)
        if position:
          worker = self.select_build_worker(position, True)
          if worker:
            collectedActions.append(worker(AbilityId.TERRANBUILD_SUPPLYDEPOT, position))
    if self.larva:
      random_larva = random.choice(self.larva)
      collectedActions.append(random_larva(AbilityId.LARVATRAIN_OVERLORD))
  return collectedActions

async def is_expansion_safe(self):
  safe = False
  self.expansion_location = await self.get_next_expansion()
  if self.expansion_location:
    if self.enemy_units:
      closest_enemy = self.enemy_units.closest_to(self.expansion_location)
      _range = closest_enemy.ground_range + closest_enemy.radius + 2.75
      if self.expansion_location.distance_to(closest_enemy) > _range:
        safe = True
    else:
      safe = True
  return safe

async def expand(self):
  actions = []
  worker = self.select_build_worker(self.expansion_location, False)
  start_townhall_type = {
      Race.Protoss: AbilityId.PROTOSSBUILD_NEXUS,
      Race.Terran: AbilityId.TERRANBUILD_COMMANDCENTER,
      Race.Zerg: AbilityId.ZERGBUILD_HATCHERY,
  }
  ability = start_townhall_type[self.race]
  if ability in worker.abilities:
    return [ worker(ability, self.expansion_location) ]
  return actions

async def build_structure(self, structure, near_position, ability, find_placement=False):
  actions = []
  if find_placement:
    actions += await try_placement_ranges(self, structure, near_position, ability)
  else:
    worker = self.select_build_worker(near_position, True)
    actions += [ worker(ability, near_position) ]
  return actions

def should_increase_supply(self):
  # either by multiplier, multiplier for new supply, build order amount.
  pending_supply = (self.already_pending(UnitTypeId.PYLON) + self.already_pending(UnitTypeId.SUPPLYDEPOT) + self.already_pending(UnitTypeId.OVERLORD)) * 8
  pending_supply_cap = self.supply_cap + pending_supply
  pending_supply_left = self.supply_left + pending_supply
  return True if pending_supply_left < pending_supply_cap * 0.20 and not self.supply_cap == 200 else False

def should_expand(self):
  start_townhall_type = {
    Race.Protoss: UnitTypeId.NEXUS,
    Race.Terran: UnitTypeId.COMMANDCENTER,
    Race.Zerg: UnitTypeId.HATCHERY,
  }
  return not short_on_workers(self) and not self.already_pending(start_townhall_type[self.race])

async def collect_gas(self, abilities):
  vespene_geyser = get_vespene_geysers(self)
  if vespene_geyser:
    if AbilityId.TERRANBUILD_REFINERY in abilities:
      return await build_structure(self, UnitTypeId.REFINERY, vespene_geyser, AbilityId.TERRANBUILD_REFINERY)
    if AbilityId.PROTOSSBUILD_ASSIMILATOR in abilities:
      return await build_structure(self, UnitTypeId.ASSIMILATOR, vespene_geyser, AbilityId.PROTOSSBUILD_ASSIMILATOR)    
    if AbilityId.ZERGBUILD_EXTRACTOR in abilities:
      return await build_structure(self, UnitTypeId.EXTRACTOR, vespene_geyser, AbilityId.ZERGBUILD_EXTRACTOR)
  return []

def get_vespene_geysers(self):
  if (self.townhalls):
    vespene_geysers = self.vespene_geyser.closer_than(14.5, random.choice(self.townhalls))
    if (vespene_geysers):
      return random.choice(vespene_geysers)

async def boost_production(self):
  actions = []
  if self.townhalls:
    ability = AbilityId.EFFECT_CHRONOBOOSTENERGYCOST
    random_townhall = random.choice(self.townhalls)
    if ability in random_townhall.abilities:
      random_building = random.choice(self.structures)
      if not random_building.has_buff(BuffId.CHRONOBOOSTENERGYCOST):
        if not random_building.is_idle:
          actions +=  [ random_townhall(ability, random_building) ]
    queens = self.units(UnitTypeId.QUEEN)
    if queens:
      ability = AbilityId.EFFECT_INJECTLARVA
      for townhall in self.townhalls:
        closest_queen = get_closest_unit(self, townhall, queens)
        found_index = next((index for (index, d) in enumerate(self.reserved_for_task) if d.tag == closest_queen.tag), -1)
        if found_index < 0 and len(self.reserved_for_task) < len(self.townhalls):
          self.reserved_for_task.append(closest_queen)
        closest_queen.reserved_for_task = True
        if not townhall.has_buff(BuffId.QUEENSPAWNLARVATIMER):
          actions += [ closest_queen(ability, townhall)  ]
  return actions

async def build_army_buildings(self):
  actions = []
  worker_abilities = random.choice(self.workers).abilities 
  # Protoss
  income_per_building = 384
  ability_id = AbilityId.PROTOSSBUILD_GATEWAY
  unit_ids = [UnitTypeId.GATEWAY, UnitTypeId.WARPGATE]
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [ UnitTypeId.PYLON ], ability_id))
  income_per_building = 512
  ability_id = AbilityId.PROTOSSBUILD_STARGATE
  unit_ids = [UnitTypeId.STARGATE]
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [ UnitTypeId.PYLON ], ability_id))
  income_per_building = 512
  ability_id = AbilityId.PROTOSSBUILD_ROBOTICSFACILITY
  unit_ids = [UnitTypeId.ROBOTICSFACILITY]
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [ UnitTypeId.PYLON ], ability_id))
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [ UnitTypeId.PYLON ], ability_id))
  # Terran
  income_per_building = 512
  ability_id = AbilityId.TERRANBUILD_BARRACKS
  unit_ids = [UnitTypeId.BARRACKS]
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [], ability_id))
  income_per_building = 512
  ability_id = AbilityId.TERRANBUILD_FACTORY
  unit_ids = [UnitTypeId.FACTORY]
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [UnitTypeId.COMMANDCENTER, unit_ids[0]], ability_id))
  income_per_building = 512
  ability_id = AbilityId.TERRANBUILD_STARPORT
  unit_ids = [UnitTypeId.STARPORT]
  if ability_id in worker_abilities:
    amount = calculate_building_amount(self, income_per_building)
    actions.extend(await build_basic_structure(self, unit_ids, amount, [UnitTypeId.COMMANDCENTER, unit_ids[0]], ability_id))  
  # Zerg
  if AbilityId.ZERGBUILD_SPAWNINGPOOL in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.SPAWNINGPOOL], 1, [UnitTypeId.HATCHERY], AbilityId.ZERGBUILD_SPAWNINGPOOL))
  if AbilityId.ZERGBUILD_ROACHWARREN in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.ROACHWARREN], 1, [UnitTypeId.HATCHERY], AbilityId.ZERGBUILD_ROACHWARREN))
  if AbilityId.ZERGBUILD_BANELINGNEST in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.BANELINGNEST], 1, [UnitTypeId.HATCHERY], AbilityId.ZERGBUILD_BANELINGNEST))
  return actions if not actions else [ random.choice(actions) ]

async def train_army_units(self):
  actions = []
  # Protoss
  gateway_abilities = [AbilityId.GATEWAYTRAIN_ZEALOT, AbilityId.TRAIN_ADEPT, AbilityId.GATEWAYTRAIN_STALKER, AbilityId.GATEWAYTRAIN_SENTRY]
  actions += await train_or_research(self, UnitTypeId.GATEWAY, random.choice(gateway_abilities))
  total_observers = len(self.units(UnitTypeId.OBSERVER)) + len(self.units(UnitTypeId.OBSERVERSIEGEMODE))
  robotics_facility_abilities = [AbilityId.ROBOTICSFACILITYTRAIN_IMMORTAL, AbilityId.TRAIN_DISRUPTOR]
  if total_observers <= 0:
    robotics_facility_abilities.append(AbilityId.ROBOTICSFACILITYTRAIN_OBSERVER)
  total_warp_prisms = len(self.units(UnitTypeId.WARPPRISM)) + len(self.units(UnitTypeId.WARPPRISMPHASING))
  if total_warp_prisms <= 0:
    robotics_facility_abilities.append(AbilityId.ROBOTICSFACILITYTRAIN_WARPPRISM)
  actions += await train_or_research(self, UnitTypeId.ROBOTICSFACILITY, random.choice(robotics_facility_abilities))
  starport_abilities = [AbilityId.STARGATETRAIN_ORACLE, AbilityId.STARGATETRAIN_PHOENIX, AbilityId.STARGATETRAIN_VOIDRAY]
  actions += await train_or_research(self, UnitTypeId.STARPORT, random.choice(starport_abilities))
  warpgate_abilities = [AbilityId.TRAINWARP_ADEPT, AbilityId.WARPGATETRAIN_HIGHTEMPLAR, AbilityId.WARPGATETRAIN_SENTRY, AbilityId.WARPGATETRAIN_STALKER, AbilityId.WARPGATETRAIN_ZEALOT]
  actions += await train_or_research(self, UnitTypeId.WARPGATE, random.choice(warpgate_abilities))
  sentry_abilities = [AbilityId.HALLUCINATION_ARCHON, AbilityId.HALLUCINATION_COLOSSUS]
  actions += await train_or_research(self, UnitTypeId.SENTRY, random.choice(sentry_abilities))
  # Terran
  if len(self.units(UnitTypeId.HELLIONTANK)) < len(self.units(UnitTypeId.HELLION)):
    actions += await train_or_research(self, UnitTypeId.HELLION, AbilityId.MORPH_HELLBAT)
  barracks_abilities = [AbilityId.BARRACKSTRAIN_MARINE, AbilityId.BARRACKSTRAIN_REAPER, AbilityId.BARRACKSTRAIN_MARAUDER]
  actions += await train_or_research(self, UnitTypeId.BARRACKS, random.choice(barracks_abilities))
  factory_abilities = [AbilityId.FACTORYTRAIN_HELLION, AbilityId.FACTORYTRAIN_WIDOWMINE]
  actions += await train_or_research(self, UnitTypeId.FACTORY, random.choice(factory_abilities))
  ghost_academy_abilities = [AbilityId.BUILD_NUKE, AbilityId.GHOSTACADEMYRESEARCH_RESEARCHENHANCEDSHOCKWAVES, AbilityId.RESEARCH_PERSONALCLOAKING]
  actions += await train_or_research(self, UnitTypeId.GHOSTACADEMY, random.choice(ghost_academy_abilities))
  # Zerg
  if len(self.units(UnitTypeId.RAVAGER)) < len(self.units(UnitTypeId.ROACH)):
    actions += await train_or_research(self, UnitTypeId.ROACH, AbilityId.MORPHTORAVAGER_RAVAGER)
  if len(self.units(UnitTypeId.BANELING)) < len(self.units(UnitTypeId.ZERGLING)):
    actions += await train_or_research(self, UnitTypeId.ZERGLING, AbilityId.MORPHZERGLINGTOBANELING_BANELING)
  larva_abilities = [AbilityId.LARVATRAIN_ZERGLING, AbilityId.LARVATRAIN_ROACH]
  if self.larva:
    larva = random.choice(self.larva)
    ability = random.choice(larva_abilities)
    if ability in larva.abilities:
      actions += [ larva(ability) ]
  if self.townhalls:
    townhall = random.choice(self.townhalls)
    if AbilityId.TRAINQUEEN_QUEEN in townhall.abilities:
      if townhall.is_idle:
        actions += [ townhall(AbilityId.TRAINQUEEN_QUEEN) ]
  return actions if not actions else [ random.choice(actions) ]

async def build_upgrade(self, worker_abilities):
  actions = []
  # Protoss
  if AbilityId.PROTOSSBUILD_CYBERNETICSCORE in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.CYBERNETICSCORE], 1, [random.choice(self.structures).type_id], AbilityId.PROTOSSBUILD_CYBERNETICSCORE))
  ability = AbilityId.PROTOSSBUILD_FLEETBEACON
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.FLEETBEACON], 1, [random.choice(self.structures).type_id], ability)) 
  if AbilityId.PROTOSSBUILD_FORGE in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.FORGE], 1, [random.choice(self.structures).type_id], AbilityId.PROTOSSBUILD_FORGE))
  ability = AbilityId.PROTOSSBUILD_DARKSHRINE
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.DARKSHRINE], 1, [random.choice(self.structures).type_id], ability))
  ability = AbilityId.PROTOSSBUILD_ROBOTICSBAY
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.ROBOTICSBAY], 1, [random.choice(self.structures).type_id], ability))
  ability = AbilityId.PROTOSSBUILD_TEMPLARARCHIVE
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.TEMPLARARCHIVE], 1, [random.choice(self.structures).type_id], ability))
  ability = AbilityId.PROTOSSBUILD_TWILIGHTCOUNCIL
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.TWILIGHTCOUNCIL], 1, [random.choice(self.structures).type_id], ability))
  # Terran
  ability = AbilityId.TERRANBUILD_FUSIONCORE
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.FUSIONCORE], 1, [random.choice(self.structures).type_id], ability))
  if AbilityId.TERRANBUILD_ENGINEERINGBAY in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.ENGINEERINGBAY], 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_ENGINEERINGBAY))
  if AbilityId.TERRANBUILD_GHOSTACADEMY in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.GHOSTACADEMY], 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_GHOSTACADEMY))
  ability = AbilityId.TERRANBUILD_ARMORY
  if ability in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.ARMORY], 1, [random.choice(self.structures).type_id], ability))
  # Zerg
  if AbilityId.ZERGBUILD_EVOLUTIONCHAMBER in worker_abilities:
    return await build_basic_structure(self, [UnitTypeId.EVOLUTIONCHAMBER], 1, [random.choice(self.structures).type_id], AbilityId.ZERGBUILD_EVOLUTIONCHAMBER)
  return actions if not actions else [ random.choice(actions) ]

async def research_upgrade(self):
  actions = []
  # Protoss
  forge_abilities = [AbilityId.FORGERESEARCH_PROTOSSGROUNDWEAPONSLEVEL1, AbilityId.FORGERESEARCH_PROTOSSGROUNDARMORLEVEL1, AbilityId.FORGERESEARCH_PROTOSSSHIELDSLEVEL1]
  actions += await train_or_research(self, UnitTypeId.FORGE, random.choice(forge_abilities))
  cybernetics_core_abilities = [AbilityId.CYBERNETICSCORERESEARCH_PROTOSSAIRWEAPONSLEVEL1, AbilityId.CYBERNETICSCORERESEARCH_PROTOSSAIRARMORLEVEL1, AbilityId.RESEARCH_WARPGATE]
  actions += await train_or_research(self, UnitTypeId.CYBERNETICSCORE, random.choice(cybernetics_core_abilities))
  twilight_council_abilities = [AbilityId.RESEARCH_CHARGE, AbilityId.RESEARCH_BLINK, AbilityId.RESEARCH_ADEPTRESONATINGGLAIVES]
  actions += await train_or_research(self, UnitTypeId.TWILIGHTCOUNCIL, random.choice(twilight_council_abilities))
  # Terran
  command_center_abilities = [AbilityId.UPGRADETOORBITAL_ORBITALCOMMAND, AbilityId.UPGRADETOPLANETARYFORTRESS_PLANETARYFORTRESS, ]
  actions += await train_or_research(self, UnitTypeId.COMMANDCENTER, random.choice(command_center_abilities))
  barracks_abilities = [AbilityId.BUILD_TECHLAB_BARRACKS, AbilityId.BUILD_REACTOR_BARRACKS]
  actions += await train_or_research(self, UnitTypeId.BARRACKS, random.choice(barracks_abilities))
  barracks_techlab_abilities = [AbilityId.RESEARCH_CONCUSSIVESHELLS, AbilityId.BARRACKSTECHLABRESEARCH_STIMPACK]
  actions += await train_or_research(self, UnitTypeId.BARRACKSTECHLAB, random.choice(barracks_techlab_abilities))
  engineering_bay_abilities = [AbilityId.RESEARCH_HISECAUTOTRACKING, AbilityId.RESEARCH_TERRANSTRUCTUREARMORUPGRADE]
  actions += await train_or_research(self, UnitTypeId.ENGINEERINGBAY, random.choice(engineering_bay_abilities))
  factory_abilities = [AbilityId.BUILD_TECHLAB_FACTORY, AbilityId.BUILD_REACTOR_FACTORY]
  actions += await train_or_research(self, UnitTypeId.FACTORY, random.choice(factory_abilities))
  actions += await train_or_research(self, UnitTypeId.STARPORT, AbilityId.BUILD_TECHLAB_STARPORT)

  # Zerg
  hatchery_abilities = [AbilityId.RESEARCH_BURROW, AbilityId.RESEARCH_PNEUMATIZEDCARAPACE, AbilityId.UPGRADETOLAIR_LAIR]
  actions += await train_or_research(self, UnitTypeId.HATCHERY, random.choice(hatchery_abilities))
  actions += await train_or_research(self, UnitTypeId.SPAWNINGPOOL, AbilityId.RESEARCH_ZERGLINGMETABOLICBOOST)
  evolution_chamber_abilities = [AbilityId.RESEARCH_ZERGGROUNDARMORLEVEL1, AbilityId.RESEARCH_ZERGMELEEWEAPONSLEVEL1, AbilityId.RESEARCH_ZERGMISSILEWEAPONSLEVEL1]
  actions += await train_or_research(self, UnitTypeId.EVOLUTIONCHAMBER, random.choice(evolution_chamber_abilities))
  return actions if not actions else [ random.choice(actions) ]


async def build_defensive_structure(self, worker_abilities):
  actions = []
  if AbilityId.PROTOSSBUILD_PHOTONCANNON in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.PHOTONCANNON], 1, [random.choice(self.structures).type_id], AbilityId.PROTOSSBUILD_PHOTONCANNON))
  if AbilityId.BUILD_SHIELDBATTERY in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.SHIELDBATTERY], 1, [random.choice(self.structures).type_id], AbilityId.BUILD_SHIELDBATTERY))
  if AbilityId.TERRANBUILD_MISSILETURRET in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.MISSILETURRET], 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_MISSILETURRET))
  if AbilityId.TERRANBUILD_SENSORTOWER in worker_abilities:
    # add logic for no overlap.
    actions.extend(await build_basic_structure(self, [UnitTypeId.SENSORTOWER], 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_SENSORTOWER))
  if AbilityId.TERRANBUILD_BUNKER in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.BUNKER], 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_BUNKER))
  if AbilityId.ZERGBUILD_SPINECRAWLER in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.SPINECRAWLER, UnitTypeId.SPINECRAWLERUPROOTED], 1, [random.choice(self.structures).type_id], AbilityId.ZERGBUILD_SPINECRAWLER))
  if AbilityId.ZERGBUILD_SPORECRAWLER in worker_abilities:
    actions.extend(await build_basic_structure(self, [UnitTypeId.SPORECRAWLER, UnitTypeId.SPORECRAWLERUPROOTED], 1, [random.choice(self.structures).type_id], AbilityId.ZERGBUILD_SPORECRAWLER))    
  return actions if not actions else [ random.choice(actions) ]

async def build_basic_structure(self, to_build, count, near, ability):
  actions = []
  current_count = 0
  for building in to_build:
    current_count += len(self.structures(building)) + self.already_pending(building)
  if (current_count < count):
    if near:
      near_building_type = near[0]
      if (self.structures(near_building_type)):
        near_building = random.choice(self.structures(near_building_type))
        actions += await try_placement_ranges(self, to_build[0], near_building.position, ability)
    else:
      near_building = random.choice(self.structures)
      actions += await try_placement_ranges(self, to_build[0], near_building.position, ability)
  return actions

def send_scout(self):
  # For zerg grab overlord and send to enemy base.
  overlords = self.units(UnitTypeId.OVERLORD)
  if overlords:
    return [ overlords[0](AbilityId.MOVE_MOVE, self.enemy_start_locations[0]) ]
  return []
      
def decide_action_on_created(self, unit):
  if (unit.type_id == UnitTypeId.OVERLORD):
    return [ unit(AbilityId.MOVE_MOVE, Point2(select_random_point(self))) ]
  if (unit.type_id == UnitTypeId.BROODLING):
    if self.enemy_units_and_structures:
      closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
      return [ unit(AbilityId.ATTACK_ATTACK, closest_enemy)]
  return []
