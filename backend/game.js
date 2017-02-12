const fs = require("fs");

const types = JSON.parse(fs.readFileSync("json/branch.json")).types;
const settings = JSON.parse(fs.readFileSync("json/settings.json"));

class Recruit {
  constructor(type, index, player) {
    var typeConv = {
      "future": "100",
      "feudal": "200",
      "fantasy": "300"
    };
    var base = types[typeConv[type]];
    this.ability = false;
    this.id = player + index;
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
      sprite: this.sprite
    };
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

    if(this.player1.ready && this.player2.ready) {
      this.runRound();
    }
  }

  runRound() {
    
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