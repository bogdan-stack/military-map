import { describe, expect, it } from "vitest";
import { findDtgs, formatInstant } from "./dtg";
import { chooseEnds, daylightSuggestion, formatDuration, missionClock, staffClock, type ClockTime } from "./timeline";

function at(text: string) {
  const parsed = findDtgs(text);
  if (!parsed[0]) throw new Error(`no dtg in ${text}`);
  return parsed[0];
}

const receipt = at("121000B NOV 26");
const hHour = at("190600B NOV 26");
const other = at("180200B NOV 26");

const times: ClockTime[] = [
  {
    id: "receipt",
    raw: "121000B NOV 26",
    phrase: "121000B NOV 26",
    anchor: "1.a",
    context: "Timeline. Order received 121000B NOV 26.",
    qualifierLabel: null,
    utcMs: receipt.utcMs,
  },
  {
    id: "hhour",
    raw: "190600B NOV 26",
    phrase: "not later than 190600B NOV 26",
    anchor: "2",
    context: "2 MN BDE attacks in the northern zone NLT 190600B NOV 26 to seize OBJ FALCON.",
    qualifierLabel: "not later than",
    utcMs: hHour.utcMs,
  },
  {
    id: "net",
    raw: "180200B NOV 26",
    phrase: "not earlier than 180200B NOV 26",
    anchor: "3.b.(2)(d)",
    context: "Movement not earlier than 180200B NOV 26.",
    qualifierLabel: "not earlier than",
    utcMs: other.utcMs,
  },
];

describe("mission clock", () => {
  it("applies the one-third rule to 121000B and 190600B", () => {
    const clock = missionClock(times, 2);
    expect(clock.ready).toBe(true);
    if (!clock.ready) return;
    expect(formatDuration(clock.availableMs)).toBe("164 h 00 min");
    expect(formatDuration(clock.ownMs)).toBe("54 h 40 min");
    expect(formatDuration(clock.subordinateMs)).toBe("109 h 20 min");
    expect(formatInstant(clock.opordUtc, 2)).toBe("Sat 14 Nov, 16:40");
    expect(clock.constraints.map((time) => time.id)).toEqual(["net"]);
    expect(clock.receipt.anchor).toBe("1.a");
    expect(clock.hHour.anchor).toBe("2");
  });

  it("says so when an end is missing", () => {
    const clock = missionClock([times[0]], 2);
    expect(clock.ready).toBe(false);
    if (clock.ready) return;
    expect(clock.missingHHour).toBe(true);
  });
});

describe("staff split", () => {
  it("splits the worked example ARRC-style and flags the dark briefs", () => {
    const clock = missionClock(times, 2);
    if (!clock.ready) throw new Error("clock");
    const staff = staffClock(clock.receipt.utcMs!, clock.opordUtc, 2, "arrc");
    if (!staff) throw new Error("staff");
    expect(formatInstant(staff.romUtc, 2)).toBe("Thu 12 Nov, 12:30");
    expect(formatDuration(staff.stepOneMs)).toBe("2 h 30 min");
    expect(formatInstant(staff.briefs[0].rawUtc, 2)).toBe("Fri 13 Nov, 04:09");
    expect(formatInstant(staff.briefs[1].rawUtc, 2)).toBe("Fri 13 Nov, 19:48");
    expect(formatInstant(staff.briefs[2].rawUtc, 2)).toBe("Sat 14 Nov, 06:14");
    expect(staff.briefs[0].dark).toBe(true);
    expect(formatInstant(staff.briefs[0].suggestedUtcMs!, 2)).toBe("Fri 13 Nov, 08:00");
    expect(staff.briefs[1].dark).toBe(false);
    expect(staff.briefs[2].dark).toBe(true);
    expect(formatInstant(staff.briefs[2].suggestedUtcMs!, 2)).toBe("Sat 14 Nov, 08:00");
    expect(formatDuration(staff.briefs[0].durationMs)).toBe("15 h 39 min");
    expect(formatDuration(staff.ordersMs)).toBe("10 h 26 min");
  });

  it("moves the dark briefs to daylight and leaves the OPORD time", () => {
    const clock = missionClock(times, 2);
    if (!clock.ready) throw new Error("clock");
    const staff = staffClock(clock.receipt.utcMs!, clock.opordUtc, 2, "arrc", {
      missionAnalysis: true,
      decision: true,
    });
    if (!staff) throw new Error("staff");
    expect(staff.opordUtc).toBe(clock.opordUtc);
    expect(formatInstant(staff.briefs[0].utcMs, 2)).toBe("Fri 13 Nov, 08:00");
    expect(formatInstant(staff.briefs[1].utcMs, 2)).toBe("Fri 13 Nov, 19:48");
    expect(formatDuration(staff.briefs[1].durationMs)).toBe("11 h 48 min");
    expect(formatDuration(staff.briefs[2].durationMs)).toBe("12 h 12 min");
    expect(formatDuration(staff.ordersMs)).toBe("8 h 40 min");
  });

  it("offers the ATP preset as the other fixed split", () => {
    const clock = missionClock(times, 2);
    if (!clock.ready) throw new Error("clock");
    const arrc = staffClock(clock.receipt.utcMs!, clock.opordUtc, 2, "arrc");
    const atp = staffClock(clock.receipt.utcMs!, clock.opordUtc, 2, "atp");
    if (!arrc || !atp) throw new Error("staff");
    expect(atp.briefs[0].rawUtc).not.toBe(arrc.briefs[0].rawUtc);
    expect(atp.opordUtc).toBe(clock.opordUtc);
  });
});

describe("daylight", () => {
  it("keeps 07:00 and 20:00 and moves a late brief to the next morning", () => {
    const seven = at("120700B NOV 26").utcMs;
    const twenty = at("122000B NOV 26").utcMs;
    const late = at("122001B NOV 26").utcMs;
    expect(daylightSuggestion(seven, 2)).toBeNull();
    expect(daylightSuggestion(twenty, 2)).toBeNull();
    expect(formatInstant(daylightSuggestion(late, 2)!, 2)).toBe("Fri 13 Nov, 08:00");
  });
});

describe("chooseEnds", () => {
  it("takes the earliest receipt and the latest execution time", () => {
    const ends = chooseEnds(times);
    expect(ends.receipt?.id).toBe("receipt");
    expect(ends.hHour?.id).toBe("hhour");
  });
});
