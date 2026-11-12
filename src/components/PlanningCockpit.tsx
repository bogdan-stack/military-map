"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OrderReading } from "@/components/OrderReading";
import { zoneByLetter } from "@/lib/order/dtg";
import {
  formatDuration,
  formatWhen,
  missionClock,
  readVerifiedOrder,
  STAFF_PRESETS,
  staffClock,
  VERIFIED_ORDER_KEY,
  type BriefId,
  type StaffPresetId,
  type VerifiedOrder,
} from "@/lib/order/timeline";

type DrawerId = "order" | "mission" | "staff";

export function PlanningCockpit({ open }: { open: boolean }) {
  const [order, setOrder] = useState<VerifiedOrder | null>(null);
  const [drawers, setDrawers] = useState<Record<DrawerId, boolean>>({ order: true, mission: false, staff: false });
  const [preset, setPreset] = useState<StaffPresetId>("arrc");
  const [accepted, setAccepted] = useState<Partial<Record<BriefId, boolean>>>({});

  useEffect(() => {
    const saved = readVerifiedOrder(sessionStorage.getItem(VERIFIED_ORDER_KEY));
    if (!saved) return;
    setOrder(saved);
    setDrawers({ order: false, mission: true, staff: false });
  }, []);

  function toggle(id: DrawerId) {
    setDrawers((current) => ({ ...current, [id]: !current[id] }));
  }

  const banner = (order?.operationName || "").toUpperCase();

  return (
    <aside className={`cockpit${open ? "" : " is-shut"}`} aria-hidden={open ? undefined : true} aria-label="Planning">
      <div className="cockpit-banner">UNCLASSIFIED · EXERCISE{banner ? ` · ${banner}` : ""}</div>
      <div className="cockpit-scroll">
        <Drawer title="Order" open={drawers.order} onToggle={() => toggle("order")}>
          <OrderReading
            onStarted={(next) => {
              setOrder(next);
              setAccepted({});
              setDrawers({ order: false, mission: true, staff: true });
            }}
          />
        </Drawer>
        <Drawer title="Mission timeline" open={drawers.mission} onToggle={() => toggle("mission")}>
          <MissionTimeline order={order} />
        </Drawer>
        <Drawer title="Staff planning timeline" open={drawers.staff} onToggle={() => toggle("staff")}>
          <StaffTimeline
            order={order}
            preset={preset}
            accepted={accepted}
            onPreset={setPreset}
            onAccept={(id, value) => setAccepted((current) => ({ ...current, [id]: value }))}
          />
        </Drawer>
      </div>
    </aside>
  );
}

function Drawer({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`cockpit-drawer${open ? " is-open" : ""}`}>
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <small>{open ? "Collapse" : "Open"}</small>
      </button>
      <div className="cockpit-drawer-body" hidden={!open}>{children}</div>
    </section>
  );
}

function MissionTimeline({ order }: { order: VerifiedOrder | null }) {
  if (!order) return <p className="cockpit-empty">Check the order first. The clock uses the times from that check.</p>;
  const zone = zoneByLetter(order.zoneLetter);
  const offset = zone?.offsetHours ?? order.offsetHours;
  const clock = missionClock(order.times, offset);
  if (!clock.ready) {
    const missing = [clock.missingReceipt ? "the time the order was received" : "", clock.missingHHour ? "H-hour" : ""].filter(Boolean);
    return (
      <p className="cockpit-empty">
        This order does not give {missing.join(" or ")}. The clock stays blank until both ends are in the order.
      </p>
    );
  }
  return (
    <div className="clock">
      <p className="clock-zone">{zone ? `${zone.name} · local time` : "Local time"}</p>
      <ol>
        <li>
          <strong>Order received</strong>
          <em>{formatWhen(clock.receipt.utcMs!, offset)}</em>
          <span>{clock.receipt.raw}{clock.receipt.anchor ? ` · ${clock.receipt.anchor}` : ""}</span>
        </li>
        <li>
          <strong>H-hour</strong>
          <em>{formatWhen(clock.hHour.utcMs!, offset)}</em>
          <span>{clock.hHour.raw}{clock.hHour.anchor ? ` · ${clock.hHour.anchor}` : ""}</span>
        </li>
        <li>
          <strong>Time available</strong>
          <em>{formatDuration(clock.availableMs)}</em>
          <span>From receipt to H-hour.</span>
        </li>
        <li>
          <strong>Our one-third share</strong>
          <em>{formatDuration(clock.ownMs)}</em>
          <span>OPORD due {formatWhen(clock.opordUtc, offset)}.</span>
        </li>
        <li>
          <strong>Subordinates</strong>
          <em>{formatDuration(clock.subordinateMs)}</em>
          <span>The two-thirds they keep.</span>
        </li>
      </ol>
      <h3>Higher headquarters constraints</h3>
      {clock.constraints.length === 0 ? <p className="cockpit-empty">No other times were found in the order.</p> : (
        <ul className="clock-constraints">
          {clock.constraints.map((time) => (
            <li key={time.id}>
              <strong>{time.raw}</strong>
              <span>{time.qualifierLabel ? `${time.qualifierLabel}. ` : ""}{time.utcMs != null ? formatWhen(time.utcMs, offset) : "Not one instant."}</span>
              {time.anchor ? <small>{time.anchor}</small> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaffTimeline({
  order,
  preset,
  accepted,
  onPreset,
  onAccept,
}: {
  order: VerifiedOrder | null;
  preset: StaffPresetId;
  accepted: Partial<Record<BriefId, boolean>>;
  onPreset: (preset: StaffPresetId) => void;
  onAccept: (id: BriefId, accepted: boolean) => void;
}) {
  if (!order) return <p className="cockpit-empty">Check the order first.</p>;
  const zone = zoneByLetter(order.zoneLetter);
  const offset = zone?.offsetHours ?? order.offsetHours;
  const clock = missionClock(order.times, offset);
  if (!clock.ready) return <p className="cockpit-empty">The staff clock needs the same receipt time and H-hour.</p>;
  const staff = staffClock(clock.receipt.utcMs!, clock.opordUtc, offset, preset, accepted);
  if (!staff) return <p className="cockpit-empty">Our share is shorter than the receipt-of-mission brief, so the later steps have no time.</p>;
  const ordersShare = STAFF_PRESETS[preset].weights[3] * 100;
  return (
    <div className="clock">
      <div className="clock-presets" role="group" aria-label="Staff split">
        {(Object.keys(STAFF_PRESETS) as StaffPresetId[]).map((id) => (
          <button key={id} type="button" aria-pressed={preset === id} onClick={() => onPreset(id)}>
            {STAFF_PRESETS[id].label}
            <small>{STAFF_PRESETS[id].detail}</small>
          </button>
        ))}
      </div>
      <ol>
        <li>
          <strong>Step 1 · Receipt of mission</strong>
          <em>{formatDuration(staff.stepOneMs)}</em>
          <span>Receipt-of-mission brief {formatWhen(staff.romUtc, offset)}. This step stays fixed.</span>
        </li>
        {staff.briefs.map((brief) => (
          <li key={brief.id} className={brief.dark ? "is-dark" : ""}>
            <strong>{brief.step}</strong>
            <em>{brief.shareLabel} · {formatDuration(brief.durationMs)}</em>
            <span>{brief.name} {formatWhen(brief.utcMs, offset)}.</span>
            {brief.dark ? (
              <span className="clock-dark">
                Falls in darkness.{brief.suggestedUtcMs != null ? ` Daylight is ${formatWhen(brief.suggestedUtcMs, offset)}.` : ""}
                {brief.accepted ? (
                  <button type="button" onClick={() => onAccept(brief.id, false)}>Keep the order time</button>
                ) : (
                  <button type="button" onClick={() => onAccept(brief.id, true)}>Use daylight</button>
                )}
              </span>
            ) : null}
          </li>
        ))}
        <li>
          <strong>Step 7 · Orders</strong>
          <em>{Number.isInteger(ordersShare) ? ordersShare : ordersShare}% · {formatDuration(staff.ordersMs)}</em>
          <span>OPORD {formatWhen(staff.opordUtc, offset)}. This time stays on the one-third mark.</span>
        </li>
      </ol>
    </div>
  );
}
