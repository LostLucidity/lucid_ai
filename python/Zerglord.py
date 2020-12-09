import sc2, asyncio, random, math, time
from sc2 import run_game, Race, maps, Difficulty
from sc2.player import Bot, Computer, Human
from sc2.constants import *
from sc2.ids.unit_typeid import UnitTypeId
from sc2.ids.ability_id import AbilityId
from sc2.ids.upgrade_id import UpgradeId
from sc2.position import Point2, Point3
from sc2.unit import Unit
from sc2.units import Units
from sc2.client import Client
from sc2.game_state import GameState
from sc2.game_info import Ramp
from datetime import datetime


class Zerglord(sc2.BotAI):
    def __init__(self):
        self.build_order = [HATCHERY, SPAWNINGPOOL, ROACHWARREN, EVOLUTIONCHAMBER, LAIR, HYDRALISKDEN, 	INFESTATIONPIT, HIVE]     #Must start with Hatchery, it will not build one in the build order
        self.build_maintain = []   #Remember LAIR/HIVE tech in the build order
        self.army = [[ZERGLING, 10], [ROACH, 32], [HYDRALISK, 25]]    #Not Implemented yet
        self.unit_production = [ZERGLING, ROACH, ROACH, ROACH, HYDRALISK, HYDRALISK] #Will be deprecated
        self.upgrade_list = [RESEARCH_ZERGMISSILEWEAPONSLEVEL1, RESEARCH_ZERGGROUNDARMORLEVEL1, RESEARCH_ZERGMISSILEWEAPONSLEVEL2, RESEARCH_ZERGGROUNDARMORLEVEL2, RESEARCH_ZERGMISSILEWEAPONSLEVEL3, RESEARCH_ZERGGROUNDARMORLEVEL3]          #Not implemented yet
        self.max_drones = 75
        self.extractor_base = 2         #Extractors per base, can be a decimal to represent a ratio
        self.queens_base = 2         #Queens per base, no decimal allowed
        self.max_queens = 10
        self.supply_ovie = 12         #Supply left or less needed to make an overlord.
        self.max_viper = 0
        self.sec_expand = 120        #Time in seconds per base, so at a value of 30 it should build a hatchery every 30 seconds
        self.drones_unit = 1         #Number of drones to make per unit, decimals are allowed
        self.attack_supply = 180
        self.defend_supply = 160
        self.leash_unit = ROACH     #What unit the army will follow when attacking
        #=======================================================================================================#
        self.unit_index = 0
        self.build_order_index = 1
        self.attack_state = "defend"
        self.drone_made = 0
        self.unit_made = 1
        self.upgrade_index = 0
        self.chat = False

    async def on_step(self, iteration):#Main function, controls the bot
        if self.chat == False:
            self.chat = True
            self.chat_send("I am Zerglord! Version 1.4.2")
            self.chat_send("glhf")
        await self.distribute_workers()
        await self.research_upgrades()
        await self.build_units()
        await self.build_extractor()
        await self.building_order()
        await self.expand()
        await self.produce_queens()
        await self.manage_queens()
        await self.manage_army()


    async def build_units(self):#Worker production
        larvae = self.units(LARVA)
        bases = Units([], self)
        bases += self.structures(HATCHERY)
        bases += self.structures(LAIR)
        bases += self.structures(HIVE)
        threats = Units([], self)
        for base in bases:
            threats += self.enemy_units.closer_than(18, base)
        if self.time/self.sec_expand < (self.structures(HATCHERY).amount + self.structures(LAIR).amount + self.structures(HIVE).amount) or threats.amount > 0:
            for larva in larvae:
                if self.supply_left < self.supply_ovie and not self.already_pending(OVERLORD) and self.can_afford(OVERLORD) and self.supply_cap < 200:
                    larva.train(OVERLORD)
                elif self.can_afford(DRONE) and (self.supply_workers + self.already_pending(DRONE)) < self.max_drones and (self.drone_made/self.unit_made) < self.drones_unit:
                    larva.train(DRONE)
                    self.drone_made += 1
                elif self.units(VIPER).amount < self.max_viper and self.units(SPIRE).ready.exists and self.can_afford(VIPER):
                    larva.train(VIPER)
                else:
                    made_unit = False
                    if not self.structures(SPAWNINGPOOL).ready.exists and self.unit_made == 1:
                        self.drone_made = 0
                        break
                    set_unit = self.unit_production[self.unit_index]
                    if set_unit == ZERGLING and self.structures(SPAWNINGPOOL).ready.exists and self.can_afford(ZERGLING) and self.units(ZERGLING).amount + self.already_pending(ZERGLING) < 10:
                        larva.train(ZERGLING)
                        self.unit_made += 1
                        made_unit = True
                    elif set_unit == BANELING and self.structures(BANELINGNEST).ready.exists and self.can_afford(BANELING) and self.units(ZERGLING).amount >= 10:
                        self.units(ZERGLING).ready.random.train(BANELING)
                        made_unit = True
                    elif set_unit == HYDRALISK and self.structures(HYDRALISKDEN).ready.exists and self.can_afford(HYDRALISK) and self.units(ZERGLING).amount >= 10:
                        larva.train(HYDRALISK)
                        made_unit = True
                    elif set_unit == MUTALISK and self.structures(SPIRE).ready.exists and self.can_afford(MUTALISK) and self.units(ZERGLING).amount >= 10:
                        larva.train(MUTALISK)
                        made_unit = True
                    elif set_unit == ULTRALISK and self.structures(ULTRALISKCAVERN).ready.exists and self.can_afford(ULTRALISK) and self.units(ZERGLING).amount >= 10:
                        larva.train(ULTRALISK)
                        made_unit = True
                    elif set_unit == ROACH and self.structures(ROACHWARREN).ready.exists and self.can_afford(ROACH) and self.units(ZERGLING).amount >= 10:
                        larva.train(ROACH)
                        made_unit = True
                    elif set_unit == INFESTOR and self.structures(INFESTATIONPIT).ready.exists and self.can_afford(INFESTOR) and self.units(ZERGLING).amount >= 10:
                        larva.train(INFESTOR)
                        made_unit = True
                    elif set_unit == CORRUPTOR and self.structures(SPIRE).ready.exists and self.can_afford(CORRUPTOR) and self.units(ZERGLING).amount >= 10:
                        larva.train(CORRUPTOR)
                        made_unit = True
                    elif set_unit == BROODLORD and self.structures(GREATERSPIRE).ready.exists and self.units(CORRUPTER).ready.exists and self.can_afford(BROODLORD) and self.units(BROODLORD).amount < self.units(CORRUPTER).amount and self.units(ZERGLING).amount >= 10:
                        self.units(CORRUPTER).ready.random.train(BROODLORD)
                        made_unit = True
                    elif set_unit == SWARMHOSTMP and self.structures(INFESTATIONPIT).ready.exists and self.can_afford(SWARMHOSTMP) and self.units(ZERGLING).amount >= 10:
                        larva.train(SWARMHOSTMP)
                        made_unit = True
                    elif set_unit == LURKERMP and self.structures(HYDRALISKDEN).ready.exists and self.can_afford(LURKERMP) and self.units(HYDRALISK).ready.exists and self.units(LURKERMP).amount < self.units(HYDRALISK).amount and self.units(ZERGLING).amount >= 10:
                        self.units(HYDRALISK).ready.random.train(LURKERMP)
                        made_unit = True
                    elif set_unit == RAVAGER and self.structures(ROACHWARREN).ready.exists and self.can_afford(RAVAGER) and self.units(ROACH).ready.exists and self.units(ZERGLING).amount >= 10:
                        self.units(ROACH).ready.random.train(RAVAGER)
                        made_unit = True
                    if made_unit == True:
                        self.unit_made += 1
                    self.unit_index += 1
                    if self.unit_index == len(self.unit_production):
                        self.unit_index = 0

                

    async def build_extractor(self):
        bases = Units([], self)
        bases += self.structures(HATCHERY).ready
        bases += self.structures(LAIR).ready
        bases += self.structures(HIVE).ready
        vespenes = Units([], self)
        for hatch in bases:
            vespenes += self.vespene_geyser.closer_than(8.0, hatch)
        for vespene in vespenes:
            if self.structures(EXTRACTOR).amount < (bases.amount * self.extractor_base) and self.can_afford(EXTRACTOR) and self.units(OVERLORD).amount > 1 and not self.structures(EXTRACTOR).closer_than(0.1, vespene).exists:
                worker = self.units(DRONE).random
                if not self.already_pending(EXTRACTOR):
                    worker.build(EXTRACTOR, vespene)

    async def building_order(self):
        for building in self.build_maintain:
            if building[1] > self.structures(building[0]).amount and not self.already_pending(building[0]):
                if self.can_afford(building[0]):
                    if building[0] == LAIR and not self.already_pending(LAIR) and self.structures(HATCHERY).exists:
                        self.structures(HATCHERY).ready.random.train(LAIR)
                    elif building[0] == HIVE and not self.already_pending(HIVE) and self.structures(LAIR).exists:
                        self.structures(LAIR).ready.random.train(HIVE)
                    else:
                        await self.build(building[0], near=self.start_location)
        if self.build_order_index < len(self.build_order):
            if self.can_afford(self.build_order[self.build_order_index]) and self.structures(self.build_order[self.build_order_index - 1]).ready.exists:
                if self.build_order[self.build_order_index] == LAIR and self.structures(HATCHERY).ready.exists:
                    self.structures(HATCHERY).ready.random.train(LAIR)
                elif self.build_order[self.build_order_index] == HIVE and self.structures(LAIR).ready.exists:
                    self.structures(LAIR).ready.random.train(HIVE)
                elif not self.already_pending(self.build_order[self.build_order_index]):
                    self.build(self.build_order[self.build_order_index], near=self.start_location)
                append_maintain = True
                for maintain in self.build_maintain:
                    if maintain[0] == self.build_order[self.build_order_index]:
                        maintain[1] += 1
                        append_maintain = False
                if append_maintain == True:
                    self.build_maintain.append([self.build_order[self.build_order_index], 1])
                self.build_order_index += 1

    async def expand(self):
        bases = Units([], self)
        bases += self.structures(HATCHERY)
        bases += self.structures(LAIR)
        bases += self.structures(HIVE)
        threats = Units([], self)
        for base in bases:
            threats += self.enemy_units.closer_than(18, base)
        if self.time/self.sec_expand > bases.amount and self.can_afford(HATCHERY) and not self.already_pending(HATCHERY) and threats.amount == 0:
            await self.expand_now(max_distance=0)

    async def produce_queens(self):
        bases = self.structures(HATCHERY).ready.idle + self.structures(LAIR).ready.idle + self.structures(HIVE).ready.idle
        if self.units(SPAWNINGPOOL).ready.exists:
            for base in bases:
                if self.units(QUEEN).amount < self.queens_base*len(bases) and self.can_afford(QUEEN)  and self.units(QUEEN).amount < self.max_queens and not self.already_pending(QUEEN):
                    base.train(QUEEN)

    async def manage_queens(self):
        bases = self.structures(HATCHERY).ready + self.structures(LAIR).ready + self.structures(HIVE).ready
        queens = self.units(QUEEN).ready
        for queen in queens:
            powers = self.get_available_abilities(queen)
            if AbilityId.EFFECT_INJECTLARVA in powers and len(bases) > 0:
                target = random.choice(bases)
                queen(EFFECT_INJECTLARVA, target, queue=True)

    async def manage_army(self):
        army = Units([], self)
        army += self.units(ZERGLING)
        army += self.units(BANELING)
        army += self.units(HYDRALISK)
        army += self.units(MUTALISK)
        army += self.units(ULTRALISK)
        army += self.units(ROACH)
        army += self.units(INFESTOR)
        army += self.units(CORRUPTOR)
        army += self.units(BROODLORD)
        army += self.units(SWARMHOSTMP)
        army += self.units(LURKERMP)
        army += self.units(RAVAGER)
        bases = Units([], self)
        bases += self.units(HATCHERY)
        bases += self.units(LAIR)
        bases += self.units(HIVE)
        threats = Units([], self)
        for base in bases:
            threats += self.enemy_units.closer_than(18, base)
        for drone in self.units(DRONE):
            threats += self.enemy_units.closer_than(18, drone)
        if self.supply_used > self.attack_supply and not threats.exists:
            self.attack_state = "attack"
        elif self.supply_used < self.defend_supply or threats.exists:
            self.attack_state = "defend"
        if self.attack_state == "defend":
            if  len(threats) > 0:
                for zerg_unit in army:
                    zerg_unit.attack(threats.closest_to(zerg_unit))
            else:
                for zerg_unit in army:
                    if zerg_unit.type_id == ZERGLING:
                        if zerg_unit.is_idle:
                            zerg_unit.move(random.choice(list(self.expansion_locations.keys())))
                    else:
                        self.do(zerg_unit.move(self.start_location.position.towards(self.game_info.map_center, 8)))
        elif self.attack_state == "attack":
            for zerg_unit in army:
                if  self.enemy_structures.amount > 0:
                    zerg_unit.attack(self.enemy_structures.closest_to(zerg_unit).position.towards(self.game_info.map_center, 4))
                else:
                    if zerg_unit.type_id == ZERGLING:
                        if zerg_unit.is_idle:
                            zerg_unit.move(random.choice(list(self.expansion_locations.keys())))

    async def research_upgrades(self):
        if self.upgrade_index < len(self.upgrade_list):
            upgrade = self.upgrade_list[self.upgrade_index]
            if upgrade in [RESEARCH_ZERGMELEEWEAPONSLEVEL1,RESEARCH_ZERGMELEEWEAPONSLEVEL2,RESEARCH_ZERGMELEEWEAPONSLEVEL3,RESEARCH_ZERGGROUNDARMORLEVEL1,RESEARCH_ZERGGROUNDARMORLEVEL2,RESEARCH_ZERGGROUNDARMORLEVEL3,RESEARCH_ZERGMISSILEWEAPONSLEVEL1,RESEARCH_ZERGMISSILEWEAPONSLEVEL2,RESEARCH_ZERGMISSILEWEAPONSLEVEL3]:
                #Evolution Chamber
                if self.structures(EVOLUTIONCHAMBER).ready.idle.exists:
                    if upgrade == RESEARCH_ZERGMELEEWEAPONSLEVEL1 and self.can_afford(RESEARCH_ZERGMELEEWEAPONSLEVEL1):
                        self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGMELEEWEAPONSLEVEL1)
                        self.upgrade_index += 1
                        
                    elif upgrade == RESEARCH_ZERGMELEEWEAPONSLEVEL2 and self.can_afford(RESEARCH_ZERGMELEEWEAPONSLEVEL2):
                        if (self.structures(LAIR).ready.exists or self.structures(HIVE).ready.exists) and self.already_pending(ZERGMELEEWEAPONSLEVEL1) == 1:
                            self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGMELEEWEAPONSLEVEL2)
                            self.upgrade_index += 1
                            
                    elif upgrade == RESEARCH_ZERGMELEEWEAPONSLEVEL3 and self.can_afford(RESEARCH_ZERGMELEEWEAPONSLEVEL3):
                        if self.structures(HIVE).ready.exists and self.already_pending(ZERGMELEEWEAPONSLEVEL2) == 1:
                            self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGMELEEWEAPONSLEVEL3)
                            self.upgrade_index += 1
                            
                    elif upgrade == RESEARCH_ZERGGROUNDARMORLEVEL1 and self.can_afford(RESEARCH_ZERGGROUNDARMORLEVEL1):
                        self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGGROUNDARMORLEVEL1)
                        self.upgrade_index += 1
                        
                    elif upgrade == RESEARCH_ZERGGROUNDARMORLEVEL2 and self.can_afford(RESEARCH_ZERGGROUNDARMORLEVEL2):
                        if (self.structures(LAIR).ready.exists or self.structures(HIVE).ready.exists) and self.already_pending(ZERGGROUNDARMORSLEVEL1) == 1:
                            self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGGROUNDARMORLEVEL2)
                            self.upgrade_index += 1
                            
                    elif upgrade == RESEARCH_ZERGGROUNDARMORLEVEL3 and self.can_afford(RESEARCH_ZERGGROUNDARMORLEVEL3):
                        if self.structures(HIVE).ready.exists and self.already_pending(ZERGGROUNDARMORSLEVEL2) == 1:
                            self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGGROUNDARMORLEVEL3)
                            self.upgrade_index += 1
                            
                    elif upgrade == RESEARCH_ZERGMISSILEWEAPONSLEVEL1 and self.can_afford(RESEARCH_ZERGMISSILEWEAPONSLEVEL1):
                        self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGMISSILEWEAPONSLEVEL1)
                        self.upgrade_index += 1
                        
                    elif upgrade == RESEARCH_ZERGMISSILEWEAPONSLEVEL2 and self.can_afford(RESEARCH_ZERGMISSILEWEAPONSLEVEL2):
                        if (self.structures(LAIR).ready.exists or self.structures(HIVE).ready.exists) and self.already_pending(ZERGMISSILEWEAPONSLEVEL1) == 1:
                            self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGMISSILEWEAPONSLEVEL2)
                            self.upgrade_index += 1
                            
                    elif upgrade == RESEARCH_ZERGMISSILEWEAPONSLEVEL3 and self.can_afford(RESEARCH_ZERGMISSILEWEAPONSLEVEL3):
                        if self.structures(HIVE).ready.exists and self.already_pending(ZERGMISSILEWEAPONSLEVEL2):
                            self.structures(EVOLUTIONCHAMBER).ready.idle.random(RESEARCH_ZERGMISSILEWEAPONSLEVEL3)
                            self.upgrade_index += 1
                                      
                            
            






#run_game(maps.get("TritonLE"), [Bot(Race.Zerg, Zerglord(), name="Zerglord"), Computer(Race.Zerg, Difficulty.VeryHard)], realtime = False, save_replay_as="Zerglord.SC2Replay")
#, Computer(Race.Zerg, Difficulty.VeryHard)          
