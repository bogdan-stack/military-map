"use client";

import { GROUNDS, MOVEMENTS, type GroundCondition, type MovementClass } from "@/lib/mcoo/classify";

export function McooPanel({
  movement,
  ground,
  onMovement,
  onGround,
  onClose,
}: {
  movement: MovementClass;
  ground: GroundCondition;
  onMovement: (movement: MovementClass) => void;
  onGround: (ground: GroundCondition) => void;
  onClose: () => void;
}) {
  return (
    <section className="panel panel-mcoo" aria-label="Combined obstacle overlay">
      <div className="panel-head">
        <strong>Obstacle overlay</strong>
        <button type="button" onClick={onClose} aria-label="Close obstacle overlay">
          Close
        </button>
      </div>
      <div className="panel-scroll">
        <p className="mcoo-note">
          Restricted ground is a green diagonal. Severely restricted ground is green cross-hatching. Built-up areas are black, water is blue, and open ground stays clear. It draws from zoom 10.
        </p>
        <label className="mcoo-field">
          Movement
          <select value={movement} onChange={(event) => onMovement(event.target.value as MovementClass)}>
            {MOVEMENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mcoo-field">
          Ground
          <select value={ground} onChange={(event) => onGround(event.target.value as GroundCondition)}>
            {GROUNDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mcoo-legend">
          <div>
            <span className="mcoo-swatch restricted" /> Restricted
          </div>
          <div>
            <span className="mcoo-swatch severe" /> Severely restricted
          </div>
          <div>
            <span className="mcoo-swatch built" /> Built-up
          </div>
          <div>
            <span className="mcoo-swatch water" /> Water
          </div>
        </div>
      </div>
    </section>
  );
}
