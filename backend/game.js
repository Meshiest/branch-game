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
    this.player1 = player1;
    player1.game = id;
    player1.ready = false;
    player1.ip = 0;
    this.player2 = player2;
    player2.game = id;
    player2.ready = false;
    player2.ip = 0;
    this.logs = [[]];
    this.id = id;
    this.rounds = 0;
    this.state = 'setup';
  }

  log(msg) {
    this.logs[this.logs.length-1].push(msg);
  }

  // sorry guy :(
  // game has ended or someone has left
  end(winner, reason1, reason2) {
    this.player1.game = -1;
    this.player2.game = -1;
    this.player1.socket.emit('done', reason1);
    this.player2.socket.emit('done', reason2);
    this.onDone(winner);
  }

  // emit to messages
  emit(callback) {
    this.player1.socket.emit(...arguments);
    this.player2.socket.emit(...arguments);
  }

  // ready up a player
  readySetup(player, isReady, classes) {
    player.ready = isReady;

    var num = (player == this.player1) ? "1" : "2";
    console.log('player ',num,'is readying up',player.ready);
    player.classes = classes.map((type, i)=>{return new Recruit(type, i, num);});

    if(this.player1.ready && this.player2.ready) {
      this.player1.ready = false;
      this.player2.ready = false;
      this.nextRound();
    }
  }

  readyRound(player, isReady, options) {
    player.ready = isReady;
    player.options = options;

    console.log('player',player == this.player1 ? "1" : "2",'is ready');
    if(this.player1.ready && this.player2.ready) {
      console.log('running round');
      this.runRound();
    }
  }
  
  // please don't reverse engineer this please
  upgradePrep(player, action) {
    if(player.ip === 0) return;
    player.ready = false;
    if(action.target < 0 || action.target > 2) return;
    var target = player.classes[action.target];
    if(!target.living()) return;
    console.log("upgrading", player == this.player1 ? "1" : "2");

    if(action.type == 'upgrade') {
      // we can't go there
      if(!target.evolutions.includes(action.next))
        return;
      target.applySpecs(types[action.next]);
      player.ip --;
    } else if(action.type == 'power' && !target.ability) {
      target.ability = true;
      player.ip --;
    }

    player.socket.emit('update', {
      classes: player.classes.map((a)=>{return a.blob();}),
      ip: player.ip,
      round: this.rounds,
    });
  }

  addBuffs() {
    // add health from dragon tamers lol
    var team1Health = 0;
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(recruit.living() && recruit.ability) {
        team1Health += types[recruit.type].meta.buffs.ownHp;
      }
    }
    if(team1Health) {
      this.log({team: 1, heal: team1Health});
    }
    for(var i = 0; i < this.player1.classes.length; i++) {
      var recruit = this.player1.classes[i];
      if(recruit.living()) {
        recruit.health += team1Health;
        recruit.health = Math.min(recruit.maxHealth, recruit.health);
      }
    }
    
    var team2Health = 0;
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(recruit.living() && recruit.ability) {        
        team2Health += types[recruit.type].meta.buffs.ownHp;
      }
    }
    if(team2Health) {
      this.log({team: 2, heal: team2Health});
    }
    for(var i = 0; i < this.player2.classes.length; i++) {
      var recruit = this.player2.classes[i];
      if(recruit.living()) {
        recruit.health += team2Health;
        recruit.health = Math.min(recruit.maxHealth, recruit.health);
      }
    }

  }

  readyPrep(player, isReady) {
    player.ready = isReady;
    console.log('player is ', player == this.player1 ? "1" : "2");
    console.log('player is ready', this.player1.ready, this.player2.ready);
    if(this.player1.ready && this.player2.ready) {
      console.log('running round');
      this.addBuffs();
      this.nextRound();
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
        console.log("debuff checking team1", team2bonus);
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
        console.log("debuff checking team1", team1bonus);
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
        console.log('has ability');
        if(!team1bonus.buffNull) {
          
          team1bonus.speed += types[recruit.type].meta.buffs.ownSpd || 0;
          team1bonus.attack += types[recruit.type].meta.buffs.ownAtk || 0;
        }
        if(!team1bonus.debuffNull) {
          team2bonus.speed += types[recruit.type].meta.buffs.offSpd || 0;
          team2bonus.attack += types[recruit.type].meta.buffs.offAtk || 0;
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
        console.log('has ability');
        if(!team2bonus.buffNull) {
          team2bonus.speed += types[recruit.type].meta.buffs.ownSpd || 0;
          team2bonus.attack += types[recruit.type].meta.buffs.ownAtk || 0;
        }
        if(!team2bonus.debuffNull) {
          team1bonus.speed += types[recruit.type].meta.buffs.offSpd || 0;
          team1bonus.attack += types[recruit.type].meta.buffs.offAtk || 0;
        }
      }
    }
    console.log("team1 bonuses", team1bonus);
    console.log("team2 bonuses", team2bonus);

    // handle defending
    for(var i = 0; i < recruits.length; i++) {
      var recruit = recruits[i];
      if(!recruit.rec.living() || recruit.moveType != 'defend' ) continue;
      // provoking and using ability
      if(recruit.rec.ability && types[recruit.rec.type].meta.buffs.provoke) {
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
            recruit.mods.provoke = true;
          } else {
            if(other.mods.provoke || other.mods.provoked) continue;
            // don't effect other provoked great knights that are defending and provoking
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
    for(var i = 0; i < queueLineup.length; i++) {
      var recruit = queueLineup[i];
      if(recruit.moveType == 'defend') {
        queueLineup.splice(i--, 1);
        continue;
      }

      // apply bonuses
      if(recruit.team == 1) {
        console.log(recruit.speed,"bonus",team1bonus.speed);
        recruit.speed += team1bonus.speed || 0;
      }
      if(recruit.team == 2) {
        console.log(recruit.speed,"bonus",team1bonus.speed);
        recruit.speed += team2bonus.speed || 0;
      }

      // remove and append first in queue
      if(recruit.priority) {
        console.log(recruit.id,'(',types[recruit.rec.type].displayName,')',' priority');
        queue[queue.length-1].push(queueLineup.splice(i--, 1)[0]);
        console.log(queueLineup.length, "vs" + livingRecruits.length);
      }
    }
    // shuffle priority recruits
    shuffle(queue[queue.length-1]);

    // until we have recruits left
    while(queueLineup.length) {
      console.log(queueLineup.length,'lineup vs recruits', livingRecruits.length);
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
          console.log(recruit.id,'(',types[recruit.rec.type].displayName,')',' speed = ',max);
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
        console.log("striker?", recruit.rec.type, types[recruit.rec.type].displayName, recruit.rec.type == "122");
        if(other.id == recruit.moveTarget) {
          var baseDamage = recruit.attack; // base attack
          // add team based attack damage
          console.log("base attack", baseDamage);
          baseDamage += recruit.team == 1 ? team1bonus.attack : team2bonus.attack;
          console.log("attack mods",recruit.team == 1 ? team1bonus.attack : team2bonus.attack);
          // add multiplers for defense
          console.log("target mods",other.mods);
          baseDamage *= other.mods[recruit.rec.class];
          console.log("mods",other.mods[recruit.rec.class]);
          baseDamage = Math.ceil(baseDamage);
          damage += baseDamage;
          other.rec.health -= baseDamage;
          console.log(recruit.id,'(',types[recruit.rec.type].displayName,')','=>',other.id, "(",types[other.rec.type].displayName,") == ", baseDamage);
        } else if(recruit.rec.type == "122") { // striker does splash damage
          console.log("splash damage");
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
      this.end(2, "You're Bad", "Good Job");
      return;
    }
    var alive = false;
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
      this.end(1, "Good Job", "You're Bad");
      return;
    }

    var ip = Math.floor(damage * settings.ipModifier);
    console.log("IP is ", ip, "from", damage ,"damage");
    this.player1.ip = ip;
    this.player1.ready = false;
    this.player2.ip = ip;
    this.player2.ready = false;
    this.startPrep();

  }

  startPrep() {
    console.log('readys', this.player1.ready, this.player2.ready);
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
    console.log('readys round', this.player1.ready, this.player2.ready);
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
    this.player1.socket.emit('round', player1State, player2State);
    this.player2.socket.emit('round', player2State, player1State);
  }

  // starting a new game
  start() {
    this.player1.socket.emit('setup', this.player2.name);
    this.player2.socket.emit('setup', this.player1.name);
    console.log('Starting for', this.player1.name, this.player1.id, ",", this.player2.id, this.player2.name);
  }
};