/**
 * signalsmith-stretch ships as an AudioWorklet node. When its module sees
 * AudioWorkletProcessor/registerProcessor it registers its processor class
 * instead of building a node. We provide stand-ins so it hands that class to us:
 * constructing it instantiates the WASM stretcher, which we then drive offline
 * (in a Worker in the app, directly in Node for tests).
 *
 * This module must be imported before 'signalsmith-stretch'.
 */
const g = globalThis as any

export let capturedProcessor: (new (options: any) => any) | null = null

if (typeof g.AudioWorkletProcessor !== 'function') {
  g.AudioWorkletProcessor = class {
    port = { postMessage() {}, onmessage: null as unknown }
  }
}
g.registerProcessor = (_name: string, cls: new (options: any) => any) => { capturedProcessor = cls }
