'use-strict';
const fs = require("fs");

const types = JSON.parse(fs.readFileSync("json/branch.json"));
const settings = JSON.parse(fs.readFileSync("json/settings.json"));

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items The array containing the items.
 */
function shuffle(a) {
  for (let i = a.length; i; i--) {
    let j = Math.floor(Math.random() * i);
    [a[i - 1], a[j]] = [a[j], a[i - 1]];
  }
}

const typeConv = {
  "future": "100",
  "feudal": "200",
  "fantasy": "300"
};

class Recruit {
  constructor(type, index, player) {
    
    var base = types[typeConv[type]];
    this.ability = false;
    this.type = typeConv[type];
    this.id = player + index;
    this.player = player;
    this.index = index;
    this.health = 0;
    this.maxHealth = 0;
    this.applySpecs(base);
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
    for(var id in types) {
      var type = types[id];
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
    player1.ip = 0;

    // player2 defaults
    this.player2 = player2;
    player2.game = id;
    player2.ready = false;
    player2.ip = 0;

    this.logs = [];
    this.id = id;
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

  // game has ended or someone has left
  end(winner, reason1, reason2) {
    this.player1.game = -1;
    this.player2.game = -1;
    this.player1.socket.emit('done', reason1);
    this.player2.socket.emit('done', reason2);
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

    var num = (player == this.player1) ? "1" : "2";

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

    var target = player.classes[action.target];

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
    var team1Health = 0;
    var team2Health = 0;

    // calculate total healing done by team 1
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(recruit.living() && recruit.ability) {
        team1Health += types[recruit.type].meta.buffs.ownHp;
      }
    }

    // log healing done by team 1
    if(team1Health) { 
      this.log({team: 1, type: "heal", heal: team1Health});
    }

    // heal team 1
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(recruit.living()) {
        recruit.health += team1Health;

        // cap health at max
        recruit.health = Math.min(recruit.maxHealth, recruit.health);
      }
    }
    
    // calculate total healing done by team 2
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(recruit.living() && recruit.ability) {        
        team2Health += types[recruit.type].meta.buffs.ownHp;
      }
    }
    
    // log healing done by team 2
    if(team2Health) {
      this.log({team: 2, type: "heal", heal: team2Health});
    }

    // heal team 2
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(recruit.living()) {
        recruit.health += team2Health;

        // cap health at max
        recruit.health = Math.min(recruit.maxHealth, recruit.health);
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

  // runs calculations for the entire round
  runRound() {

    // create bonus information that will be applied to each recruit
    var team1bonus = {
      speed: 0,
      attack: 0,
      debuffNull: false,
      buffNull: false
    };
    var team2bonus = {
      speed: 0,
      attack: 0,
      debuffNull: false,
      buffNull: false
    };

    // find team 1 recruits that are debuff and buff nulling
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(!recruit.living()) continue;
      if(recruit.ability) {        
        if(types[recruit.type].meta.buffs.debuffNull)
          team2bonus.debuffNull = true;
        if(types[recruit.type].meta.buffs.buffNull)
          team2bonus.buffNull = true;
      }
    }

    // find team 2 recruits that are debuff and buff nulling
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(!recruit.living()) continue;

      if(recruit.ability) {
        if(types[recruit.type].meta.buffs.debuffNull) 
          team1bonus.debuffNull = true;
        if(types[recruit.type].meta.buffs.buffNull)
          team1bonus.buffNull = true;
      }
    }

    var recruits = [];

    // apply all buffs and debuffs when applicable
    // also store basic information for tracking damage and speed
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];

      // constuct some basic information that is useful for computing new speeds and attacks
      var blob = {
        rec: recruit,
        id: recruit.id,
        team: 1,
        speed: recruit.speed,
        attack: recruit.attack,
        priority: recruit.ability && types[recruit.type].meta.buffs.priority,
        health: recruit.health,
        mods: {
          "future": settings.mods[recruit.class].future,
          "feudal": settings.mods[recruit.class].feudal,
          "fantasy": settings.mods[recruit.class].fantasy
        }
      };

      // find if the recruit was defending or attacking and its target
      var opts = this.player1.options;
      for(var j = 0; j < opts.length; j++) {
        if(opts[i].id == recruit.id) {
          blob.moveType = opts[i].moveType;
          if(blob.moveType == 'attack')
            blob.moveTarget = opts[i].moveTarget;
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
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];

      // constuct some basic information that is useful for computing new speeds and attacks
      var blob = {
        rec: recruit,
        id: recruit.id,
        team: 2,
        speed: recruit.speed,
        attack: recruit.attack,
        priority: recruit.ability && types[recruit.type].meta.buffs.priority,
        health: recruit.health,
        mods: {
          "future": settings.mods[recruit.class].future,
          "feudal": settings.mods[recruit.class].feudal,
          "fantasy": settings.mods[recruit.class].fantasy
        }
      };

      // find if the recruit was defending or attacking and its target
      var opts = this.player2.options;
      for(var j = 0; j < opts.length; j++) {
        if(opts[i].id == recruit.id) {
          blob.moveType = opts[i].moveType;
          if(blob.moveType == 'attack')
            blob.moveTarget = opts[i].moveTarget;
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

    // log the team bonuses
    this.log({team: 1, type: "bonus", bonus: team1bonus});
    this.log({team: 2, type: "bonus", bonus: team2bonus});

    var defenders = [];
    // handle defending
    for(var i = 0; i < recruits.length; i++) {
      var recruit = recruits[i];

      // only iterate through living and defending recruits
      if(!recruit.rec.living() || recruit.moveType != 'defend' ) continue;

      // add the player to the list of defenders
      defenders.push(recruit.id);

      // apply provoking defense when using ability
      if(recruit.rec.ability && types[recruit.rec.type].meta.buffs.provoke) {
        for(var j = 0; j < recruits.length; j++) {
          var other = recruits[j];

          // effect same team only
          if(other.team != recruit.team)
            continue;

          // great knight effect self
          if(other.id == recruit.id) {
            recruit.mods.feudal = 1;
            recruit.mods.future = 1;
            recruit.mods.fantasy = 1;
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
              other.mods.provoked = true;
            }
          }
        }
      } else { // regular defending
        recruit.mods.feudal = 0.666;
        recruit.mods.future = 0.666;
        recruit.mods.fantasy = 0.666;
        recruit.mods.defend = true;
      } 
    }

    // log all the defending recruits
    this.log({team: 0, type: "defend", defenders: defenders});

    // compute attack order
    var queue = [[]];

    // get all the living recruits
    var livingRecruits = [];
    for(var i = 0; i < recruits.length; i++) {
      if(recruits[i].rec.living()) {
        livingRecruits.push(recruits[i]);
      }
    }

    // duplicate the living recruits queue
    var queueLineup = [].concat(livingRecruits);
    for(var i = 0; i < queueLineup.length; i++) {
      var recruit = queueLineup[i];

      // remove defending recruits from the queue
      // this queue will be used for attacking recruits only
      if(recruit.moveType == 'defend') {
        queueLineup.splice(i--, 1);
        continue;
      }

      // apply speed bonuses from each respective team
      if(recruit.team == 1) {
        recruit.speed += team1bonus.speed || 0;
      }
      if(recruit.team == 2) {
        recruit.speed += team2bonus.speed || 0;
      }

      // make sure the recruit with priority is always placed first
      if(recruit.priority) {
        queue[queue.length-1].push(queueLineup.splice(i--, 1)[0]);
      }
    }
    // shuffle priority recruits
    shuffle(queue[queue.length-1]);

    // until we have recruits left
    while(queueLineup.length) {
      
      // find max recruit speed
      var max = 0;
      for(var i = 0; i < queueLineup.length; i++) {
        var recruit = queueLineup[i];
        if(recruit.speed > max)
          max = recruit.speed;
      }

      // create a new speed group
      queue.push([]);

      // add recruits of the max speed to their own group
      for(var i = 0; i < queueLineup.length; i++) {
        var recruit = queueLineup[i];
        if(recruit.speed == max) {
          // remove the recruit from the queue so it can't be used twice
          queue[queue.length-1].push(queueLineup.splice(i--, 1)[0]);
        }
      }
      // shuffle speed group
      shuffle(queue[queue.length-1]);
    }

    // finalized queue of all 
    var arr = [];
    while(queue.length) {
      arr = arr.concat(queue.splice(0, 1)[0]);
    }
    queue = arr;
    var damage = 0;

    // loop through all attackers
    for(var i = 0; i < queue.length; i++) {
      var recruit = queue[i];
      // calculate this recruit's action
      
      var attacks = [];

      // they can't attack if they're dead
      if(!recruit.rec.living())
        continue;

      // go through all the possible targets
      for(var j = 0; j < livingRecruits.length; j++) {
        var other = livingRecruits[j];

        // can't attack yourself or a dead person
        if(other.team == recruit.team || !other.rec.living()) continue;

        // found my target
        if(other.id == recruit.moveTarget) {
          var baseDamage = recruit.attack; // base attack

          // add team based attack damage
          baseDamage += recruit.team == 1 ? team1bonus.attack : team2bonus.attack;

          // add multiplers for defense
          baseDamage *= other.mods[recruit.rec.class];

          // ceil the damage
          baseDamage = Math.ceil(baseDamage);

          // subtract it
          damage += baseDamage;
          other.rec.health -= baseDamage;

          // log the damage
          attacks.push({
            target: other.id,
            damage: baseDamage
          });
        } else if(recruit.rec.type == "122" && recruit.rec.ability) { // striker does splash damage when ability is activated
          // subtract the splash damage
          damage += 10;
          other.rec.health -= 10;

          // log the damage
          attacks.push({
            target: other.id,
            damage: 10
          });
        }
      }

      // log the attack
      this.log({team: 0, type: "attack", attacker: recruit.id, attacks: attacks});

    }

    var alive = false;
    // remove negative health and remove it from damage for team 1
    // also check for any living recruits
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(!recruit.living()) {
        damage += recruit.health;
        recruit.health = 0;
      } else {
        alive = true;
      }
    }
    // player 2 won
    if(!alive) {
      this.end(2, "You're Bad", "Good Job");
      return;
    }

    // remove negative health and remove it from damage for team 2
    // also check for living recruits
    alive = false;
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(!recruit.living()) {
        damage += recruit.health;
        recruit.health = 0;
      } else {
        alive = true;
      }
    }

    // player 1 won
    if(!alive) {
      this.end(1, "Good Job", "You're Bad");
      return;
    }

    var ip = Math.floor(damage * settings.ipModifier);
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
    var player1State = {
      classes: this.player1.classes.map((a)=>{return a.blob();}),
      ip: this.player1.ip,
      round: this.rounds,
    };
    var player2State = {
      classes: this.player2.classes.map((a)=>{return a.blob();}),
      ip: this.player2.ip,
      round: this.rounds,
    };

    this.player1.socket.emit('prep', player1State, player2State);
    this.player2.socket.emit('prep', player2State, player1State);
  }

  // tell the players what comes next
  nextRound() {
    this.player1.ready = false;
    this.player1.ip = 0;
    this.player2.ready = false;
    this.player2.ip = 0;
    this.state = 'round';
    this.rounds++;

    var player1State = {
      classes: this.player1.classes.map((a)=>{return a.blob();}),
      ip: this.player1.ip,
      round: this.rounds,
    };
    var player2State = {
      classes: this.player2.classes.map((a)=>{return a.blob();}),
      ip: this.player2.ip,
      round: this.rounds,
    };

    this.newLog();
    this.addBuffs();
    this.log({team: 1, type: "state", state: player1State.classes});
    this.log({team: 2, type: "state", state: player2State.classes});

    this.player1.socket.emit('round', player1State, player2State);
    this.player2.socket.emit('round', player2State, player1State);
  }

  // starting a new game
  start() {
    this.player1.socket.emit('setup', this.player2.name);
    this.player2.socket.emit('setup', this.player1.name);
  }
};