(function(){

  var app = angular.module('app', ['ngRoute']);

  app.config(function($routeProvider) {
    $routeProvider
    .when("/", {
      templateUrl: "views/home.html"
    })
    .when("/login", {
      templateUrl: "views/login.html",
      controller: "LoginCtrl"
    })
    .when("/create", {
      templateUrl: "views/create.html",
      controller: "LoginCtrl"
    })
    .when("/battle", {
      templateUrl: "views/battle.html",
      controller: "BattleCtrl"
    })
    .when("/404", {
      templateUrl: "views/404.html"
    })
    .otherwise("/404");
  });

  app.controller("LoginCtrl", function($scope, $rootScope, $timeout, $http, $location) {
    $scope.verifying = false;
    $scope.fail = false;
    $scope.showToken = false;
    $scope.token = "";

    // called after an api call to wiggle the ui
    $scope.doneVerifying = function() {
      $timeout(()=>{
        $scope.fail = false;
        $scope.verifying = false;
      }, 1000);
    };

    // for redirecting after clicking the "done reading password" button
    $scope.doneAuth = function() {
      $location.path("/");
    };

    // sign in button callback
    $scope.onLogin = function () {
      $scope.verifying = true;
      $http.post("/api/login", {
        name: $scope.name,
        token: $scope.token
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
      $scope.fail = true;
      $http.post("/api/user", {
        name: $scope.name,
      }).then((resp) => {
        $rootScope.loggedIn = true;
        $rootScope.username = resp.data.name;
        $scope.showToken = true;
        $scope.token = resp.data.token;
      }, (err) => {
        $scope.fail = true;
        $scope.doneVerifying();
      });
    };
  });

  app.controller('AppCtrl', function($rootScope, $scope, $location, $http, $timeout){
    $rootScope.inBattle = false;
    $rootScope.loggedIn = false;
    $rootScope.username = "";
    $rootScope.offline = false;
    $rootScope.types = {};

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
      $rootScope.username = "";
      $http.post("/api/logout").then(() => {
        console.log("Logged out!");
      }, () => {
        // wat
      });
    };

    $rootScope.startBattle = function() {
      $location.path('/battle');
    };

    $scope.forfeit = function() {
      $rootScope.inBattle = false;
      $location.path("/");
    };

    $http.get('/api/user').then((resp) => {
      $rootScope.loggedIn = true;
      $rootScope.username = resp.data.name;
    }, (err) => {
      console.log(err);
      if(err.status == 502) {
        $rootScope.offline = true;
      }
    });
  });

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

  app.directive('battlePrep', function($parse) {
    return {
      restrict: 'E',
      scope: true,
      templateUrl: "views/battle-prep.html"
    };
  });


  app.controller('BattleCtrl', function($scope, $rootScope, $http, $location){
    $scope.phase = 'lobby';
    $scope.slots = [];
    $scope.ready = false;
    $scope.recruits = [];
    $scope.ip = 0;
    $scope.round = 0;
    $scope.opponentRecruits = [];
    $rootScope.inBattle = true;

    $scope.selectingRecruit = undefined;
    var socket = $scope.socket = io.connect(location.origin, {path: '/api/socket.io/'});
    console.log('Opening Socket');

    $scope.upgrade = function(recruit, evolution) {
      console.log('upgrading');
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

    socket.on('setup', () => {
      console.log('Starting Setup');
      $scope.$evalAsync(() => {
        $scope.phase = 'setup';
      });
    });

    socket.on('done', (reason) => {
      console.log('Game Over', reason);
      $scope.$evalAsync(() => {
        $scope.phase = 'end';
        $location.path('/');
      });
    });

    socket.on('round', (selfState, opponentState) => {
      console.log('Starting Rounds', selfState, opponentState);
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.recruits = selfState.classes;
        $scope.opponentRecruits = opponentState.classes;
        $scope.round = selfState.round;
        console.log('PROGRESS');
        $scope.phase = 'progress';
      });
    });

    socket.on('prep', (selfState, opponentState) => {
      console.log('prepping for next Round', selfState, opponentState);
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.recruits = selfState.classes;
        $scope.opponentRecruits = opponentState.classes;
        $scope.round = selfState.round;
        $scope.phase = 'prep';
      });
    });

    socket.on('update', (selfState) => {
      console.log('updating unit', selfState);
      $scope.$evalAsync(() => {
        $scope.ready = false;
        $scope.ip = selfState.ip;
        $scope.round = selfState.round;
        $scope.recruits = selfState.classes;
      });
    });

    socket.on('disconnect', () => {
      console.log('lost connection');
      $location.path('/');
    });

    // start waiting to join game
    socket.emit('lobby', true);

    $scope.$on('$routeChangeStart', function () {
      $rootScope.inBattle = false;
      console.log('Closing Socket');
      socket.emit('lobby', false);
      socket.disconnect();
    });
  });

})();