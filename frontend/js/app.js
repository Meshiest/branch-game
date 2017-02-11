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
    .when("/404", {
      templateUrl: "views/404.html"
    })
    .otherwise("/404");
  });

  app.controller("LoginCtrl", function($scope, $timeout, $http) {
    $scope.verifying = false;
    $scope.fail = false;

    $scope.doneVerifying = function() {
      $timeout(()=>{
        $scope.fail = false;
        $scope.verifying = false;
      }, 1000);
    };

    $scope.onLogin = function () {
      $scope.verifying = true;
      $http.get("/api/login", {
        user: $scope.user,
        token: $scope.token
      }).then((resp) => {
        console.log("Yes!",resp);
      }, (err) => {
        $scope.fail = true;
        $scope.doneVerifying();
      });
    };

    $scope.onCreate = function () {
      $scope.verifying = true;
      $scope.fail = true;
      $http.post("/api/login", {
        user: $scope.user,
      }).then((resp) => {
        console.log("Create!",resp);
      }, (err) => {
        $scope.fail = true;
        $scope.doneVerifying();
      });
    };
  });

  app.controller('AppCtrl', function($scope, $location){
    $scope.loggedIn = false;
  });

})();