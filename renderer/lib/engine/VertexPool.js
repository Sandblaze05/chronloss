function nextPow2(value) {
  if (value <= 1) return 1;
  let v = 1;
  while (v < value) v <<= 1;
  return v;
}

function createPoolBucket() {
  return {
    Float32Array: [],
    Uint32Array: [],
  };
}

export class VertexPool {
  constructor() {
    this.buckets = new Map();
  }

  ensureBucket(key) {
    if (!this.buckets.has(key)) this.buckets.set(key, createPoolBucket());
    return this.buckets.get(key);
  }

  acquireFloat32(minLength) {
    const size = nextPow2(Math.max(1, minLength));
    const bucket = this.ensureBucket(size);
    return bucket.Float32Array.pop() || new Float32Array(size);
  }

  acquireUint32(minLength) {
    const size = nextPow2(Math.max(1, minLength));
    const bucket = this.ensureBucket(size);
    return bucket.Uint32Array.pop() || new Uint32Array(size);
  }

  release(array) {
    if (!array) return;
    const key = array.length;
    const bucket = this.ensureBucket(key);
    if (array instanceof Float32Array) {
      bucket.Float32Array.push(array);
      return;
    }
    if (array instanceof Uint32Array) {
      bucket.Uint32Array.push(array);
    }
  }
}

export const globalVertexPool = new VertexPool();
