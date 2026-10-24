import { stripAnsi } from "./text.ts";

/** A structured line written by the E2E helper plugin: `E2E <TAG> key=value key=value`. */
export interface HelperLine {
  readonly tag: string;
  readonly fields: Readonly<Record<string, string>>;
}

const HELPER_PATTERN = /\bE2E ([A-Z0-9_]+)((?: [A-Za-z0-9_]+=\S*)*)\s*$/;

export function parseHelperLine(line: string): HelperLine | null {
  const match = HELPER_PATTERN.exec(stripAnsi(line));
  if (match === null) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const pair of (match[2] ?? "").trim().split(" ")) {
    const index = pair.indexOf("=");
    if (index > 0) {
      fields[pair.slice(0, index)] = pair.slice(index + 1);
    }
  }
  return { tag: match[1] ?? "", fields };
}

export interface PlayerPosition {
  readonly player: string;
  readonly world: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The vehicle the player is riding, or `null`. */
  readonly vehicle: string | null;
}

export function toPosition(line: HelperLine): PlayerPosition | null {
  if (line.tag !== "POS") {
    return null;
  }
  const { player, world, x, y, z, vehicle } = line.fields;
  if (player === undefined || world === undefined) {
    return null;
  }
  const [px, py, pz] = [Number(x), Number(y), Number(z)];
  if (![px, py, pz].every(Number.isFinite)) {
    return null;
  }
  return {
    player,
    world,
    x: px,
    y: py,
    z: pz,
    vehicle: vehicle === undefined || vehicle === "none" ? null : vehicle,
  };
}
