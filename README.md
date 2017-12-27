# urbit-js
## Description
Urbit bindings for javascript

## Usage
```
$ npm install --save @asssaf/urbit
```

```javascript
const urbit = require('@asssaf/urbit');

async function example() {
  var session = await urbit.webapi.getSession('http://localhost:8080', 'zod')

  var res = await urbit.webapi.authenticate(session, "<code>")

  res = await urbit.webapi.subscribe(session, 'zod', '/wire', 'myapp', '/path', function(wire, data) { ... })

  res = await urbit.webapi.poke(session, 'myapp', 'json', '/', 2)

  res = await urbit.webapi.unsubscribe(session, 'zod', '/wire', 'myapp')

  res = await urbit.webapi.deleteSession(session)
}
```
