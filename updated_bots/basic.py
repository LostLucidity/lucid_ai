import random

from sc2.constants import AbilityId, BuffId
from sc2.ids.unit_typeid import UnitTypeId
from sc2.position import Point2

from helper import select_random_point, short_on_workers, calculate_building_amount

def should_build_workers(self):
  return True if short_on_workers(self) and self.minerals < 1250 else False
  
async def build_worker(self):
  collectedActions = []
  idle_townhalls = self.townhalls.idle
  if (idle_townhalls):
    units_abilities = await self.get_available_abilities(idle_townhalls)
    for index, abilities in enumerate(units_abilities):
      if AbilityId.NEXUSTRAIN_PROBE in abilities:
        collectedActions.append(idle_townhalls[index](AbilityId.NEXUSTRAIN_PROBE))
      if AbilityId.COMMANDCENTERTRAIN_SCV in abilities:
        collectedActions.append(idle_townhalls[index](AbilityId.COMMANDCENTERTRAIN_SCV))
  if self.larva:
    units_abilities = await self.get_available_abilities(self.larva)
    for index, abilities in enumerate(units_abilities):
      if AbilityId.LARVATRAIN_DRONE in abilities:
        collectedActions.append(self.larva[index](AbilityId.LARVATRAIN_DRONE))
  return collectedActions

async def build_supply(self, abilities):
  collectedActions = []
  idle_townhalls = self.townhalls.idle
  if (idle_townhalls):
    random_townhall = random.choice(idle_townhalls)
    if AbilityId.PROTOSSBUILD_PYLON in abilities:
      return await build_structure(self, UnitTypeId.PYLON, random_townhall.position, AbilityId.PROTOSSBUILD_PYLON, True)
    if AbilityId.TERRANBUILD_SUPPLYDEPOT in abilities:
      position = await self.find_placement(UnitTypeId.SUPPLYDEPOT, random_townhall.position, 28, False, 6)
      worker = self.select_build_worker(position, True)
      collectedActions.append(worker(AbilityId.TERRANBUILD_SUPPLYDEPOT, position))
    if self.larva:
      random_larva = random.choice(self.larva)
      larvaAbilities = await self.get_available_abilities(random_larva)
      if AbilityId.LARVATRAIN_OVERLORD in larvaAbilities:
        collectedActions.append(random_larva(AbilityId.LARVATRAIN_OVERLORD))
  return collectedActions

async def build_structure(self, structure, position, ability, find_placement=False):
  if (find_placement):
    position = await self.find_placement(structure, position, 28, False, 6)
  worker = self.select_build_worker(position, True)
  return [ worker(ability, position) ]

def should_increase_supply(self):
  # either by multiplier, multiplier for new supply, build order amount.
  pending_supply = (self.already_pending(UnitTypeId.PYLON) + self.already_pending(UnitTypeId.SUPPLYDEPOT) + self.already_pending(UnitTypeId.OVERLORD)) * 8
  pending_supply_cap = self.supply_cap + pending_supply
  pending_supply_left = self.supply_left + pending_supply
  return True if pending_supply_left < pending_supply_cap * 0.20 and not self.supply_cap == 200 else False

def should_expand(self):
  if (not short_on_workers(self)):
    for townhall in self.townhalls:
      if townhall.ideal_harvesters <= townhall.assigned_harvesters:
        if self.can_afford(townhall.type_id):
          if not self.already_pending(townhall.type_id):
            return True

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
  if (self.townhalls):
    random_townhall = random.choice(self.townhalls)
    townhall_abilities = await self.get_available_abilities(random_townhall)
    if AbilityId.EFFECT_CHRONOBOOSTENERGYCOST in townhall_abilities:
      random_building = random.choice(self.structures)
      if not random_building.has_buff(BuffId.CHRONOBOOSTENERGYCOST):
        if not random_building.is_idle:
          return [ random_townhall(AbilityId.EFFECT_CHRONOBOOSTENERGYCOST, random_building) ]
  return []

async def build_army_buildings(self):
  actions = []
  worker_abilities = await self.get_available_abilities(random.choice(self.workers))
  if AbilityId.PROTOSSBUILD_GATEWAY in worker_abilities:
    amount = calculate_building_amount(self, UnitTypeId.GATEWAY, 264)
    return await build_basic_structure(self, UnitTypeId.GATEWAY, amount, [UnitTypeId.PYLON, UnitTypeId.GATEWAY], AbilityId.PROTOSSBUILD_GATEWAY)
  if AbilityId.TERRANBUILD_BARRACKS in worker_abilities:
    amount = calculate_building_amount(self, UnitTypeId.BARRACKS, 264)
    return await build_basic_structure(self, UnitTypeId.BARRACKS, amount, [UnitTypeId.COMMANDCENTER, UnitTypeId.BARRACKS], AbilityId.TERRANBUILD_BARRACKS)
  if AbilityId.ZERGBUILD_SPAWNINGPOOL in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.SPAWNINGPOOL, 1, [UnitTypeId.HATCHERY], AbilityId.ZERGBUILD_SPAWNINGPOOL))
  if AbilityId.ZERGBUILD_ROACHWARREN in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.ROACHWARREN, 1, [UnitTypeId.HATCHERY], AbilityId.ZERGBUILD_ROACHWARREN))
  if AbilityId.ZERGBUILD_BANELINGNEST in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.BANELINGNEST, 1, [UnitTypeId.HATCHERY], AbilityId.ZERGBUILD_BANELINGNEST))
  return actions if not actions else [ random.choice(actions) ]

async def train_army_units(self):
  gateways = self.structures(UnitTypeId.GATEWAY).ready
  if gateways:
    gateway = random.choice(gateways)
    abilities = await self.get_available_abilities(gateway)
    if AbilityId.GATEWAYTRAIN_ZEALOT in abilities:
      if gateway.is_idle:
        return [ gateway(AbilityId.GATEWAYTRAIN_ZEALOT) ]
  barracks = self.structures(UnitTypeId.BARRACKS).ready
  if barracks:
    barrack = random.choice(barracks)
    abilities = await self.get_available_abilities(barrack)
    if AbilityId.BARRACKSTRAIN_MARINE in abilities:
      if barrack.is_idle:
        return [ barrack(AbilityId.BARRACKSTRAIN_MARINE) ]
  if self.larva:
    larva = random.choice(self.larva)
    abilities = await self.get_available_abilities(larva)
    if AbilityId.LARVATRAIN_ZERGLING in abilities:
      return [ larva(AbilityId.LARVATRAIN_ZERGLING) ]
  return []

async def attack(self):
  actions = []
  # idle and attacking units.
  attacking_units = self.units.filter(lambda unit: unit.is_attacking)
  units_idle_or_attacking_units = self.units.idle + attacking_units
  if units_idle_or_attacking_units:
    for unit in units_idle_or_attacking_units:
      abilities = await self.get_available_abilities(unit)
      ability = AbilityId.ATTACK_ATTACK
      if ability in abilities:
        enemy_targets = self.enemy_structures + self.enemy_units + self.out_of_vision_units
        enemy_target = enemy_targets.closest_to(Point2(unit.position)).position if enemy_targets else self.enemy_start_locations[0]
        actions += [ unit(ability, enemy_target) ]
  return actions        

async def build_upgrade(self, worker_abilities):
  actions = []
  if AbilityId.PROTOSSBUILD_FORGE in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.FORGE, 1, [random.choice(self.structures).type_id], AbilityId.PROTOSSBUILD_FORGE))
  if AbilityId.PROTOSSBUILD_CYBERNETICSCORE in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.CYBERNETICSCORE, 1, [random.choice(self.structures).type_id], AbilityId.PROTOSSBUILD_CYBERNETICSCORE))
  if AbilityId.TERRANBUILD_ENGINEERINGBAY in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.ENGINEERINGBAY, 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_ENGINEERINGBAY))
  if AbilityId.ZERGBUILD_EVOLUTIONCHAMBER in worker_abilities:
    return await build_basic_structure(self, UnitTypeId.EVOLUTIONCHAMBER, 1, [random.choice(self.structures).type_id], AbilityId.ZERGBUILD_EVOLUTIONCHAMBER)
  return actions if not actions else [ random.choice(actions) ]

async def build_defensive_structure(self, worker_abilities):
  actions = []
  if AbilityId.PROTOSSBUILD_PHOTONCANNON in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.PHOTONCANNON, 1, [random.choice(self.structures).type_id], AbilityId.PROTOSSBUILD_PHOTONCANNON))
  if AbilityId.BUILD_SHIELDBATTERY in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.SHIELDBATTERY, 1, [random.choice(self.structures).type_id], AbilityId.BUILD_SHIELDBATTERY))
  if AbilityId.TERRANBUILD_MISSILETURRET in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.MISSILETURRET, 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_MISSILETURRET))
  if AbilityId.TERRANBUILD_SENSORTOWER in worker_abilities:
    # add logic for no overlap.
    actions.extend(await build_basic_structure(self, UnitTypeId.SENSORTOWER, 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_SENSORTOWER))
  if AbilityId.TERRANBUILD_BUNKER in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.BUNKER, 1, [random.choice(self.structures).type_id], AbilityId.TERRANBUILD_BUNKER))
  if AbilityId.ZERGBUILD_SPINECRAWLER in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.SPINECRAWLER, 1, [random.choice(self.structures).type_id], AbilityId.ZERGBUILD_SPINECRAWLER))
  if AbilityId.ZERGBUILD_SPORECRAWLER in worker_abilities:
    actions.extend(await build_basic_structure(self, UnitTypeId.SPORECRAWLER, 1, [random.choice(self.structures).type_id], AbilityId.ZERGBUILD_SPORECRAWLER))    
  return actions

async def build_basic_structure(self, to_build, count, near, action):
  if (len(self.structures(to_build)) + self.already_pending(to_build) < count):
    if (len(near) == 2 and self.structures(near[1])):
      near_building_type = near[1]
      placement_step = 3
    else:
      near_building_type = near[0]
      placement_step = 6
    if (self.structures(near_building_type)):
      near_building = random.choice(self.structures(near_building_type))
      position = await self.find_placement(to_build, near_building.position, 28, False, placement_step)
      if position:
        worker = self.select_build_worker(position, True)
        return [ worker(action, position) ]
  return []

def send_scout(self):
  # For zerg grab overlord and send to enemy base.
  overlords = self.units(UnitTypeId.OVERLORD)
  if overlords:
    return [ overlords[0](AbilityId.MOVE_MOVE, self.enemy_start_locations[0]) ]
  return []
      
def decide_action(self, unit):
  if (unit.type_id == UnitTypeId.OVERLORD):
    return [ unit(AbilityId.MOVE_MOVE, Point2(select_random_point(self))) ]
  return []