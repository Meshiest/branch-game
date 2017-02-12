const fs = require("fs");

class Recruit {
  constructor(type, tier, speed) {
    this.type = type;
    this.typeid = typeid;
    this.tier = tier;
    this.speed = speed;
  }
}

module.exports = class {
  constructor(id, player1, player2) {
    console.log("GAME",player1, player2);
    this.player1 = player1;
    player1.game = id;
    player1.ready = false;
    this.player2 = player2;
    player2.game = id;
    player2.ready = false;
    this.log = [];
    this.id = id;
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
  ready(player, isReady, classes) {
    player.ready = isReady;
    player.classes = classes;

    if(this.player1.ready && this.player2.ready) {
      this.player1.socket.emit('start', );
    }
  }

  // starting a new game
  start() {
    this.emit('setup');
    console.log('Starting for', this.player1.id, this.player2.id);
  }
};