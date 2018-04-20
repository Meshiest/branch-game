'use-strict';
const fs = require("fs");
const _ = require("underscore");

const types = JSON.parse(fs.readFileSync('json/branch.json'));
const settings = JSON.parse(fs.readFileSync('json/settings.json'));

// give players 2 minutes
const BASE_TIME = 125;
const DEFAULT_IP = 0;

const typeConv = {
  future: '100',
  feudal: '200',
  fantasy: '300',
  feral: '400',
  fanatic: '500',
};

class Recruit {
  constructor(type, index, player) {
    
    this.ability = false;
    this.type = typeConv[type];
    this.id = player + index;
    this.player = player;
    this.index = index;
    this.health = 0;
    this.maxHealth = 0;
    this.applySpecs(types[typeConv[type]]);
  }

  applySpecs(base) {
    if(this.maxHealth != base.meta.hp) {
      this.health += base.meta.hp - this.maxHealth;
    }
    this.attack = base.meta.atk;
    this.class = base.class;
    this.type = base.id;
    this.maxHealth = base.meta.hp;
    this.name = base.displayName;
    this.speed = base.meta.spd;
    this.sprite = base.sprite;

    // find the evolutions
    this.evolutions = [];
    for(let id in types) {
      let type = types[id];
      if(type.prereq.includes(base.id))
        this.evolutions.push(id);
    }
  }

  blob() {
    return {
      ability: this.ability,
      attack: this.attack,
      class: this.class,
      id: this.id,
      evolutions: this.evolutions,
      maxHealth: this.maxHealth,
      health: this.health,
      name: this.name,
      speed: this.speed,
      sprite: this.sprite,
      type: this.type
    };
  }

  living() {
    return this.health > 0;
  }
}

module.exports = class {
  constructor(id, player1, player2) {
    // player1 defaults
    this.player1 = player1;
    player1.game = id;
    player1.ready = false;
    player1.ip = DEFAULT_IP;

    // player2 defaults
    this.player2 = player2;
    player2.game = id;
    player2.ready = false;
    player2.ip = DEFAULT_IP;

    this.logs = [];
    this.id = id;
    this.time = 0;
    this.rounds = 0;
    this.state = 'setup';
  }

  // log an event
  log(msg) {
    this.logs[this.logs.length-1].push(msg);
  }

  // create a new log opening
  newLog() {
    this.logs.push([]);
  }

  // emit the logs to the players
  emitLogs() {
    let log = this.logs[this.logs.length-1];
    // give players time to view the animation
    this.time += log.length;
    this.player1.socket.emit('logs', 1, log);
    this.player2.socket.emit('logs', 2, log);
  }

  // game has ended or someone has left
  end(winner, reason1, reason2, now) {
    this.player1.game = -1;
    this.player2.game = -1;
    this.player1.socket.emit('done', reason1, now);
    this.player2.socket.emit('done', reason2, now);
    this.onDone(winner);
  }

  // emit messages to both players
  emit(callback) {
    this.player1.socket.emit(...arguments);
    this.player2.socket.emit(...arguments);
  }

  // ready up a player
  readySetup(player, isReady, classes) {
    player.ready = isReady;

    let num = (player == this.player1) ? '1' : '2';

    // update the player's class choices
    player.classes = classes.map((type, i)=>{return new Recruit(type, i, num);});

    // both players are ready
    if(this.player1.ready && this.player2.ready) {
      this.nextRound();
    }
  }

  // called when players decide what moves they will make
  readyRound(player, isReady, options) {
    player.ready = isReady;
    player.options = options;

    // both players are ready
    if(this.player1.ready && this.player2.ready) {
      this.runRound();
    }
  }
  
  // called when a player attempts to upgrade a unit
  upgradePrep(player, action) {

    // player can't upgrade
    if(player.ip === 0)
      return;

    // don't let users pick nonexistent targets 
    if(action.target < 0 || action.target > 2)
      return;

    let target = player.classes[action.target];

    // can't buff a dead guy
    if(!target.living())
      return;

    // player isn't ready anymore
    player.ready = false;

    // player is upgrading a recruit
    if(action.type == 'upgrade') {
      // player is trying to upgrade to something they can't upgrade to
      // an example would be dragon master from sniper
      if(!target.evolutions.includes(action.next))
        return;

      // update the Recruit object with new information and metadata
      target.applySpecs(types[action.next]);

      // remove an inversion point
      player.ip --;

    } else if(action.type == 'power' && !target.ability) { // player is activating a unit
      // its ability is now active
      target.ability = true;

      // remove an inversion point
      player.ip --;
    }

    // show the player the new state
    player.socket.emit('update', {
      classes: player.classes.map((a)=>{return a.blob();}),
      ip: player.ip,
      round: this.rounds,
    });
  }

  // add healing buffs from the healing recruits
  addBuffs() {
    let team1Health = 0;
    let team2Health = 0;

    let { team1bonus, team2bonus } = this.calcBonuses();

    // calculate total healing done by team 1
    for(let i = 0; i < this.player1.classes.length; i++) {
      let recruit = this.player1.classes[i];
      if(recruit.living() && recruit.ability) {
        team1Health += types[recruit.type].meta.buffs.ownHp || 0;
      }
    }

    // log healing done by team 1
    if(team1Health && !team1bonus.buffNull) { 
      this.log({team: 1, type: 'heal', value: team1Health});
      
      // heal team 1
      for(let i = 0; i < this.player1.classes.length; i++) {
        let recruit = this.player1.classes[i];
        if(recruit.living()) {
          recruit.health += team1Health;

          // cap health at max
          recruit.health = Math.min(recruit.maxHealth, recruit.health);
        }
      }
    }

    
    // calculate total healing done by team 2
    for(let i = 0; i < this.player2.classes.length; i++) {
      let recruit = this.player2.classes[i];
      if(recruit.living() && recruit.ability) {        
        team2Health += types[recruit.type].meta.buffs.ownHp || 0;
      }
    }
    
    // log healing done by team 2
    if(team2Health && !team2bonus.buffNull) {
      this.log({team: 2, type: 'heal', value: team2Health});

      // heal team 2
      for(let i = 0; i < this.player2.classes.length; i++) {
        let recruit = this.player2.classes[i];
        if(recruit.living()) {
          recruit.health += team2Health;

          // cap health at max
          recruit.health = Math.min(recruit.maxHealth, recruit.health);
        }
      }
    }
  }

  // called when a player readies up in the upgrade/prep phase
  readyPrep(player, isReady) {
    player.ready = isReady;
    if(this.player1.ready && this.player2.ready) {
      this.nextRound();
    }
  }

  calcBonuses() {
    let team1bonus = {
      speed: 0,
      attack: 0,
      debuffNull: false,
      buffNull: false
    };
    let team2bonus = {
      speed: 0,
      attack: 0,
      debuffNull: false,
      buffNull: false
    };

    // find team 1 recruits that are debuff and buff nulling
    for(let i = 0; i < this.player1.classes.length; i++) {
      let recruit = this.player1.classes[i];
      if(!recruit.living()) continue;
      if(recruit.ability) {        
        if(types[recruit.type].meta.buffs.debuffNull)
          team2bonus.debuffNull = true;
        if(types[recruit.type].meta.buffs.buffNull)
          team2bonus.buffNull = true;
      }
    }

    // find team 2 recruits that are debuff and buff nulling
    for(let i = 0; i < this.player2.classes.length; i++) {
      let recruit = this.player2.classes[i];
      if(!recruit.living()) continue;

      if(recruit.ability) {
        if(types[recruit.type].meta.buffs.debuffNull) 
          team1bonus.debuffNull = true;
        if(types[recruit.type].meta.buffs.buffNull)
          team1bonus.buffNull = true;
      }
    }

    return { team1bonus, team2bonus };
  }

  // runs calculations for the entire round
  runRound() {

    // create bonus information that will be applied to each recruit
    let { team1bonus, team2bonus } = this.calcBonuses();

    let recruits = [];

    // apply all buffs and debuffs when applicable
    // also store basic information for tracking damage and speed
    for(let i = 0; i < this.player1.classes.length; i++) {
      let recruit = this.player1.classes[i];

      // constuct some basic information that is useful for computing new speeds and attacks
      let blob = {
        rec: recruit,
        id: recruit.id,
        type: recruit.type,
        team: 1,
        speed: recruit.speed,
        attack: recruit.attack,
        priority: recruit.ability && types[recruit.type].meta.buffs.priority,
        health: recruit.health,
        mods: {
          future: settings.mods[recruit.class].future,
          feudal: settings.mods[recruit.class].feudal,
          fantasy: settings.mods[recruit.class].fantasy,
          feral: settings.mods[recruit.class].feral,
          fanatic: settings.mods[recruit.class].fanatic
        }
      };

      // find if the recruit was defending or attacking and its target
      let opts = this.player1.options;
      for(let j = 0; j < Math.min(opts.length, 3); j++) {
        // not valid json
        if(!opts[j].id || !opts[j].moveType)
          continue;

        if(opts[j].id !== recruit.id)
          continue;

        // wants to attack
        if(opts[j].moveType == 'attack') {
          // has no target
          if(!opts[j].moveTarget)
            continue;

          // invalid attack
          if(!opts[j].moveTarget.match(/^2[012]$/))
            continue;
        }
        if(opts[j].id == recruit.id) {
          blob.moveType = opts[j].moveType;
          if(blob.moveType == 'attack')
            blob.moveTarget = opts[j].moveTarget;
          else
            blob.moveType = 'defend';
          break;
        }
      }
      recruits.push(blob);

      if(!recruit.living()) continue;

      if(recruit.ability) {
        // add buffs to this team if this team hasn't been buff nulled
        if(!team1bonus.buffNull) {
          team1bonus.speed += types[recruit.type].meta.buffs.ownSpd || 0;
          team1bonus.attack += types[recruit.type].meta.buffs.ownAtk || 0;
        }

        // add debuffs to enemy team if this team hasn't been debuff nulled
        if(!team1bonus.debuffNull) {
          team2bonus.speed += types[recruit.type].meta.buffs.offSpd || 0;
          team2bonus.attack += types[recruit.type].meta.buffs.offAtk || 0;
        }
      }
    }

    // do the same thing we did above on team 2
    for(let i = 0; i < this.player2.classes.length; i++) {
      let recruit = this.player2.classes[i];

      // constuct some basic information that is useful for computing new speeds and attacks
      let blob = {
        rec: recruit,
        id: recruit.id,
        type: recruit.type,
        team: 2,
        speed: recruit.speed,
        attack: recruit.attack,
        priority: recruit.ability && types[recruit.type].meta.buffs.priority,
        health: recruit.health,
        mods: {
          future: settings.mods[recruit.class].future,
          feudal: settings.mods[recruit.class].feudal,
          fantasy: settings.mods[recruit.class].fantasy,
          feral: settings.mods[recruit.class].feral,
          fanatic: settings.mods[recruit.class].fanatic
        }
      };

      // find if the recruit was defending or attacking and its target
      let opts = this.player2.options;
      for(let j = 0; j < Math.min(opts.length, 3); j++) {
        // not valid json
        if(!opts[j].id || !opts[j].moveType)
          continue;

        if(opts[j].id !== recruit.id)
          continue;

        // wants to attack
        if(opts[j].moveType == 'attack') {
          // has no target
          if(!opts[j].moveTarget)
            continue;

          // invalid attack
          if(!opts[j].moveTarget.match(/^1[012]$/))
            continue;
        }
        if(opts[j].id == recruit.id) {
          blob.moveType = opts[j].moveType;
          if(blob.moveType == 'attack')
            blob.moveTarget = opts[j].moveTarget;
          else
            blob.moveType = 'defend';
          break;
        }
      }
      recruits.push(blob);
      
      if(!recruit.living()) continue;

      if(recruit.ability) {
        // add buffs if this team hasn't been buff nulled
        if(!team2bonus.buffNull) {
          team2bonus.speed += types[recruit.type].meta.buffs.ownSpd || 0;
          team2bonus.attack += types[recruit.type].meta.buffs.ownAtk || 0;
        }

        // add debuffs to enemy if this team hasn't been debuff nulled
        if(!team2bonus.debuffNull) {
          team1bonus.speed += types[recruit.type].meta.buffs.offSpd || 0;
          team1bonus.attack += types[recruit.type].meta.buffs.offAtk || 0;
        }
      }
    }

    // log the team bonuses if they are applicable
    if(team1bonus.speed || team1bonus.attack)
      this.log({team: 1, type: "bonus", value: team1bonus});
    if(team2bonus.speed || team2bonus.attack)
      this.log({team: 2, type: "bonus", value: team2bonus});

    let defenders = [];
    // handle defending
    for(let i = 0; i < recruits.length; i++) {
      let recruit = recruits[i];

      // only iterate through living and defending recruits
      if(!recruit.rec.living() || recruit.moveType != 'defend' ) continue;

      // add the player to the list of defenders
      defenders.push(recruit.id);

      let { debuffNull, buffNull } = recruit.team == 1 ? team1bonus : team2bonus;

      // apply provoking defense when using ability and not buff nulled
      if(recruit.rec.ability && types[recruit.rec.type].meta.buffs.provoke && !buffNull) {
        for(let j = 0; j < recruits.length; j++) {
          let other = recruits[j];

          // effect same team only
          if(other.team != recruit.team)
            continue;

          // great knight effect self
          if(other.id == recruit.id) {
            recruit.mods.feudal = 1;
            recruit.mods.future = 1;
            recruit.mods.fantasy = 1;
            recruit.mods.feral = 1;
            recruit.mods.fanatic = 1;
            recruit.mods.provoke = true;
          } else {
            // this player already has the bonus on them
            if(other.mods.provoke || other.mods.provoked)
              continue;

            // don't effect other provoked great knights that are defending and provoking
            // this will effect everyone else
            if(!(other.rec.ability && types[other.rec.type].meta.buffs.provoke && recruit.moveType == 'defend')) {
              other.mods.feudal = 0.666;
              other.mods.future = 0.666;
              other.mods.fantasy = 0.666;
              other.mods.feral = 0.666;
              other.mods.fanatic = 0.666;
              other.mods.provoked = true;
            }
          }
        }
      } else { // regular defending
        recruit.mods.feudal = 0.666;
        recruit.mods.future = 0.666;
        recruit.mods.fantasy = 0.666;
        recruit.mods.feral = 0.666;
        recruit.mods.fanatic = 0.666;
        recruit.mods.defend = true;
      } 
    }

    // log all the defending recruits
    if(defenders.length)
      this.log({team: 0, type: 'defend', value: defenders});

    // compute attack order
    let queue = [[]];

    // get all the living recruits
    let livingRecruits = recruits.filter(r => r.rec.living());


    // duplicate the living recruits queue
    let queueLineup = [].concat(livingRecruits);
    for(let i = 0; i < queueLineup.length; i++) {
      let recruit = queueLineup[i];

      // remove defending recruits from the queue
      // this queue will be used for attacking recruits only
      if(recruit.moveType != 'attack') {
        queueLineup.splice(i--, 1);
        continue;
      }

      // apply speed bonuses from each respective team
      recruit.speed += (recruit.team == 1 ? team1bonus.speed : team2bonus.speed) || 0;

      // make sure the recruit with priority is always placed first
      if(recruit.priority && !(recruit.team == 1 ? team1bonus : team2bonus).buffNull) {
        queue[queue.length-1].push(queueLineup.splice(i--, 1)[0]);
      }
    }
    // shuffle priority recruits
    queue[queue.length-1] = _.shuffle(queue[queue.length-1]);

    // until we have recruits left
    while(queueLineup.length) {
      
      // find max recruit speed
      let max = 0;
      for(let i = 0; i < queueLineup.length; i++) {
        let recruit = queueLineup[i];
        if(recruit.speed > max)
          max = recruit.speed;
      }


      // create a new speed group
      queue.push([]);

      // add recruits of the max speed to their own group
      for(let i = 0; i < queueLineup.length; i++) {
        let recruit = queueLineup[i];
        if(recruit.speed == max) {
          // remove the recruit from the queue so it can't be used twice
          queue[queue.length-1].push(queueLineup.splice(i--, 1)[0]);
        }
      }

      // shuffle speed group
      queue[queue.length-1] = _.shuffle(queue[queue.length-1]);
    }


    // finalized queue of all 
    let arr = [];
    while(queue.length) {
      arr = arr.concat(queue.splice(0, 1)[0]);
    }
    queue = arr;
    let damage = 0;

    // loop through all attackers
    for(let i = 0; i < queue.length; i++) {
      let recruit = queue[i];
      let { debuffNull, buffNull } = recruit.team == 1 ? team1bonus : team2bonus;

      // calculate this recruit's action
      
      let attacks = [], shifts = [];

      // they can't attack if they're dead
      if(!recruit.rec.living())
        continue;

      let kills = [];

      // go through all the possible targets
      for(let j = 0; j < livingRecruits.length; j++) {
        let other = livingRecruits[j];

        // can't attack yourself or a dead person
        if(other.team == recruit.team || !other.rec.living()) continue;

        // found my target
        if(other.id == recruit.moveTarget) {
          if(!other.rec.living())
            continue;

          let baseDamage = recruit.attack; // base attack

          // add team based attack damage
          baseDamage += recruit.team == 1 ? team1bonus.attack : team2bonus.attack;

          // add multiplers for defense
          baseDamage *= other.mods[recruit.rec.class] || 1;

          // Apply motivated buff
          if(types[recruit.rec.type].meta.buffs.motivated && recruit.rec.ability && !debuffNull) {
            let livingAllies = this[`player${recruit.team}`].classes.filter(r => r.living()).length;
            baseDamage *= 1 + (livingAllies - 1) * types[recruit.rec.type].meta.buffs.motivated;
          }

          // Apply vengeful buff
          if(types[recruit.rec.type].meta.buffs.vengeful && recruit.rec.ability && !debuffNull) {
            let livingAllies = this[`player${recruit.team}`].classes.filter(r => r.living()).length;
            baseDamage *= 1 + (2 - (livingAllies - 1)) * types[recruit.rec.type].meta.buffs.vengeful;
          }

          // Avenge buff
          if(types[recruit.rec.type].meta.buffs.avenge && recruit.rec.ability && !debuffNull &&
              other.moveType === 'attack' && other.moveTarget !== recruit.id) {
            baseDamage *= 1 + types[recruit.rec.type].meta.buffs.avenge;
          }

          // ceil the damage
          baseDamage = Math.ceil(baseDamage);

          // subtract it
          damage += baseDamage;
          other.rec.health -= baseDamage;
          // Handle changing of colors for chameleon ability
          if(types[other.rec.type].meta.buffs.cameleon && other.rec.ability) {
            other.rec.class = recruit.rec.class;
            shifts.push({target: other.rec.id, class: recruit.rec.class});
          }

          if(!other.rec.living())
            kills.push([j, other.rec.health + baseDamage]);

          // log the damage
          attacks.push({
            target: other.id,
            damage: baseDamage
          });
        } else if(recruit.rec.type === '122' && recruit.rec.ability && !debuffNull) { // striker does splash damage when ability is activated
          if(other.rec.health <= 0)
            continue;
          // subtract the splash damage
          damage += 10;
          other.rec.health -= 10;
          // Handle changing of colors for chameleon ability
          if(types[other.rec.type].meta.buffs.cameleon && other.rec.ability) {
            other.rec.class = recruit.rec.class;
            shifts.push({target: other.rec.id, class: recruit.rec.class});
          }

          if(!other.rec.living())
            kills.push([j, other.rec.health + 10]);

          // log the damage
          attacks.push({
            target: other.id,
            damage: 10
          });
        }
      }

      // log the attack
      this.log({team: 0, type: 'attack', value: {attacker: recruit.id, attacks, shifts}});

      // Loop through the killing blows
      _.each(_.uniq(kills).map(([j, dmg]) => [livingRecruits[j], dmg]), ([other, dmg]) => {
        // Check what nullifications we are applying
        let { martyrdom, resurrect } = types[other.rec.type].meta.buffs;

        if(!debuffNull && martyrdom && other.rec.ability) {
          let payback = Math.ceil(dmg * martyrdom);
          let attacks = [], shifts = [];
          let team = this[`player${recruit.team}`];

          // Deal payback damage to the attacking team
          for(let i = 0; i < team.classes.length; i++) {
            let r = team.classes[i];
            if(r.living()) {
              r.health -= payback;
              // Handle changing of colors for chameleon ability
              if(types[r.type].meta.buffs.cameleon && r.ability) {
                r.class = recruit.rec.class;
                shifts.push({target: r.id, class: recruit.rec.class});
              }
              damage += payback;
              attacks.push({
                target: r.id,
                damage: payback,
              });
            }
          }

          // Log damage done as payback
          this.log({team: 0, type: 'attack', value: {attacker: other.id, attacks, shifts}});
        }

        // heal allies based on resurrect buff
        if(!(other.team == 1 ? team1bonus : team2bonus).buffNull && resurrect && other.rec.ability) {
          let healing = Math.ceil(dmg * resurrect);
          this.log({team: other.team, type: 'heal', value: healing});
          let team = this[`player${other.team}`];

          // heal your resurrection amount
          for(let i = 0; i < team.classes.length; i++) {
            let r = team.classes[i];
            if(r.living()) {
              r.health += healing;

              // cap health at max
              r.health = Math.min(r.maxHealth, r.health);
            }
          }
        }
      });
    }


    this.time = BASE_TIME;
    this.emitLogs();

    let alive = false;
    // remove negative health and remove it from damage for team 1
    // also check for any living recruits
    for(let i = 0; i < this.player1.classes.length; i++) {
      let recruit = this.player1.classes[i];
      if(!recruit.living()) {
        damage += recruit.health;
        recruit.health = 0;
      } else {
        alive = true;
      }
    }


    // player 2 won
    if(!alive) {
      this.end(2, "You're Bad", "Good Job", false);
      return;
    }

    // remove negative health and remove it from damage for team 2
    // also check for living recruits
    alive = false;
    for(let i = 0; i < this.player2.classes.length; i++) {
      let recruit = this.player2.classes[i];
      if(!recruit.living()) {
        damage += recruit.health;
        recruit.health = 0;
      } else {
        alive = true;
      }
    }

    // player 1 won
    if(!alive) {
      this.end(1, "Good Job", "You're Bad", false);
      return;
    }

    let ip = DEFAULT_IP + Math.floor(damage * settings.ipModifier);
    this.player1.ip = ip;
    this.player1.ready = false;
    this.player2.ip = ip;
    this.player2.ready = false;

    this.startPrep();

  }

  startPrep() {
    this.player1.ready = false;
    this.player2.ready = false;
    this.state = 'prep';

    let player1State = {
      classes: this.player1.classes.map(a => a.blob()),
      ip: this.player1.ip,
      round: this.rounds,
    };
    let player2State = {
      classes: this.player2.classes.map(a => a.blob()),
      ip: this.player2.ip,
      round: this.rounds,
    };

    this.player1.socket.emit('prep', player1State, player2State);
    this.player2.socket.emit('prep', player2State, player1State);
  }

  // tell the players what comes next
  nextRound() {
    this.player1.ready = false;
    this.player1.ip = DEFAULT_IP;
    this.player2.ready = false;
    this.player2.ip = DEFAULT_IP;
    this.state = 'round';
    this.rounds++;

    this.time = BASE_TIME;

    this.newLog();


    let player1State = {
      classes: this.player1.classes.map(a => a.blob()),
      ip: this.player1.ip,
      round: this.rounds,
    };

    let player2State = {
      classes: this.player2.classes.map(a => a.blob()),
      ip: this.player2.ip,
      round: this.rounds,
    };

    this.log({team: 1, type: 'state', value: player1State.classes});
    this.log({team: 2, type: 'state', value: player2State.classes});

    this.addBuffs();

    this.player1.socket.emit('round', player1State, player2State);
    this.player2.socket.emit('round', player2State, player1State);
  }

  // starting a new game
  start() {
    this.time = BASE_TIME;
    this.player1.socket.emit('setup', this.player2.name);
    this.player2.socket.emit('setup', this.player1.name);
  }

  tickDown() {
    if(this.time > 0) {
      this.time -= 1;

      if(this.time <= 0) {
        this.time = 0;
        switch(this.state) {
        case 'setup':
          if(this.player1.ready && !this.player2.ready) {
            this.end(1, 'Opponent Took Too Long', 'You Took Too Long', true);
          } else if(this.player2.ready && !this.player1.ready) {
            this.end(2, 'You Took Too Long', 'Opponent Took Too Long', true);
          } else {
            this.end(0, 'You Took Too Long', 'You Took Too Long', true);
          }
          break;
        case 'round':
          if(!this.player1.ready)
            this.player1.options = [];

          if(!this.player2.ready)
            this.player2.options = [];


          this.runRound();
          break;
        case 'prep':

          this.nextRound();
          break;
        }
      }
    }
  }
};