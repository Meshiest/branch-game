(function(){

  var app = angular.module('app', ['ngRoute']);

  app.config(function($routeProvider) {
    $routeProvider
    .when("/", {
      templateUrl: "views/home.html"
    })
    .when("/login", {
      templateUrl: "views/login.html"
    })
    .when("/create", {
      templateUrl: "views/create.html"
    })
    .when("/404", {
      templateUrl: "views/404.html"
    })
    .otherwise("/404");
  });

  app.controller("LoginCtrl", function($scope) {
    $scope.onLogin = function () {

    };

    $scope.onCreate = function () {

    };
  });

  app.controller('AppCtrl', function($scope, $location){
    $scope.loggedIn = false;
  });

})();