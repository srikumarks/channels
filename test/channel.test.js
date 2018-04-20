
let Channel = require('../src/channel');

function suite(name, makeChannel) {
    let prefix = '[' + name + '] ';

    test(prefix + 'fifo async post', async () => {
        let ch = makeChannel();
        let data = [1,2,3,4,5];
        let count = 0;
        let produce = async () => {
            for (let i = 0; i < data.length; ++i) {
                await ch.post(data[i]);
            }
        };
        let consume = async () => {
            for (let i = 0; i < data.length; ++i) {
                expect(await ch).toBe(data[i]);
                ++count;
            }
        };
        produce();
        await consume();
        expect(count).toBe(data.length);
    });

    test(prefix + 'fifo sync post', async () => {
        let ch = makeChannel();
        let data = [1,2,3,4,5];
        let count = 0;
        let produce = () => {
            // This loop will post all the data at one shot synchronously
            // without waiting for the posted data to be consumed.
            for (let i = 0; i < data.length; ++i) {
                ch.post(data[i]).now();
            }
        };
        let consume = async () => {
            for (let i = 0; i < data.length; ++i) {
                expect(await ch).toBe(data[i]);
                ++count;
            }
        };
        produce();
        await consume();
        expect(count).toBe(data.length);
    });

    test(prefix + 'interleaving', async () => {
        let ch = makeChannel();
        let data = [1,2,3,4,5];
        let produce = async (trace) => {
            for (let i = 0; i < data.length; ++i) {
                trace.push('post ' + i);
                await ch.post(data[i]);
            }
        };
        let consume = async (trace) => {
            for (let i = 0; i < data.length; ++i) {
                expect(await ch).toBe(data[i]);
                trace.push('get ' + i);
            }
        };
        let sync = (trace) => {
            for (let i = 0; i < data.length; ++i) {
                trace.push('post ' + i);
                trace.push('get ' + i);
            }
            return trace;
        };

        let trace = [];
        produce(trace);
        await consume(trace);
        expect(trace).toEqual(sync([]));
    });

    test(prefix + 'erroring out', async () => {
        let ch = makeChannel();
        let data = [1,2,3,4,5];
        let produce = async () => {
            for (let i = 0; i < data.length; ++i) {
                await ch.post(data[i]);
            }
            await ch.error(new Error('done'));
        };
        let consume = async () => {
            let i = 0, errorHappened = false;
            try {
                while (true) {
                    await ch;
                    ++i;
                }
            } catch (e) {
                expect(e.message).toBe('done');
                errorHappened = true;
            } finally {
                expect(i).toBe(data.length);
                expect(errorHappened).toBe(true);
            }
        };
        produce();
        await consume();
    });

    test(prefix + 'error is permanent', async () => {
        let ch = makeChannel(), N = 5;
        let produce = async () => {
            await ch.error(new Error('bang'));
        };
        let consume = async () => {
            let errCount = 0;
            for (let i = 0; i < N; ++i) {
                try {
                    await ch;
                } catch (e) {
                    expect(e.message).toBe('bang');
                    errCount++;
                }
            }
            expect(errCount).toBe(N);
        };

        produce();
        await consume();
    });

    test(prefix + 'promises resolve to their values', async () => {
        let ch = makeChannel();
        let consumed = false, value = 42;
        let produce = async () => {
            // When we post a promise on a channel, the receiver
            // won't receive a promise, but the value produced
            // by the promise. This is a useful short cut interop.
            await ch.post(Promise.resolve(value));
        };
        let consume = async () => {
            expect(await ch).toBe(value);
            consumed = true;
        };
        produce();
        await consume();
        expect(consumed).toBe(true);            
    });

    test(prefix + 'channels resolve to next value sent on them', async () => {
        let ch = makeChannel();
        let consumed = false, chVal = makeChannel(), value = 42;
        let produce = async () => {
            await ch.post(chVal);
        };
        let consume = async () => {
            expect(await ch).toBe(value);
            consumed = true;
        };
        // Delayed post so that we can be sure that the consumer
        // is waiting for a value to arrive on chVal.
        setTimeout(() => { chVal.post(value).now(); }, 10);
        produce();
        await consume();
        expect(consumed).toBe(true);            
    });

    // Check that some special values are treated correctly.
    let specialValues = (descriptor, value) => {
        test(prefix + descriptor + ' is ok', async () => {
            let ch = makeChannel();
            let consumed = false;
            let produce = async () => {
                await ch.post(value);
            };
            let consume = async () => {
                expect(await ch).toBe(value);
                consumed = true;
            };
            produce();
            await consume();
            expect(consumed).toBe(true);            
        });

        if (!Channel.isWrapped(value)) {
            test(prefix + 'raw ' + descriptor + ' value with unwrapping is ok', async () => {
                let ch = makeChannel();
                let consumed = false;
                let produce = async () => {
                    await ch.post(value);
                };
                let consume = async () => {
                    expect(Channel.unwrap(await ch)).toBe(value);
                    consumed = true;
                };
                produce();
                await consume();
                expect(consumed).toBe(true);                 
            });

            test(prefix + 'wrapped ' + descriptor + ' value with unwrapping is ok', async () => {
                let ch = makeChannel();
                let consumed = false;
                let produce = async () => {
                    await ch.post(Channel.wrap(value));
                };
                let consume = async () => {
                    expect(Channel.unwrap(await ch)).toBe(value);
                    consumed = true;
                };
                produce();
                await consume();
                expect(consumed).toBe(true);                 
            });            
        }
    };

    specialValues('null', null);
    specialValues('undefined', undefined);
    specialValues('zero', 0);
    specialValues('empty string', '');
    specialValues('object', {});
    specialValues('array', []);
    specialValues('function', () => {});
    specialValues('async function', async () => {});
    specialValues('wrapped Promise', Channel.wrap(Promise.resolve(42)));
    specialValues('wrapped Channel', Channel.wrap(makeChannel()));
}

suite('fast', Channel.fast);
suite('friendly', Channel.friendly);

