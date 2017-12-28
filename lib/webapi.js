'use strict';

const debug = require('debug')
const axios = require('axios')

var err = debug('urbit:webapi:error')
var log = debug('urbit:webapi:debug')
log.log = console.log.bind(console);

async function getSession(server, user) {
  log("getting session server=%s user=%s", server, user)

  try {
    let response = await axios.request({
      url: server + "/~/auth.json",
      withCredentials: true,
    })

    var cookie = getSessionCookie(response)

    if (response.headers['content-type'] != 'application/json') {
      log("getSession redirect")
      return null

    } else if (response.data.red) {
      log("getSession redirect2")
      return null
    }

    let responseJson = response.data // await response.json();

    var session = {
      server: server,
      ship: responseJson.ship,
      user: user,
      authenticated: responseJson.auth.includes(user),
      oryx: responseJson.oryx,
      ixor: responseJson.ixor,
      event: 1,
      polling: false,
      subscriptions: {},
      lastUpdate: new Date(),
      beatListeners: [],
      cookie,
    }

    return session;

  } catch(error) {
    err("getSession: " + error)
    error.response && log(error.response.data)
    return null
  }
}

async function isAuthenticated(session) {
  if (!session.authenticated) {
    return false
  }

  //TODO add session cookie
  var dummySession = await getSession(session.server, session.user)
  return dummySession.authenticated
}

async function deleteSession(session) {
  if (!session.authenticated) {
    log("Not authenticated")
    return true
  }

  try {
    let response = await axios.request({
        url: session.server + "/~/auth.json?DELETE",
        method: 'POST',
        withCredentials: true,
        data: {
          oryx: session.oryx,
        },
        headers: { Cookie: session.cookie },
    })

    let responseJson = response.data
    if (!responseJson.ok) {
      err("Failed to deauthenticate")
      return false
    }

    log("Deauthenticated successfully")
    session.cookie = null
    return true

  } catch(error) {
    err("deleteSession: " + error);
    error.response && log(error.response.data)
    return false
  }
}

async function authenticate(session, code) {
  if (session.authenticated) {
    log("Already authenticated")
    return true
  }
  try {

    let response = await axios.request( {
        url: session.server + "/~/auth.json?PUT",
        method: 'POST',
        withCredentials: true,
        data: {
          ship: session.user,
          code: code,
          oryx: session.oryx,
        },
        headers: { Cookie: session.cookie },
    })

    let responseJson = response.data
    var authenticated = responseJson.auth.includes(session.user)
    if (!authenticated) {
      err("Failed to authenticate")
      return false
    }

    session.authenticated = true
    session.oryx = responseJson.oryx
    session.ixor = responseJson.ixor
    session.lastUpdate = new Date()

    log("Authenticated successfully")
    return true

  } catch (error) {
    err("authenticate: " + error)
    error.response && log(error.response.data)
    return false
  }
}

async function poke(session, app, mark, wire, data) {
  try {
    var url = session.server + "/~~/~/to/" + app + "/" + mark
    let response = await axios.request({
      url,
      method: 'POST',
      withCredentials: true,
      data: {
        oryx: session.oryx,
        wire: wire,
        xyro: data
      },
      headers: { Cookie: session.cookie },
    })

    return true

  } catch (error) {
    err("poke: " + error)
    error.response && log(error.response.data)
    return false
  }
}

async function subscribe(session, ship, wire, app, path, callback) {
  try {
    if (session.subscriptions[wire]) {
      err("Already subscribed to wire: " + wire)
      return false
    }

    var url = session.server + "/~/is/~" + ship + "/" + app + path + ".json?PUT"

    let response = await axios.request({
      url,
      method: 'POST',
      withCredentials: true,
      timeout: 30000, /* request can hang if app is not listening */
      data: {
        oryx: session.oryx,
        wire: wire,
        appl: app,
        mark: 'json',
        ship: ship
      },
      headers: { Cookie: session.cookie },
    })

    var responseJson = response.data
    log("Subscribed successfully: " + wire)
    session.subscriptions[wire] = {
      path,
      callback
    }
    if (Object.keys(session.subscriptions).length === 1 && !session.polling) {
      this.poll(session);
    }
    return true

  } catch (error) {
    err("subscribe: " + error)
    error.response && log(error.response.data)
    return false
  }
}

async function unsubscribe(session, ship, wire, app) {
  try {
    var sub = session.subscriptions[wire]
    if (!sub) {
      log("Not subscribed to wire: " + wire)
      return true
    }
    var url = session.server + "/~/is/~" + ship + "/" + app + sub.path + ".json?DELETE"
    let response = await axios.request({
      url,
      method: 'POST',
      withCredentials: true,
      data: {
        oryx: session.oryx,
        wire: wire,
        appl: app,
        mark: 'json',
        ship: ship
      },
      headers: { Cookie: session.cookie },
    })

    delete session.subscriptions[wire]
    log("Unsubscribed successfully: " + wire)

    return true

  } catch (error) {
    err("unsubscribe: " + error)
    error.response && log(error.response.data)
    return false
  }
}

async function poll(session) {
  if (session.polling) {
    log("Already polling")
    return
  }
  session.polling = true
  while (true) {
    try {
      var url = session.server + "/~/of/" + session.ixor + "?poll=" + session.event
      var response = await axios.request({
        url,
        withCredentials: true,
        headers: { Cookie: session.cookie },
      })

      if (Object.keys(session.subscriptions).length === 0) {
        // stop polling
        session.polling = false
        return true
      }

      session.lastUpdate = new Date()
      session.beatListeners.forEach(listener => listener())

      var responseJson = response.data
      if (!responseJson.beat) {
        // got a change
        var wire = responseJson.from.path
        var sub = session.subscriptions[wire]

        if (sub) {
          var callback = sub.callback
          if (responseJson.type == 'rush') {
            callback(wire, responseJson.data.json)

          } else if (responseJson.type == 'quit') {
            callback(wire, null)
          }

        } else {
          err("No callback for wire: " + wire)
        }

        session.event++
      }

    } catch (error) {
      err("poll: " + error)
      error.response && log(error.response.data)

      //TODO better backoff
      await new Promise(resolve => setTimeout(resolve, 10000));
      continue
    }
  }
}

function getSessionCookie(response) {
  var cookieHeader = response.headers['set-cookie']
  var cookie = null
  if (cookieHeader) {
    cookieHeader = cookieHeader[0]

    //TODO do i need the ship name?
    cookie = cookieHeader.match(/^[^;]+/)[0]
    //log("getSession cookie: " + cookie)

  } else {
    log("getSession no cookie")
  }

  return cookie
}

function enableLogging() {
  debug.enable('urbit:webapi:*')
}

module.exports = {
  getSession,
  isAuthenticated,
  deleteSession,
  authenticate,
  poke,
  subscribe,
  unsubscribe,
  poll,
  enableLogging,
}
