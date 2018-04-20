'use-strict';

const express = require('express');
const bodyParser = require('body-parser');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
const expressSession = require('express-session');
const RedisStore = require('connect-redis')(expressSession);
const mysql = require('mysql');
const fs = require('fs');
const crypto = require('crypto');
const redis = require('redis');
const base64url = require('base64url');
const Game = require('./game.js');
const sharedsession = require("express-socket.io-session");
const _ = require("underscore");

const types = JSON.parse(fs.readFileSync("json/branch.json"));


const SECRET = process.env.HASH_SECRET;
const SALT_SIZE = 32; // salt is 32 bytes
const MIN_PASSWORD_LENGTH = 6; // salt is 32 bytes
const port = 8080;
const version = "1.3.6";

var session = expressSession({
  secret: SECRET,
  saveUninitialized: true,
  resave: false,
  store: new RedisStore({
    host: 'redis',
  }),
});

io.use(sharedsession(session, {
    autoSave:true
})); 

app.set('trust proxy', 1);
app.use(bodyParser.json());
app.use(session);

const MYSQL_CONF = {
  host: "mysql",
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
};

// Database query
function dbQuery(callback) {
  var connection = mysql.createConnection(MYSQL_CONF);
  callback(connection);
  connection.end();
}

// creates salt for password hashing
function createSalt() {
  return crypto
    .randomBytes(Math.ceil(SALT_SIZE/2))
    .toString('hex');
}

// hashes the password with a salt using sha512
function hashSha512Password(salt, password) {
  var hash = crypto.createHmac('sha512', salt);
  hash.update(password);
  return hash.digest('hex');
}

// hashes the password with a salt using pbkdf2
function hashPbkdf2Password(salt, password) {
  var hash = crypto.pbkdf2Sync(password, salt, 100000, 512, 'sha512');
  return hash.toString('hex');
}

// creates a game data entry for a user if it doesn't already exist
function createUserGameData(name) {
  dbQuery((db) => {
    db.query(`
      INSERT INTO gameData (user_id) SELECT id FROM users WHERE name='`+name+`';`,
    (error, results, fields) => {
      if(error)
        console.log(error);
    });
  });
}

function updateUser(name, wins, losses, games) {
  dbQuery((db) => {
    db.query(`
      UPDATE gameData
      SET wins = wins + ` + wins + `,
      losses = losses + ` + losses + `,
      games = games + ` + games + `
      WHERE user_id=(SELECT id FROM users WHERE name='`+name+`');
    `, (error, results, fields) => {
      if(error) {
        console.log("ERROR", error);
      }
    });
  });
}

// App
app.get('/', function (req, res) {
  res.json({
    message: "Welcome to Branch API v"+version
  });
});

app.get('/types', function(req, res) {
  res.json(types);
});

app.get('/leaderboard', function(req, res) {
  dbQuery((db) => {
    db.query(`
      SELECT
      (SELECT name FROM users WHERE id=user_id) AS name,
      games,
      wins,
      losses,
      ((wins + 1.9208) / (wins + losses) - 1.96 * SQRT((wins*losses)/(wins+losses) + 0.9604)/(wins+losses))/(1+3.8416/(wins+losses)) as ci_lower_bound
      FROM gameData
      WHERE games > 0
      ORDER BY ci_lower_bound DESC
      LIMIT 10;
    `, (error, results, fields) => {
      if(error) { 
        res.status(500).json({message: 'Internal Server Error'});
      } else {
        res.json(results);
      }
    });
  });
});

app.get('/user', (req, res) => {
  var name = req.session.name;
  if(typeof name !== 'undefined') {
    res.json({name: name});
  } else {
    res.status(403).json({message: "Not Authorized"});
  }
});

// to see if you can challenge someone
app.post('/challenge', (req, res) => {
  var name = req.body.name;
  if(typeof name === 'undefined') {
    res.status(400).json({message: 'Bad Request'});
    return;
  }

  // need to be a user
  if(typeof req.session.name === 'undefined')
    return;

  name = name.toLowerCase();

  if(!name.match(/^[a-z0-9\d]{3,20}$/g)) {
    res.status(400).json({message: 'Invalid Name'});
    return;
  } 
  
  dbQuery((db) => {
    db.query("SELECT * from users WHERE name='"+name+"';", 
    (error, results, fields) => {
      if(error || !results.length) { 
        res.status(404).json({message: 'Not Found'});
      } else {
        if(results[0].name === req.session.name) {
          res.status(403).json({message: "Can't Challenge Yourself"});
        } else {
          res.json({
            name: results[0].name
          });
        }
      }
    });
  });
});

app.post('/logout', (req, res) => {
  var name = req.session.name;
  if(typeof name !== 'undefined') {
    req.session.name = undefined;
    res.json({message: 'ok'});
  } else {
    res.status(403).json({message: "Not Authorized"});
  }
});

app.post('/user', (req, res) => {
  
  var name = req.body.name;
  var password = req.body.password;
  if(typeof name === 'undefined' || typeof password === 'undefined') {
    res.status(400).json({message: 'Bad Request'});
    return;
  }

  name = name.toLowerCase();
  
  if(!name.match(/^[a-z0-9\d]{3,20}$/)) {
    res.status(400).json({message: 'Invalid Username'});
    return;
  }

  if(password.length < 6) {
    res.status(400).json({message: 'Make a Longer Password'});
    return;
  }

  var salt = createSalt();
  // default is pbkdf2
  var hash = hashPbkdf2Password(name+salt, password);

  dbQuery((db) => {

    db.query("INSERT INTO users (name,password,salt,enc_type) VALUES ('"+name+"','"+hash+"','"+salt+"','pbkdf2');",
    (error, results, fields) => {
      if(error) {
        console.log(error);
        res.status(422).json({message: "User Already Exists"});
      } else {
        createUserGameData(name);
        req.session.name = name;
        res.status(202).json({
          name: name
        });
      }
    });

  });
});

app.post('/login', (req, res) => {
  var name = req.body.name;
  var password = req.body.password;
  if(typeof name === 'undefined' || typeof password === 'undefined') {
    res.status(400).json({message: 'Bad Request'});
    return;
  }

  name = name.toLowerCase();

  if(!name.match(/^[a-z0-9\d]{3,20}$/g) || password.length < 6) {
    res.status(400).json({message: 'Invalid Credentials'});
    return;
  } 
  
  dbQuery((db) => {
    db.query("SELECT * from users WHERE name='"+name+"';", 
    (error, results, fields) => {
      if(error || !results.length) { 
        res.status(404).json({message: 'Not Found'});
      } else {
        var hash, pbhash;

        if(results[0].enc_type === 'sha512') {
          hash = hashSha512Password(results[0].name+results[0].salt, password);
          pbhash = hashPbkdf2Password(results[0].name+results[0].salt, password);
        } else {
          hash = hashPbkdf2Password(results[0].name+results[0].salt, password);
        }

        if(hash === results[0].password) {

          // the user is using an outdated hash
          if(results[0].enc_type === 'sha512') {
            
            // update user's encrypted password with something stronger
            dbQuery((db) => {
              db.query(`
                UPDATE users
                SET enc_type='pbkdf2', password='` + pbhash + `'
                WHERE name='` + name + `';
              `, (error, results, fields) => {
                if(error)
                  console.log("ERROR", error);
              });
            });
          }

          req.session.name = results[0].name;
          res.json({
            name: results[0].name
          });
        } else {
          res.status(404).json({message: 'Not Found'});
        }
      }
    });
  });
});

var players = {};
var lobby = {};
var id = 0;
var games = {};
var gameId = 0;

// finds an opponent
function findOpponent(id) {
  var keys = Object.keys(lobby);
  var myLobby = lobby[id];
  keys.splice(keys.indexOf(id+""), 1); // remove player searching

  if(!keys.length)
    return -1;

  for(var i = 0; i < keys.length; i++) {
    var otherLobby = lobby[keys[i]];

    if(myLobby.challenge != otherLobby.challenge) // clearly not doing the same thing
      continue;

    // both are challenging
    if(myLobby.challenge && otherLobby.challenge &&  // both are challenging
        myLobby.player.name === otherLobby.challenge.target && 
        otherLobby.player.name === myLobby.challenge.target) { // have eachother as target
      return keys[i];
    } else {

      // don't match with yourself if you're not a guest
      if(myLobby.player.name !== "Guest" && myLobby.player.name === otherLobby.player.name)
        continue;

      // first partner I can find
      return keys[i];
    }
  }

  return -1;
}

// handles countdowns for games
function countdownHandler() {
  var gameIds = Object.keys(games);
  for(var i = 0; i < gameIds.length; i++) {
    var id = gameIds[i];
    var game = games[id];

    if(!game)
      continue;

    game.tickDown();
  }
}

setInterval(countdownHandler, 1000);

// emit the online status to all players but throttle it
var emitOnline = function() {
  io.emit('online', {
    players: Object.keys(players).length,
    games: Object.keys(games).length,
    lobby: Object.keys(lobby).length
  });
};

emitOnline = _.throttle(emitOnline, 1000);

io.on('connection', (socket) => {
  var player = {
    socket: socket,
    id: id++,
    game: -1,
    name: socket.handshake.session.name || "Guest",
    guest: !socket.handshake.session.name,
    lastMessage: 0,
  };
  players[player.id] = player;

  // tell everyone how many players there are
  emitOnline();

  // lobby callback
  socket.on('lobby', (blob) => {
    // if the player wants to join a game
    if(blob.join) {
      // if they're not in a game or a lobby
      if(player.game < 0 && !lobby[player.id]) {
        player.game = -1;

        // if they're to challenge something they shouldn't be
        if(blob.challenge === true && 
            (blob.target == "Guest" || blob.name == "Guest" || blob.name === player.name)) { // don't challenge yourself or a guest
          blob.challenge = false;
          blob.target = "";
        }

        // create a lobby object for this player
        // this helps in matchmaking
        lobby[player.id] = {
          player: player,
          challenge: blob.challenge === true,
          target: blob.target
        };

        // find the opponent
        var opponent = findOpponent(player.id);
        while(opponent != -1 && !players[opponent]) {
          delete players[opponent];
          delete lobby[opponent];
          emitOnline();
          opponent = findOpponent(player.id);
        }

        // there is an opponent for this player
        if(opponent >= 0) {
          var id = gameId++;
          // create a new game for both players
          var game = games[id] = new Game(id, player, players[opponent]);

          game.onDone = function(winner) {
            // reset player information
            this.player1.game = -1;
            this.player1.ip = 0;
            this.player1.classes = [];

            this.player2.game = -1;
            this.player2.ip = 0;
            this.player2.classes = [];

            // neither player is a guest
            if(!(this.player1.guest || this.player2.guest)) {
              updateUser(this.player1.name,
                winner == 1 ? 1 : 0,
                winner != 1 ? 1 : 0,
              1);

              updateUser(this.player2.name,
                winner == 2 ? 1 : 0,
                winner != 2 ? 1 : 0,
              1);
            }

            // remove the game
            delete games[id];
            emitOnline();
          }.bind(game);

          // remove both players from the lobby
          delete lobby[player.id];
          delete lobby[opponent];

          // tell everyone there's someone playing a game
          emitOnline();

          // start the game
          game.start();
        } else {
          // let everyone know someone is waiting
          emitOnline();
        }
      }
    } else {
      // player isn't in a game or in a lobby anymore
      if(player.game < 0 && typeof lobby[player.id] !== 'undefined') {
        player.game = -1;
        delete lobby[player.id];
      
        emitOnline();

        // player is leaving a game
      } else if(player.game >= 0) {
        games[player.game].end(player == games[player.game].player1 ? 2 : 1, 'Opponent Forfeit', 'Opponent Forfeit', true);
      }
    }
  });

  // player is upgrading a unit
  socket.on('upgrade', (action) => {
    if(player.game >= 0 && games[player.game].state === 'prep') {
      games[player.game].upgradePrep(player, action);
    }
  });

  // player is sending a chat message
  socket.on('chatMessage', (message) => {
    // can't send messages if you're a guest
    //if(player.name === "Guest")
    //  return;

    // player isn't in a game 
    if(player.game < 0)
      return;

    var now = Date.now();
    if(player.lastMessage + 1000 > now)
      return;
    player.lastMessage = now;

    var msg = {
      author: player.name,
      body: message.trim()
    };

    // send the players the message
    var game = games[player.game];
    if(player == game.player1) {
      game.player2.socket.emit('chatMessage', msg);
      msg.own = true;
      game.player1.socket.emit('chatMessage', msg);
    } else {
      game.player1.socket.emit('chatMessage', msg);
      msg.own = true;
      game.player2.socket.emit('chatMessage', msg);
    }
  });

  // player is clicking ready during a phase
  socket.on('ready', (bool, options) => {
    if(player.game != -1) {
      var game = games[player.game];
      if(game.state == 'setup')
        game.readySetup(player, bool, options);
      if(game.state == 'round')
        game.readyRound(player, bool, options);
      if(game.state == 'prep')
        game.readyPrep(player, bool);

    }
  });

  // player disconnects
  socket.on('disconnect', () => {
    if(player.game >= 0) {
      games[player.game].end(player == games[player.game].player1 ? 2 : 1, 'Opponent Disconnected', 'Opponent Disconnected', true);
    }
    delete players[player.id];
    delete lobby[player.id];
    emitOnline();
  });
});

// Initialize Tables
console.log("Initializing Database");
function init() {
  dbQuery((db) => {
    db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(48) UNIQUE,
    password VARCHAR(1024) NOT NULL,
    salt VARCHAR(32) NOT NULL,
    enc_type varchar(32) NOT NULL DEFAULT 'sha512'
  );`, (error, results, fields) => {
      if(error) {
        console.log("ERROR", error);
        // throw error;
        console.log("Database Connection Failed, Retrying In 1 Second");
        setTimeout(init, 1000);
      } else {
        dbQuery((db) => {
          db.query(`
          CREATE TABLE IF NOT EXISTS gameData (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            losses INT NOT NULL DEFAULT 0,
            games INT NOT NULL DEFAULT 0,
            wins INT NOT NULL DEFAULT 0,
            elo INT NOT NULL DEFAULT 1500
          );`, (error, results, fields) => {
            if(error) {
              console.log("ERROR", error);
              // throw error;
              console.log("Database Query Failed, Retrying in 1 Second");
              setTimeout(init, 1000);
            } else {
              console.log("Result", results);
              console.log('Running on http://localhost:' + port);
              http.listen(port);
            }
          });
        });
      }
    });
  });
}

init();
