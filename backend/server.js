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

const types = JSON.parse(fs.readFileSync("json/branch.json"));


const SECRET = process.env.HASH_SECRET;
const port = 8080;
const version = "1.0.5";

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

// generates an auth token
function createToken() {
  // wow secure
  return base64url(crypto.randomBytes(100))
    .replace(/[^a-zA-Z0-9]/g,"")
    .substr(0, 5);
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

app.get('/user', (req, res) => {
  var name = req.session.name;
  if(typeof name !== 'undefined') {
    res.json({name: name});
  } else {
    res.status(403).json({message: "Not Authorized"});
  }
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
  if(typeof name === 'undefined') {
    res.status(400).json({message: 'Bad Request'});
    return;
  }

  name = name.toLowerCase();
  
  if(!name.match(/^[a-z0-9\d]{3,20}$/)) {
    res.status(400).json({message: 'Invalid Username'});
    return;
  }

  var token = createToken();

  dbQuery((db) => {

    db.query("INSERT INTO users (name,token) VALUES ('"+name+"','"+token+"');",
    (error, results, fields) => {
      if(error) {
        res.status(422).json({message: "User Already Exists"});
      } else {
        req.session.name = name;
        res.status(202).json({
          name: name,
          token: token
        });
        console.log('create name',name);
      }
    });

  });
});

app.post('/login', (req, res) => {
  var name = req.body.name;
  var token = req.body.token;
  if(typeof name === 'undefined' || typeof token === 'undefined') {
    res.status(400).json({message: 'Bad Request'});
    return;
  }

  name = name.toLowerCase();

  if(!name.match(/^[a-z0-9\d]{3,20}$/g) || !token.match(/^[a-zA-Z0-9]{5}$/g)) {
    res.status(400).json({message: 'Invalid Credentials'});
    return;
  } 
  
  dbQuery((db) => {
    db.query("SELECT * from users WHERE name='"+name+"' AND token='"+token+"';", 
    (error, results, fields) => {

      if(error || !results.length) { 
        res.status(403).json({message: 'Forbidden'});
      } else {
        req.session.name = results[0].name;
        res.json({
          name: results[0].name
        });
      }
    });
  });
});

var players = {};
var lobby = {};
var id = 0;
var games = {};
var gameId = 0;

function randomOpponent(id) {
  var keys = Object.keys(lobby);
  keys.splice(keys.indexOf(id), 1);

  if(!keys.length)
    return -1;
  return keys[Math.floor(Math.random() * keys.length)];
}

io.on('connection', (socket) => {
  var player = {
    socket: socket,
    id: id++,
    game: -1,
    name: socket.handshake.session.name || "Guest",
  };
  players[player.id] = player;
  io.emit('online', Object.keys(players).length);

  // lobby callback
  socket.on('lobby', (join) => {
    if(join) {
      if(player.game < 0 && !lobby[player.id]) {
        player.game = -1;
        lobby[player.id] = player;
        var opponent = randomOpponent(player.id);
        console.log("Opponent",opponent, player.id);

        // there is an opponent for this player
        if(opponent >= 0) {
          var id = gameId++;
          var game = games[id] = new Game(id, player, players[opponent]);

          game.onDone = function(winner) {
            console.log('Game ending', this.id);
            this.player1.game = -1;
            this.player1.ip = 0;
            this.player1.classes = [];
            this.player2.game = -1;
            this.player2.ip = 0;
            this.player2.classes = [];
            delete games[id];
          }.bind(game);

          delete lobby[player.id];
          delete lobby[opponent];
          game.start();
        }
      }
    } else {
      // player isn't in a game but is waiting
      if(player.game < 0 && typeof lobby[player.id] === 'undefined') {
        console.log('stop waiting', player.id);
        player.game = -1;
        delete lobby[player.id];

        // player is leaving a game
      } else if(player.game >= 0) {
        console.log('forfeit', player.id);
        games[player.game].end(player == games[player.game].player1 ? 1 : 2, 'Opponent Forfeit', 'Opponent Forfeit');
        delete games[player.game];
      }
    }
  });

  socket.on('upgrade', (action) => {
    if(player.game >= 0 && games[player.game].state === 'prep') {
      games[player.game].upgradePrep(player, action);
    }
  });

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
      console.log('disconnect in game', player.id);
      games[player.game].end(player == games[player.game].player1 ? 1 : 2, 'Opponent Disconnected', 'Opponent Disconnected');
      delete games[player.game];
    }
    delete lobby[player.id];
    delete players[player.id];
    io.emit('online', Object.keys(players).length);
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
    losses INT,
    wins INT,
    token VARCHAR(5)
  );`, (error, results, fields) => {
      if(error) {
        console.log("ERROR", error);
        // throw error;
        console.log("Database Connection Failed, Retrying In 1 Second");
        setTimeout(init, 1000);
      } else {
        console.log("Result", results);
        console.log('Running on http://localhost:' + port);
        http.listen(port);
      }
    });
  });
}

init();
