"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatInstant, formatOffset, TIME_ZONES, zoneByLetter } from "@/lib/order/dtg";
import type { TimeHit } from "@/lib/order/reading";
import { VERIFIED_ORDER_KEY, type VerifiedOrder } from "@/lib/order/timeline";
import type { UploadReport } from "@/lib/order/upload";

export function OrderReading({ onStarted }: { onStarted?: (order: VerifiedOrder) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoneLetter, setZoneLetter] = useState("Z");
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const [changingZone, setChangingZone] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deferred, setDeferred] = useState<Record<string, boolean>>({});
  const [operationName, setOperationName] = useState("");
  const [ownUnit, setOwnUnit] = useState("");
  const [started, setStarted] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!report) return;
    setZoneLetter(report.timezone?.letter ?? "Z");
    setZoneConfirmed(Boolean(report.timezone?.consistent));
    setChangingZone(false);
    setDecisions({});
    setEditing(null);
    setDeferred({});
    setOperationName(report.identity.operationName);
    setOwnUnit(report.identity.ownUnit);
    setStarted(false);
  }, [report]);

  const zone = zoneByLetter(zoneLetter) ?? TIME_ZONES[TIME_ZONES.length - 1];
  const timesDone = (report?.uncertainTimes ?? []).every((time) => decisions[time.id]);
  const refsDone = (report?.missingReferences ?? []).every((reference) => deferred[reference.letter]);
  const checked = [zoneConfirmed, timesDone, refsDone].filter(Boolean).length;
  const ready = Boolean(report) && !busy && checked === 3;

  const title = useMemo(() => {
    if (!report) return "New operation";
    return `Reading ${report.identity.opordLabel || operationName || "the order"}`;
  }, [operationName, report]);

  async function submit(next: File[]) {
    if (!next.length) return;
    setFiles(next);
    setBusy(true);
    setError("");
    const body = new FormData();
    for (const file of next) body.append("files", file);
    try {
      const response = await fetch("/api/orders", { method: "POST", body });
      const data = (await response.json()) as UploadReport & { error?: string };
      if (!response.ok) throw new Error(data.error || "The order could not be read.");
      setReport(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function takeFiles(list: FileList | File[] | null) {
    const incoming = [...(list ?? [])];
    if (!incoming.length) return;
    void submit([...files, ...incoming]);
  }

  function reset() {
    setFiles([]);
    setReport(null);
    setError("");
    setStarted(false);
    setDecisions({});
    setDeferred({});
  }

  function labelFor(time: TimeHit) {
    if (decisions[time.id]) return decisions[time.id];
    if (time.utcMs != null) return formatInstant(time.utcMs, zone.offsetHours);
    return "";
  }

  function start() {
    if (!report || !ready) return;
    const verified: VerifiedOrder = {
      verifiedAt: new Date().toISOString(),
      operationName,
      ownUnit,
      fromUnit: report.identity.fromUnit,
      zoneLetter,
      offsetHours: zone.offsetHours,
      files: report.files.map((file) => ({ name: file.name, sha256: file.sha256 })),
      times: report.times.map((time) => ({
        id: time.id,
        raw: time.raw,
        phrase: time.phrase,
        anchor: time.anchor,
        context: time.context,
        qualifierLabel: time.qualifierLabel,
        utcMs: time.utcMs,
      })),
      deferredReferences: report.missingReferences.filter((reference) => deferred[reference.letter]).map((reference) => reference.letter),
    };
    try {
      sessionStorage.setItem(VERIFIED_ORDER_KEY, JSON.stringify(verified));
    } catch {
      setError("The browser could not keep this check for the session.");
      return;
    }
    setStarted(true);
    onStarted?.(verified);
  }

  const bannerName = (operationName || report?.identity.operationName || "").toUpperCase();

  return (
    <div className="plan-app">
      <div className="plan-banner">UNCLASSIFIED · EXERCISE{bannerName ? ` · ${bannerName}` : ""}</div>
      <div className="plan-wrap">
        <div className="plan-top">
          {report || busy ? (
            <button type="button" className="plan-back" onClick={reset}>‹ New operation</button>
          ) : null}
        </div>
        <h1>{title}</h1>
        <p className="plan-lead">
          {report?.identity.fromUnit ? `From ${report.identity.fromUnit} · ` : ""}
          {files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} · ` : ""}
          {busy ? "Reading the files." : "Almost done. Meanwhile, please check three things."}
        </p>
        {error ? <p className="plan-error">{error}</p> : null}

        {!report && !busy ? (
          <label
            className="plan-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              takeFiles(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={(event) => {
                takeFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <strong>Drop the HHQ order and its annexes</strong>
            <span>PDF, Word (.docx), PNG, or JPEG. Legacy .doc, PowerPoint, Excel, and email are not read yet.</span>
            <span className="plan-browse">Browse files</span>
          </label>
        ) : (
          <div className="plan-grid">
            <section className="plan-card">
              <ol className="plan-steps">
                <Step done={!busy && Boolean(report)} current={busy} title="Read all files" detail={readDetail(report, busy)} />
                <Step done={!busy && Boolean(report)} title="Find the order's structure" detail={report ? `${report.paragraphCount} paragraphs, ${report.annexCount} annexes, ${report.referenceCount} references` : "Waiting for the text."} />
                <Step done={!busy && Boolean(report)} title={report ? `Found ${countLabel(report.counts.times, "time")}, ${countLabel(report.counts.places, "place")}, ${countLabel(report.counts.units, "unit")}` : "Find times, places, and units"} detail="Each one linked to its paragraph." />
                <Step waiting title="Placing them on the map and timeline…" detail="The map stays in view. The clocks open in the next drawers." />
              </ol>
              {report?.findings.length ? <p className="plan-findings">{report.findings.join(" ")}</p> : null}
              <h2>Files</h2>
              <ul className="plan-files">
                {(report?.files ?? files.map((file) => ({ name: file.name, kind: "other" as const, detail: "Reading…", status: "read" as const }))).map((file) => (
                  <li key={file.name}>
                    <span className={`plan-kind kind-${file.kind}`}>{file.kind === "other" ? "FILE" : file.kind.toUpperCase()}</span>
                    <span>
                      <strong>{file.name}</strong>
                      <small>{file.detail}</small>
                    </span>
                    <em className={file.status === "read" ? "is-read" : ""}>{file.status === "read" ? "Read" : "Not read"}</em>
                  </li>
                ))}
              </ul>
            </section>

            <div className="plan-side">
              <article className={zoneConfirmed && !changingZone ? "plan-card plan-ok" : "plan-card"}>
                <header>
                  <span className="plan-tick" aria-hidden="true">{zoneConfirmed ? "✓" : "1"}</span>
                  <div>
                    <strong>Time zone: {zone.name} ({formatOffset(zone.offsetHours)})</strong>
                    <p>{zoneConfirmed ? "All times in the app are shown in local time. Confirmed." : "Confirm the zone letter from the order before the times are trusted."}</p>
                  </div>
                  {zoneConfirmed && !changingZone ? (
                    <button type="button" onClick={() => setChangingZone(true)}>Change</button>
                  ) : null}
                </header>
                {(!zoneConfirmed || changingZone) && (
                  <div className="plan-actions">
                    <label>
                      Zone
                      <select value={zone.letter} onChange={(event) => setZoneLetter(event.target.value)}>
                        {TIME_ZONES.map((item) => (
                          <option key={item.letter} value={item.letter}>{item.name} ({formatOffset(item.offsetHours)})</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="plan-primary" onClick={() => { setZoneConfirmed(true); setChangingZone(false); }}>
                      Confirm zone
                    </button>
                  </div>
                )}
              </article>

              <article className="plan-card">
                <header>
                  <span className="plan-num">2</span>
                  <strong>{timeHeading(report)}</strong>
                </header>
                {report && report.uncertainTimes.length === 0 ? <p className="plan-note">Every time was read clearly.</p> : null}
                {report?.uncertainTimes.map((time) => {
                  const label = labelFor(time);
                  return (
                    <div key={time.id} className="plan-time">
                      <p className="plan-phrase">…{time.qualifierLabel ? `${time.qualifierLabel} ` : ""}<mark>{time.raw}</mark></p>
                      <p className="plan-when">{label || "This phrase is not one instant yet."}</p>
                      <p className="plan-note">{time.context}{time.anchor ? ` Paragraph ${time.anchor}.` : ""}</p>
                      {editing === time.id ? (
                        <div className="plan-actions">
                          <label>
                            Correct time
                            <input value={draft} onChange={(event) => setDraft(event.target.value)} />
                          </label>
                          <button type="button" className="plan-primary" disabled={!draft.trim()} onClick={() => { setDecisions((current) => ({ ...current, [time.id]: draft.trim() })); setEditing(null); }}>
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="plan-actions">
                          {decisions[time.id] ? <span className="plan-accepted">That's right</span> : (
                            <button type="button" className="plan-primary" disabled={!label} onClick={() => setDecisions((current) => ({ ...current, [time.id]: label }))}>
                              That's right
                            </button>
                          )}
                          <button type="button" onClick={() => { setEditing(time.id); setDraft(label); }}>Edit</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </article>

              <article className="plan-card">
                <header>
                  <span className="plan-num">3</span>
                  <strong>{referenceHeading(report)}</strong>
                </header>
                {report && report.missingReferences.length === 0 ? <p className="plan-note">Every cited reference is in this upload.</p> : null}
                {report?.missingReferences.map((reference) => (
                  <div key={reference.letter} className="plan-ref">
                    <p>
                      Reference {reference.letter}{reference.title ? `, “${reference.title}”,` : ""} is listed in the order but was not uploaded.
                      {reference.anchor ? ` ${reference.anchor}.` : ""}
                    </p>
                    {deferred[reference.letter] ? <p className="plan-note">You will ask higher headquarters later.</p> : (
                      <div className="plan-actions">
                        <button type="button" onClick={() => addRef.current?.click()}>Upload it</button>
                        <button type="button" onClick={() => setDeferred((current) => ({ ...current, [reference.letter]: true }))}>Ask HHQ later</button>
                      </div>
                    )}
                  </div>
                ))}
                <input
                  ref={addRef}
                  type="file"
                  multiple
                  hidden
                  accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  onChange={(event) => {
                    takeFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </article>

              <article className="plan-card plan-identity">
                <label>
                  Operation name
                  <input value={operationName} onChange={(event) => setOperationName(event.target.value)} />
                </label>
                <label>
                  Our unit
                  <input value={ownUnit} onChange={(event) => setOwnUnit(event.target.value)} />
                </label>
                <p className="plan-note">Filled in from the order. Your planning team gets a notification when you start.</p>
              </article>

              <footer className="plan-go">
                {started ? (
                  <p>This order is checked. The mission clock is open beside the map.</p>
                ) : (
                  <>
                    <span>{checked} of 3 checked</span>
                    <button type="button" className="plan-primary" disabled={!ready} onClick={start}>Start Step 1</button>
                  </>
                )}
              </footer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function countLabel(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function readDetail(report: UploadReport | null, busy: boolean) {
  if (busy || !report) return "Reading the files.";
  if (report.ocrPages > 0) return `${report.ocrPages} scanned ${report.ocrPages === 1 ? "page" : "pages"} converted to text.`;
  const pages = report.pagesRead || report.files.length;
  return `${pages} ${pages === 1 ? "page" : "pages"} read.`;
}

function timeHeading(report: UploadReport | null) {
  if (!report || report.uncertainTimes.length === 0) return "Times";
  if (report.uncertainTimes.length === 1) return "One time was hard to read";
  return `${report.uncertainTimes.length} times were hard to read`;
}

function referenceHeading(report: UploadReport | null) {
  if (!report || report.missingReferences.length === 0) return "References";
  if (report.missingReferences.length === 1) return "A reference is missing";
  return "References are missing";
}

function Step({ done, current, waiting, title, detail }: { done?: boolean; current?: boolean; waiting?: boolean; title: string; detail: string }) {
  return (
    <li className={waiting ? "is-waiting" : done ? "is-done" : current ? "is-current" : ""}>
      <span aria-hidden="true">{done ? "✓" : ""}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
        {waiting ? <i /> : null}
      </div>
    </li>
  );
}
