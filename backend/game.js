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

class Recruit {
  constructor(type, index, player) {
    var typeConv = {
      "future": "100",
      "feudal": "200",
      "fantasy": "300"
    };
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
    this.player1 = player1;
    player1.game = id;
    player1.ready = false;
    player1.ip = 0;
    this.player2 = player2;
    player2.game = id;
    player2.ip = 0;
    this.log = [];
    this.id = id;
    this.rounds = 0;
    this.state = 'setup';
  }

  // sorry guy :(
  // game has ended or someone has left
  end(reason) {
    this.player1.game = -1;
    this.player2.game = -1;
    this.emit('done', reason);
  }

  // emit to messages
  emit(callback) {
    this.player1.socket.emit(...arguments);
    this.player2.socket.emit(...arguments);
  }

  // ready up a player
  readySetup(player, isReady, classes) {
    player.ready = isReady;
    var num = player == this.player1 ? "1" : "2";
    player.classes = classes.map((type, i)=>{return new Recruit(type, i, num);});

    if(this.player1.ready && this.player2.ready) {
      this.nextRound();
    }
  }

  readyRound(player, isReady, options) {
    player.ready = isReady;
    player.options = options;

    console.log('player is ready');
    if(this.player1.ready && this.player2.ready) {
      console.log('running round');
      this.runRound();
    }
  }

  runRound() {
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

    // check if we have any buff nuls
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
    // apply all buffs and debuffs
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];

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
      console.log('adding ', recruits.length);

      if(!recruit.living()) continue;
      if(recruit.ability) {
        if(!team1bonus.buffNull) {
          team1bonus.speed += recruit.ownSpd;
          team1bonus.attack += recruit.ownAtk;
        }
        if(!team1bonus.debuffNull) {
          team2bonus.speed += recruit.offSpd;
          team2bonus.attack += recruit.offAtk;
        }
      }
    }
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];

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
      console.log('adding ', recruits.length);

      if(!recruit.living()) continue;
      if(recruit.ability) {
        if(!team2bonus.buffNull) {
          team2bonus.speed += recruit.ownSpd;
          team2bonus.attack += recruit.ownAtk;
        }
        if(!team2bonus.debuffNull) {
          team1bonus.speed += recruit.offSpd;
          team1bonus.attack += recruit.offAtk;
        }
      }
    }

    // handle defending
    for(var i = 0; i < recruits.length; i++) {
      var recruit = recruits[i];
      if(!recruit.rec.living() || recruit.moveType != 'defend' ) continue;
      // provoking and using ability
      if(recruit.rec.ability && types[recruit.type].meta.buffs.provoke) {
        for(var j = 0; j < recruits.length; j++) {
          var other = recruits[j];
          // same team only
          if(other.team != recruit.team)
            continue;
          // effect self
          if(other.id == recruit.id) {
            recruit.mods.feudal = 1;
            recruit.mods.future = 1;
            recruit.mods.fantasy = 1;
          } else {
            // don't effect other provoked great knights that are defending and provoking
            if(!(other.rec.ability && types[other.rec.type].meta.buffs.provoke && recruit.moveType == 'defend')) {
              recruit.mods.feudal = 0.666;
              recruit.mods.future = 0.666;
              recruit.mods.fantasy = 0.666;
            }
          }
        }
      } else { // regular defending
        recruit.mods.feudal = 0.666;
        recruit.mods.future = 0.666;
        recruit.mods.fantasy = 0.666;
      } 
    }

    // compute attack order
    var queue = [[]];

    // get all the living recruits
    var livingRecruits = [];
    for(var i = 0; i < recruits.length; i++) {
      if(recruits[i].rec.living()) {
        livingRecruits.push(recruits[i]);
      }
    }
    var queueLineup = [].concat(livingRecruits);
    console.log(queueLineup.length, "vs" + livingRecruits.length);
    for(var i = 0; i < queueLineup.length; i++) {
      var recruit = queueLineup[i];
      if(recruit.moveType == 'defend') {
        queueLineup.splice(i--, 1);
        continue;
      }

      // apply bonuses
      if(recruit.team == 1) {
        recruit.speed += team1bonus.speed;
        recruit.attack += team1bonus.attack;
      }
      if(recruit.team == 2) {
        recruit.speed += team2bonus.speed;
        recruit.attack += team2bonus.attack;
      }

      // remove and append first in queue
      if(recruit.priority) {
        queue[queue.length-1].push(queueLineup.splice(i--, 1)[0]);
        console.log(queueLineup.length, "vs" + livingRecruits.length);
      }
    }
    // shuffle priority recruits
    shuffle(queue[queue.length-1]);

    // until we have recruits left
    while(queueLineup.length) {
      console.log(queueLineup.length,'lineup vs recruits', livingRecruits.length)
      // find max recruit speed
      var max = 0;
      for(var i = 0; i < queueLineup.length; i++) {
        var recruit = queueLineup[i];
        if(recruit.speed > max)
          max = recruit.speed;
      }
      queue.push([]);
      console.log('max is ', max);
      // add recruits to speed groups
      for(var i = 0; i < queueLineup.length; i++) {
        var recruit = queueLineup[i];
        if(recruit.speed == max) {
          console.log('found', recruit.id, 'targeting', recruit.moveTarget);
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

    for(var i = 0; i < queue.length; i++) {
      var recruit = queue[i];
      console.log('queue on', recruit.id);
      // calculate this recruit's action
      
      if(!recruit.rec.living())
        continue;
      console.log('living',livingRecruits.length);

      for(var j = 0; j < livingRecruits.length; j++) {
        var other = livingRecruits[j];
        if(other.team == recruit.team || !other.rec.living()) continue;
        if(other.id == recruit.moveTarget) {
          console.log('targeting',other.id,'(',recruit.moveTarget,')','from',recruit.id);
          var baseDamage = recruit.attack; // base attack
          // add team based attack damage
          baseDamage += recruit.team == 1 ? team1bonus.attack : team2bonus.attack;
          // add multiplers for defense
          baseDamage *= other.mods[recruit.rec.class];
          baseDamage = Math.ceil(baseDamage);
          damage += baseDamage;
          other.rec.health -= baseDamage;
        } else if(recruit.rec.type == "111") { // striker does splash damage
          damage += 10;
          other.rec.health -= 10;
        }
      }
    }

    var alive = false;
    // remove negative health and remove it from damage
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(!recruit.living()) {
        damage += recruit.health;
        recruit.health = 0;
      } else {
        alive = true;
      }
      console.log(recruit.id+": "+recruit.health+" ("+recruit.class+")");
    }
    if(!alive) {
      console.log('no player1 alive')
      this.end("win player2");
      return;
    }
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(!recruit.living()) {
        damage += recruit.health;
        recruit.health = 0;
      } else {
        alive = true;
      }
      console.log(recruit.id+": "+recruit.health+" ("+recruit.class+")");
    }
    if(!alive) {
      console.log('no player2 alive')
      this.end("win player1");
      return;
    }

    var ip = Math.floor(damage * settings.ipModifier);
    console.log("IP is ", ip, "from", damage ,"damage");

    this.nextRound();

  }

  // tell the players what comes next
  nextRound() {
    this.player1.ready = false;
    this.player2.ready = false;
    this.state = 'round';
    this.rounds++;
    var player1State = {
      classes: this.player1.classes.map((a)=>{return a.blob();}),
      ip: this.player1.ip
    };
    var player2State = {
      classes: this.player2.classes.map((a)=>{return a.blob();}),
      ip: this.player2.ip
    };
    this.player1.socket.emit('round', player1State, player2State);
    this.player2.socket.emit('round', player2State, player1State);
  }

  // starting a new game
  start() {
    this.emit('setup');
    console.log('Starting for', this.player1.id, this.player2.id);
  }
};