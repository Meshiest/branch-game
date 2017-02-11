'use-strict';

const express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const mysql = require('mysql');
const fs = require('fs');
const crypto = require('crypto');
const redis = require('redis');

const secret = process.env.HASH_SECRET;
const port = 8080;
const version = "1.0.0";
 
app.set('trust proxy', 1);
app.use(session({
  secret: secret,
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
  var hash = crypto.createHmac('sha256', SECRET);
  // wow such secure
  crypto.randomBytes(256, (err, buf) => {
    if (err) throw err;
    hash.update(buf.toString('hex'));
  });
  return hash.digest('hex').substr(0, 5);
}

// App
app.get('/', function (req, res) {
  res.json({
    message: "Welcome to Branch API v"+version
  });
});

app.get('/user', (req, res) => {
  //var id = req.session.name;
  var name = req.session.name;
  if(typeof name !== 'undefined') {
    res.json({name: name});
  } else {
    res.status(403).json({message: "Not Authorized"});
  }
});

app.post('/login', (req, res) => {
  var name = request.params.name;
  var token = createToken();
  dbQuery((db) => {

    db.query("INSERT INTO users (name,token) VALUES ('"+name+"','"+token+"');",
    (error, results, fields) => {
      if(error) {
        res.status(422).json({error: "User Already Exists"});
      } else {
        res.status(202).json({
          name: name
        });

        console.log("fields", results);
        //req.session.id
      }
    });

  });
});

app.get('/login', (req, res) => {
  var name = request.params.name;
  var token = request.params.token;
  
  dbQuery((db) => {
    db.query("SELECT * from users WHERE name='"+name+"' AND token='"+token+"';", 
    (error, results, fields) => {

      if(error) { 
        res.status(403).json({error: 'Forbidden'});
        console.log("ERROR", error);
        throw error;

      } else {
        res.json({
          name: name
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
