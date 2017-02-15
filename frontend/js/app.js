(function(){

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


  app.controller('BattleCtrl', function($scope, $rootScope, $http, $location){
    if(!$rootScope.socket)
      console.log('new socket');
    var socket = $rootScope.socket = ($rootScope.socket || io.connect(location.origin, {path: '/api/socket.io/'}));

    $scope.battleInit = function(inBattle) {
      $scope.phase = 'lobby';
      $scope.slots = [];
      $scope.ready = false;
      $scope.recruits = [];
      $scope.ip = 0;
      $scope.round = 0;
      $scope.opponentRecruits = [];
      $rootScope.inBattle = inBattle;
      $scope.selectingRecruit = undefined;
      $scope.enemyName = "Guest";
    };

    $scope.battleInit(false);

    $scope.upgrade = function(recruit, evolution) {
      $scope.ready = false;
      socket.emit('upgrade', {
        type: 'upgrade',
        next: evolution,
        target: $scope.recruits.indexOf(recruit)
      });
    };

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

    socket.on('online', (count) => {
      $scope.$evalAsync(() => {
        $rootScope.onlineCounts = count;
      });
    });

    socket.on('setup', (name) => {
      $scope.enemyName = name;
      $scope.winnerText = "";
      $scope.$evalAsync(() => {
        $scope.phase = 'setup';
        socket.emit('ready', false, []);
      });
    });

    socket.on('done', (reason) => {
      $scope.$evalAsync(() => {
        $scope.phase = 'end';
        $rootScope.inBattle = false;
        $rootScope.challengeTarget = "";
        $scope.winnerText = reason;
      });
    });

    socket.on('round', (selfState, opponentState) => {
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

    socket.on('prep', (selfState, opponentState) => {
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.recruits = selfState.classes;
        $scope.opponentRecruits = opponentState.classes;
        $scope.round = selfState.round;
        $scope.phase = 'prep';
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

    socket.on('disconnect', () => {
      $scope.phase = 'end';
      $rootScope.inBattle = false;
      $rootScope.challengeTarget = "";
      if(!$scope.winnerText)
        $scope.winnerText = "Lost Connection";
    });

    $scope.$on('$routeChangeStart', function (event, next, current) {
      if(next.templateUrl.indexOf("battle") > -1) {
        console.log('starting battle');
        // start waiting to join game
        if($rootScope.challengeTarget)
          socket.emit('lobby', {join: true, challenge: true, target: $rootScope.challengeTarget});
        else
          socket.emit('lobby', {join: true, challenge: false});

        // init base variables
        $scope.$evalAsync(() => {
          $scope.battleInit(true);
        });
      } else {
        socket.emit('lobby', false);
        if(next.templateUrl.indexOf("home") > -1) {
          console.log('back home');

        } else {
          console.log('leaving');
          socket.disconnect();
          delete $rootScope.socket;
        }
        $rootScope.inBattle = false;
        $rootScope.challengeTarget = "";
      }
    });
  });

})();