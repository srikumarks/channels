(Work in progress)

# channels

Fast implementation of CSP style channels for modern Javascript using async and await.
See blog post - [Channels with async and await][post].

[post]: http://sriku.org/blog/2018/04/06/channels-with-async-and-await/

## Usage

```
let Channel = require('./src/channel');

let chan = Channel.fast(); // or Channel.friendly().

// Channel.fast() gives you around 500k raw messages per second.
// Channel.friendly() gives you around 100k raw messages per second and is
// more friendly towards IO operations.

async function ping(id, N, exit) {
    try {
        for (let i = 0; i < N; ++i) {
            console.log('pinging', id, i);
            // This is how you post values to a channel.
            await chan.post({id:id, ping:i});
        }
        console.log('done pushing', id);
        // This is how you post an error to a channel.
        // All writers and readers will error out when you
        // do this .. except the one raising the error.
        if (exit) { await chan.error(new Error('done ' + id)); }
        console.log('done with', id);
    } catch (e) {
        console.log('ping error', id, e);
    }
}

async function pong() {
    let count = 0;
    try {
        while (true) {
            // This is how you read from a channel.
            // PS: You don't obviously require the console.log
            console.log('pong', await chan);
            ++count;
        }
    } catch (e) {
        // When a channel errors out, the `await` will raise
        // an error.
        console.log('pong done', count, e);
    }
}

ping('un', 4);
ping('dos', 5);
ping('tres', 6, true);
pong();
```
