'use strict';

var __ = require('underscore'),
    Backbone = require('backbone'),
    loadTemplate = require('../utils/loadTemplate'),
    app = require('../App.js').getApp(),        
    serverConfigMd = require('../models/serverConfigMd'),
    baseModal = require('./baseModal'),
    messageModal = require('../utils/messageModal.js');

module.exports = baseModal.extend({
  className: 'server-connect-modal',

  events: {
    'click .js-save': 'saveForm',
    'click .js-restoreDefaults': 'restoreDefaults',
    'input input': 'inputEntered',
    'click .js-retry': 'retry'
  },

  initialize: function(options) {
    this.model = app.serverConfig;

    this.listenTo(this.model, 'invalid sync', function() {
      this.render();
    });

    this._state = this.getInitialState();
    this._lastSavedAttrs = $.extend(true, {}, this.model.attributes);
  },

  getInitialState: function() {
    var state = {};

    state['attempt'] = 1;
    state['status'] = 'trying';

    return state;
  },

  inputEntered: function(e) {
    this.model.set(e.target.name, e.target.value);
  },

  saveForm: function() {
    if (__.isEqual(this.model.attributes, this._lastSavedAttrs)) {
      return;
    }

    if (this.model.save()) {
      this._lastSavedAttrs = $.extend(true, {}, this.model.attributes);
      this.start();
    };
  },

  restoreDefaults: function() {
    this.model.clear()
      .set( __.result(this.model, 'defaults', {}) );
    this.model.validationError = {};
    this.render();
  },

  setState: function(state) {
    var newState;
    
    if (typeof state['attempt'] !== 'undefined') {
      this.$attempt.text(state['attempt']);
    }

    newState =  __.extend({}, this._state, state);

    if (!__.isEqual(this._state, newState)) {
      this._state = newState;

      if (!(typeof state['attempt'] !== 'undefined' && Object.keys(state).length === 1)) {
        // if the only new state is the attemp counter, no need to
        // re-render since we manually updated that above.
        this.render();
      }
    }
  },

  retry: function() {
    this.start();
  },

  attemptConnection: function() {
    var self = this,
        deferred = $.Deferred(),
        promise = deferred.promise(),
        loginRequest,
        timesup,
        rejectLater,
        rejectLogin,
        rejectLoginLater,
        login,
        onClose;

    rejectLogin = function(reason) {
      rejectLoginLater = setTimeout(function() {
        deferred.reject(reason);
      }, 500);
    };

    login = function() {
      // at this point, we've confirmed connection, so:
      self.trigger('connected');

      // check authentication
      loginRequest = app.login().done(function(data) {
        if (data.success) {
          deferred.resolve();
          self.trigger('authenticated');
        } else {
          if (data.reason === 'too many attempts') {
            rejectLogin('failed-auth-too-many');  
          } else {
            rejectLogin('failed-auth');  
          }          
        }
      }).fail(function(jqxhr) {
        if (jqxhr.statusText === 'abort') return;
        
        rejectLogin('failed-auth');
      });
    };

    if (app.getHeartbeatSocket().getReadyState() === 1) {
      login();
    }

    app.connectHeartbeatSocket();

    promise.cleanup = function() {
      clearTimeout(timesup);
      clearTimeout(rejectLater);
      clearTimeout(rejectLoginLater);
      loginRequest && loginRequest.abort();
      app.getHeartbeatSocket().off(null, login);
      app.getHeartbeatSocket().off(null, onClose);
    };

    promise.cancel = function() {
      deferred.reject('canceled');
    }

    promise.always(function() {
      promise.cleanup();
    });

    app.getHeartbeatSocket().on('open', login);

    app.getHeartbeatSocket().on('close', (onClose = function() {
      // On local servers the close event on a down server is
      // almost instantaneous and the UI can't even show the
      // user we're attempting to connect. So we'll put up a bit
      // of a charade.
      rejectLater = setTimeout(function() {
        deferred.reject();
      }, 1000);
    }));    

    timesup = setTimeout(function() {
      deferred.reject('timedout');
    }, 3000);

    return promise;
  },

  start: function() {
    var self = this,
        attempts = 1,
        connect;

    this.connectAttempt && this.connectAttempt.cancel();

    this.setState(
      __.extend(this.getInitialState(), {
        status: 'trying'
      })
    );

    (connect = function() {
      self.connectAttempt = self.attemptConnection().done(function() {
        self.setState({ status: 'connected' });
      }).fail(function(reason) {
        if (reason == 'canceled') return;
        
        if (attempts >= 3 || reason === 'failed-auth' || reason === 'failed-auth-too-many') {
          self.setState({ status: reason || 'failed' });
        } else {
          attempts += 1;
          connect();
        }
      }).always(function() {
        self.connectAttempt = null;
      });
    })();
  },

  stop: function() {
    if (this.connectAttempt) {
      this.connectAttempt.cancel();
      this.connectAttempt = null;
      this.setState({ status: 'failed' });
    }
  },

  isStarted: function() {
    return !!this.connectAttempt;
  },

  remove: function() {
    this.stop();

    // TODO: don't let us leave this modal with the model in an error state.

    baseModal.prototype.remove.apply(this, arguments);
  },  

  render: function() {
    var self = this,
        scrollPos,
        $scrollContainer;

    // todo: also restore focused element and if possible cursor position
    $scrollContainer = this.$('.flexContainer.scrollOverflowYHideX');
    $scrollContainer.length && (scrollPos = $scrollContainer[0].scrollTop);

    loadTemplate('./js/templates/serverConnectModal.html', function(t) {
      self.$el.html(
        t( __.extend({}, self.model.toJSON(), { errors: self.model.validationError || {} }, self._state) )
      );

      baseModal.prototype.render.apply(self, arguments);
      self.$('.flexContainer.scrollOverflowYHideX')[0].scrollTop = scrollPos;
      self.$attempt = self.$('.attempt').text(self._state.attempt);
    });

    return this;
  }
});
