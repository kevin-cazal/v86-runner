/** 9P marshalling (adapted from copy/v86 lib/marshall.js, BSD-2-Clause). */

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function Marshall(typelist, input, struct, offset) {
  let size = 0;
  for (let i = 0; i < typelist.length; i++) {
    const item = input[i];
    switch (typelist[i]) {
      case "w":
        struct[offset++] = item & 0xff;
        struct[offset++] = (item >> 8) & 0xff;
        struct[offset++] = (item >> 16) & 0xff;
        struct[offset++] = (item >> 24) & 0xff;
        size += 4;
        break;
      case "d": {
        // 9p u64: low 32 bits in LE, high 32 zero (match copy/v86 lib/marshall.js).
        const lo = Number(item) >>> 0;
        struct[offset++] = lo & 0xff;
        struct[offset++] = (lo >> 8) & 0xff;
        struct[offset++] = (lo >> 16) & 0xff;
        struct[offset++] = (lo >> 24) & 0xff;
        struct[offset++] = 0;
        struct[offset++] = 0;
        struct[offset++] = 0;
        struct[offset++] = 0;
        size += 8;
        break;
      }
      case "h":
        struct[offset++] = item & 0xff;
        struct[offset++] = item >> 8;
        size += 2;
        break;
      case "b":
        struct[offset++] = item;
        size += 1;
        break;
      case "s": {
        const lengthOffset = offset;
        offset += 2;
        size += 2;
        const stringBytes = textEncoder.encode(item);
        size += stringBytes.byteLength;
        struct.set(stringBytes, offset);
        offset += stringBytes.byteLength;
        struct[lengthOffset] = stringBytes.byteLength & 0xff;
        struct[lengthOffset + 1] = (stringBytes.byteLength >> 8) & 0xff;
        break;
      }
      case "Q":
        Marshall(["b", "w", "d"], [item.type, item.version, item.path], struct, offset);
        offset += 13;
        size += 13;
        break;
      default:
        throw new Error(`Marshall: unknown type ${typelist[i]}`);
    }
  }
  return size;
}

export function Unmarshall(typelist, struct, state) {
  let offset = state.offset;
  const output = [];
  for (let i = 0; i < typelist.length; i++) {
    switch (typelist[i]) {
      case "w": {
        let val = struct[offset++];
        val += struct[offset++] << 8;
        val += struct[offset++] << 16;
        val += (struct[offset++] << 24) >>> 0;
        output.push(val);
        break;
      }
      case "d": {
        let val = struct[offset++];
        val += struct[offset++] << 8;
        val += struct[offset++] << 16;
        val += (struct[offset++] << 24) >>> 0;
        offset += 4;
        output.push(val);
        break;
      }
      case "h": {
        const lo = struct[offset++];
        output.push(lo + (struct[offset++] << 8));
        break;
      }
      case "b":
        output.push(struct[offset++]);
        break;
      case "s": {
        let len = struct[offset++];
        len += struct[offset++] << 8;
        const stringBytes = struct.slice(offset, offset + len);
        offset += len;
        output.push(textDecoder.decode(stringBytes));
        break;
      }
      case "Q": {
        state.offset = offset;
        const qid = Unmarshall(["b", "w", "d"], struct, state);
        offset = state.offset;
        output.push({ type: qid[0], version: qid[1], path: qid[2] });
        break;
      }
      default:
        throw new Error(`Unmarshall: unknown type ${typelist[i]}`);
    }
  }
  state.offset = offset;
  return output;
}
