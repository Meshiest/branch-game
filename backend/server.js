'use-strict';

const express = require('express');
const bodyParser = require('body-parser');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const mysql = require('mysql');
const fs = require('fs');
const crypto = require('crypto');
const redis = require('redis');
const base64url = require('base64url');

const SECRET = process.env.HASH_SECRET;
const port = 8080;
const version = "1.0.0";

 
app.set('trust proxy', 1);
app.use(bodyParser.json());
app.use(session({
  secret: SECRET,
  saveUninitialized: true,
  resave: false,
  store: new RedisStore({
    host: 'redis',
  }),
}));

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

io.on('connection', (socket) => {
  socket.on('disconnect', () => {

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
