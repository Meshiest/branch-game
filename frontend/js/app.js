(function(){

  var timeLeft = 0;
  var BASE_TIME = 120;
  // subtract one from time
  // this is separate from the angular app to avoid needlessly filling up the scope
  setInterval(() => {
    window.requestAnimationFrame(()=>{
      if(timeLeft > 0)
        timeLeft --;

      if(typeof time !== 'undefined') {
        time.innerHTML = timeLeft;
      }
    });
  }, 1000);

  function range(start, count) {
    return Array.apply(0, Array(count))
      .map(function (element, index) { 
        return index + start;  
    });
  }

  var app = angular.module('app', ['ngRoute']);

  app.config(function($routeProvider) {
    $routeProvider
    .when("/", {
      templateUrl: "views/home.html",
      controller: "BattleCtrl"
    })
    .when("/login", {
      templateUrl: "views/login.html",
      controller: "LoginCtrl"
    })
    .when("/create", {
      templateUrl: "views/create.html",
      controller: "LoginCtrl"
    })
    .when("/challenge", {
      templateUrl: "views/challenge.html",
      controller: "LoginCtrl"
    })
    .when("/battle", {
      templateUrl: "views/battle.html",
      controller: "BattleCtrl"
    })
    .when("/howto", {
      templateUrl: "views/howto.html",
    })
    .when("/404", {
      templateUrl: "views/404.html"
    })
    .otherwise("/404");
  });

  app.controller("LoginCtrl", function($scope, $rootScope, $timeout, $http, $location) {
    $scope.verifying = false;
    $scope.fail = false;

    // called after an api call to wiggle the ui
    $scope.doneVerifying = function() {
      $timeout(()=>{
        $scope.fail = false;
        $scope.verifying = false;
      }, 1000);
    };

    // sign in button callback
    $scope.onLogin = function () {
      $scope.verifying = true;
      $scope.fail = false;
      $http.post("/api/login", {
        name: $scope.name,
        password: $scope.password
      }).then((resp) => {
        $rootScope.loggedIn = true;
        $rootScope.username = resp.data.name;
        $location.path("/");
      }, (err) => {
        $scope.fail = true;
        $scope.doneVerifying();
      });
    };

    // create user callback
    $scope.onCreate = function () {
      $scope.verifying = true;
      $scope.fail = false;
      $http.post("/api/user", {
        name: $scope.name,
        password: $scope.password,
      }).then((resp) => {
        $rootScope.loggedIn = true;
        $rootScope.username = resp.data.name;
        $location.path("/");
      }, (err) => {
        $scope.fail = true;
        $scope.doneVerifying();
      });
    };

    // challenge another
    $rootScope.startChallenge = function() {
      $scope.verifying = true;
      $scope.fail = true;
      $http.post("/api/challenge", {
        name: $scope.name,
      }).then((resp) => {
        $rootScope.challengeTarget = resp.data.name;
        $location.path('/battle');
      }, (err) => {
        $scope.fail = true;
        $scope.doneVerifying();
      });
    };
  });

  app.controller('AppCtrl', function($rootScope, $scope, $location, $http, $timeout){
    $rootScope.inBattle = false;
    $rootScope.loggedIn = false;
    $rootScope.username = "Guest";
    $rootScope.offline = false;
    $rootScope.challengeTarget = "";
    $rootScope.types = {};
    $rootScope.onlineCounts = {players: 0, games: 0, lobby: 0};

    $scope.getTypes = function() {
      $http.get('/api/types').then((resp) => {
        $rootScope.types = resp.data;
      }, (err) => {
        $timeout($scope.getTypes, 1000);
      });
    };

    $scope.getTypes();

    // log out button on top right
    $scope.logOut = function() {
      $rootScope.loggedIn = false;
      $rootScope.username = "Guest";
      $location.path('/');
      $http.post("/api/logout").then(() => {
        $rootScope.loggedIn = false;
      }, () => {
        // wat
      });
    };

    $rootScope.goHome = function() {
      $location.path("/");
    };

    $rootScope.challenge = function() {
      if(!$rootScope.loggedIn)
        return;
      $location.path('/challenge');
    };

    $rootScope.startBattle = function(name) {
      $location.path('/battle');
    };

    $rootScope.gotoHowto = function() {
      $location.path('/howto');
    };    

    $scope.forfeit = function() {
      $rootScope.inBattle = false;
      $location.path("/");
    };

    $http.get('/api/user').then((resp) => {
      $rootScope.loggedIn = true;
      $rootScope.username = resp.data.name;
    }, (err) => {
      if(err.status == 502) {
        $rootScope.offline = true;
      }
    });
  });

  // kill me... need persistent scopes and unique template urls
  app.directive('battleLobby', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-lobby.html"
    };
  });

  app.directive('battleSetup', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-setup.html"
    };
  });

  app.directive('battleProgress', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-progress.html"
    };
  });

  app.directive('battlePlayback', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-playback.html"
    };
  });

  app.directive('battlePrep', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-prep.html"
    };
  });

  app.directive('battleEnd', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-end.html"
    };
  });


  app.controller('BattleCtrl', function($scope, $rootScope, $http, $location, $timeout){
    var socket = $rootScope.socket = ($rootScope.socket || io.connect(location.origin, {path: '/api/socket.io/'}));

    $scope.showChatOverlay = false;
    $scope.disableMessage = false;
    $scope.fail = false;
    $scope.chatMessage = {msg: ''};
    $scope.messages = [];
    $scope.newMessages = false;

    // display a message on the screen
    $scope.addMessage = function(msg) {
      var messages = $scope.messages;
      messages.push(msg);


      if(typeof messageContainer !== 'undefined') {
        // if we can see the chat messages, scroll to the bottom
        window.requestAnimationFrame(() => {
          messageContainer.scrollTop = messageContainer.scrollHeight - messageContainer.clientHeight;
        });
      }

      if(!$scope.showChatOverlay && !$scope.newMessages)
        $scope.newMessages = true;
    };

    // toggles the chat overlay
    $scope.toggleChatOverlay = function() {
      $scope.chatMessage = {msg: ''};
      $scope.newMessages = false;
      $scope.showChatOverlay = !$scope.showChatOverlay;

      if($scope.showChatOverlay) {
        // try to scroll to the bottom
        window.requestAnimationFrame(() => {
          messageContainer.scrollTop = messageContainer.scrollHeight - messageContainer.clientHeight;
        });
      }
    };

    // try to send a chat message
    $scope.sendMessage = function() {
      var msg = $scope.chatMessage.msg.trim();
      
      // can't send an invalid message
      if(msg.length === 0) {
        $scope.disableMessage = true;
        $scope.fail = true;
        $timeout(() => {
          $scope.disableMessage = false;
          $scope.fail = false;
        }, 500);
      } else {
        $scope.chatMessage = {msg: ''};
        socket.emit('chatMessage', msg);
        $scope.disableMessage = true;
        // one second cooldown between messages
        $timeout(() => {
          $scope.disableMessage = false;
        }, 1000);
      }
    };

    // you can chat if neither of the players are guests
    // this will probably need to be changed when spectating is implemented
    $scope.canChat = function() {
      return $scope.enemyName !== "Guest" && $rootScope.username !== "Guest";
    };

    $scope.battleInit = function() {
      $scope.slots = [];
      $scope.broken = false;
      $scope.ready = false;
      $scope.recruits = [];
      $scope.ip = 0;
      $scope.round = 0;
      $scope.opponentRecruits = [];
      $scope.playback = {
        log: [],
        team: 0,
        teams: {1: {}, 2: {}}
      };
      $scope.phase = 'lobby';
      $rootScope.inBattle = false;
      $scope.selectingRecruit = undefined;
      $scope.enemyName = "Guest";
      $scope.messagingEnabled = true;
      $scope.messages = [];
    };

    // upgrades a recruit in the upgrade menu
    $scope.upgrade = function(recruit, evolution) {
      $scope.ready = false;
      socket.emit('upgrade', {
        type: 'upgrade',
        next: evolution,
        target: $scope.recruits.indexOf(recruit)
      });
    };

    // activates a power in the upgrade menu
    $scope.power = function(recruit) {
      $scope.ready = false;
      socket.emit('upgrade', {
        type: 'power',
        target: $scope.recruits.indexOf(recruit)
      });
    };

    $scope.goHome = function() {
      $location.path('/');
    };

    $scope.startAttack = function(recruit) {
      if($scope.ready)
        return;
      $scope.selectingRecruit = recruit;
      recruit.moveType = undefined;
      recruit.moveTarget = undefined;
      if(typeof recruit.moveTarget !== 'undefined') {
        delete recruit.moveTarget;
      }
    };

    $scope.isSelected = function(recruit) {
      for(var i = 0; i < $scope.recruits.length; i++) {
        if($scope.recruits[i].moveTarget === recruit.id)
          return true;
      }
      return false;
    };

    $scope.roundReady = function() {
      for(var i = 0; i < $scope.recruits.length; i++) {
        var recruit = $scope.recruits[i];
        if(recruit.moveType != 'attack' && recruit.moveType != 'defend' && recruit.health > 0) {
          return false;
        }
      }
      return true;
    };

    $scope.selectTarget = function(recruit) {
      if(!$scope.selectingRecruit)
        return;

      if(recruit.health <= 0)
        return;

      $scope.selectingRecruit.moveTarget = recruit.id;
      $scope.selectingRecruit.moveType = 'attack';
      $scope.selectingRecruit = undefined;
    };

    $scope.defend = function(recruit) {
      if($scope.ready)
        return;
      $scope.selectingRecruit = undefined;
      recruit.moveType = "defend";
      recruit.moveTarget = undefined;
    };

    // toggle if you're ready
    $scope.toggleRoundReady = function() {
      $scope.ready = !$scope.ready;
      var moves = [];

      if($scope.ready) {
        // simply down the moves from the recruit objects
        for(var i = 0; i < $scope.recruits.length; i++) {
          var move = {
            id: $scope.recruits[i].id,
            moveType: $scope.recruits[i].moveType
          };
          if(move.moveType == 'attack')
            move.moveTarget = $scope.recruits[i].moveTarget;
          moves.push(move);
        }
      }
      socket.emit('ready', $scope.ready, moves);
    };

    // toggle if you're ready
    $scope.toggleReady = function() {
      $scope.ready = !$scope.ready;
      var classes = $scope.slots.map((e) => {return Object.keys(e)[0];});
      socket.emit('ready', $scope.ready, $scope.ready ? classes : []);
    };

    // for prep phase
    $scope.togglePrepReady = function() {
      $scope.ready = !$scope.ready;
      socket.emit('ready', $scope.ready);
    };

    // remove a recruit
    $scope.removeSlot = function(i) {
      if($scope.slots.length <= i || $scope.ready)
        return;

      $scope.slots.splice(i, 1);
    };

    // add a recruit
    $scope.addSlot = function(type) {
      if($scope.slots.length > 2 || $scope.ready)
        return;

      var t={};
      t[type] = true;
      $scope.slots.push(t);
    };

    socket.on('chatMessage', (msg) => {
      $rootScope.$evalAsync(() => {
        $scope.addMessage(msg);
      });
    });

    socket.on('online', (count) => {
      $rootScope.$evalAsync(() => {
        $rootScope.onlineCounts = count;
      });
    });

    // called to tell client to enter a game
    socket.on('setup', (name) => {
      timeLeft = BASE_TIME;
      $scope.$evalAsync(() => {
        $scope.enemyName = name;
        $scope.winnerText = "";
        $rootScope.inBattle = true;
        $scope.phase = 'setup';
        socket.emit('ready', false, []);
      });
    });

    // called to tell client the game is over
    socket.on('done', (reason, now) => {
      $scope.$evalAsync(() => {
        if(now || $scope.broken) {
          $scope.phase = 'end';
          $scope.showChatOverlay = false;
          $timeout.cancel($scope.playback.timeout);
        } else {
          $scope.nextPhase = 'end';
        }

        $rootScope.inBattle = false;
        $rootScope.challengeTarget = "";
        $scope.winnerText = reason;
      });
    });

    // called to tell client to enter the combat phase
    socket.on('round', (selfState, opponentState) => {
      timeLeft = BASE_TIME;
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.recruits = selfState.classes;
        $scope.opponentRecruits = opponentState.classes;
        $scope.round = selfState.round;
        $scope.phase = 'progress';
        socket.emit('ready', false, {});
      });
    });

    // called to tell client to enter prep/upgrade phase
    socket.on('prep', (selfState, opponentState) => {
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.recruits = selfState.classes;
        $scope.opponentRecruits = opponentState.classes;
        $scope.round = selfState.round;

        // somehow animations broke
        if($scope.broken)
          $scope.phase = 'prep';
        else
          $scope.nextPhase = 'prep';

        socket.emit('ready', false);
      });
    });

    socket.on('update', (selfState) => {
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.round = selfState.round;
        $scope.recruits = selfState.classes;
      });
    });

    socket.on('logs', (team, log) => {
      $scope.$evalAsync(() => {
        $scope.phase = "playback";
        $scope.playback.log = log;
        $scope.playback.team = team;
        if(log.length) {
          $scope.playback.teams[1] = $scope.playback.log.splice(0, 1)[0].value;
          $scope.playback.teams[2] = $scope.playback.log.splice(0, 1)[0].value;
        } else {
          $scope.broken = true; // ??
          $scope.playback.team[team] = $scope.recruits;
          $scope.playback.team[team%2+1] = $scope.opponentRecruits;
        }
        $scope.runPlayback();
      });
    });

    socket.on('disconnect', () => {
      $scope.$evalAsync(() => {
        $scope.phase = 'end';
        $rootScope.inBattle = false;
        $rootScope.challengeTarget = "";
        if(!$scope.winnerText)
          $scope.winnerText = "Lost Connection";
      });
    });

    // animate moving an attribute
    $scope.animateShift = function(obj, attr, goal, time) {
      var start = obj[attr];
      obj["animate_"+attr] = true;
      var count = Math.min(10, Math.abs(goal - start));
      var delta = time / count;
      var step = (goal - start) / count;

      // run all the steps
      range(0, count).forEach((i) => {
        $timeout(() => {
          obj[attr] = Math.round(start + step * i);
        }, delta * i);
      });

      // final step
      $timeout(() => {
        obj["animate_"+attr] = false;
        obj[attr] = goal;
      }, time);

    };

    $scope.runPlayback = function() {
      var playback = $scope.playback;

      if(!playback.log.length) {
        $scope.phase = $scope.nextPhase;
        timeLeft = BASE_TIME;
        if($scope.phase === 'end')
          $scope.showChatOverlay = false;

        return;
      }
      var action = playback.log.splice(0, 1)[0];
      var value = action.value;
      var ANIMATION_DURATION = 1500;

      switch(action.type) {
      case 'heal':
        // animate healing for a specific team
        for(var i = 0; i < playback.teams[action.team].length; i++) {
          var recruit = playback.teams[action.team][i];

          // only heal if recruit is living
          if(recruit.health > 0) {
            $scope.animateShift(recruit, 'health', Math.min(recruit.health + value, recruit.maxHealth), ANIMATION_DURATION);
          }
        }
        break;

      case 'defend':
        // turn on defending icons
        for(var i = 0; i < value.length; i++) {
          var team = value[i][0];
          var index = value[i][1];
          playback.teams[team][index].defending = true;
        }
        break;
        
      case 'bonus':
        // animate buffs for a specific team
        for(var i = 0; i < playback.teams[action.team].length; i++) {
          var recruit = playback.teams[action.team][i];

          // only animate speed if we need to
          if(value.speed)
            $scope.animateShift(recruit, 'speed', recruit.speed + value.speed, ANIMATION_DURATION);

          // only animate attack if we need to
          if(value.attack)
            $scope.animateShift(recruit, 'attack', recruit.attack + value.attack, ANIMATION_DURATION);
        }
        break;

      case 'attack':
        var attacker = playback.teams[value.attacker[0]][value.attacker[1]];
        if(!attacker) {
          break;
        }
        attacker.attacking = true;
        // stop attacking animation
        $timeout(() => {
          attacker.attacking = false;
        }, ANIMATION_DURATION);

        range(0, value.attacks.length).forEach((i) => {
          var attack = value.attacks[i];
          var recruit = playback.teams[attack.target[0]][attack.target[1]];
          var damage = attack.damage;

          // only heal if recruit is living
          if(recruit.health > 0) {
            recruit.attacked = true;
            $scope.animateShift(recruit, 'health', Math.max(recruit.health - damage, 0), ANIMATION_DURATION);

            // stop attack animation
            $timeout(() => {
              recruit.attacked = false;
            }, ANIMATION_DURATION);
          }
        });
        break;

      default:
        console.log(action.type, action.value);
        break;
      }


      $scope.playback.timeout = $timeout($scope.runPlayback, ANIMATION_DURATION + 500);
    };

    function handleBattleStart() {
      // start waiting to join game
      if($rootScope.challengeTarget)
        socket.emit('lobby', {join: true, challenge: true, target: $rootScope.challengeTarget});
      else
        socket.emit('lobby', {join: true, challenge: false});

      // init base variables
      $scope.battleInit();
    }

    if($location.path() == '/battle') {
      handleBattleStart();
    } else {
      // we're not in batle
      socket.emit('lobby', {join: false});
      $scope.battleInit();

      // remove our challenge target
      $rootScope.challengeTarget = "";
     }

    $scope.$on('$routeChangeStart', function (event, next, current) {
      if(next.templateUrl.indexOf("battle") > -1) {
        handleBattleStart();
      } else {
        // forfeit just in case
        socket.emit('lobby', {join: false});

        if(next.templateUrl.indexOf("home") > -1) {
          $scope.battleInit();

        } else {
          socket.disconnect();
          delete $rootScope.socket;
        }
        $rootScope.inBattle = false;
        $rootScope.challengeTarget = "";
      }
    });
  });

})();