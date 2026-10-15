import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  Activity, ArrowDownRight, ArrowRight, CalendarDays, Check, CheckCircle2,
  ChevronDown, Clock3, Dumbbell, LogOut, RefreshCw, ShieldCheck, Ticket,
  Users, X, Zap, ClipboardCheck, Hourglass, CircleDot, LoaderCircle
} from "lucide-react";
import "./styles.css";

const socket = io();
const API = "/api";
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const fmtRange = (iso) => {
  const start = new Date(iso);
  return `${fmtTime(iso)} – ${fmtTime(new Date(start.getTime() + 3600000).toISOString())}`;
};

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

function App() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [activeEmail, setActiveEmail] = useState("");
  const [selectedDay, setSelectedDay] = useState("all");
  const [tab, setTab] = useState("book");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState("");
  const [lastBooking, setLastBooking] = useState(null);
  const [checkCode, setCheckCode] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [staffSession, setStaffSession] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await api("/sessions");
      setSessions(data);
    } catch (error) {
      setNotice({ type: "error", text: `${error.message} Is the server running?` });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    socket.on("session:update", (updated) => {
      setSessions((old) => {
        const exists = old.some((s) => s.id === updated.id);
        return exists ? old.map((s) => s.id === updated.id ? updated : s) : [...old, updated].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      });
    });
    return () => socket.off("session:update");
  }, [refresh]);

  const days = useMemo(() => [...new Set(sessions.map((s) => fmtDay(s.starts_at)))], [sessions]);
  const visibleSessions = sessions.filter((s) => selectedDay === "all" || fmtDay(s.starts_at) === selectedDay);
  const myBookings = sessions.flatMap((s) =>
  (s.bookings || [])
    .filter((b) => activeEmail && b.member_email === activeEmail)
    .map((b) => ({
      ...b,
      starts_at: s.starts_at,
    }))
);


  async function book(session) {
    if (memberName.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail.trim())) {
      setNotice({ type: "error", text: "Enter your name and a valid email before booking." }); return;
    }
    setBusy(session.id); setNotice(null);
    try {
      const booking = await api("/bookings", { method: "POST", body: JSON.stringify({ sessionId: session.id, memberName, memberEmail }) });
      setActiveEmail(memberEmail.trim().toLowerCase());
      setLastBooking(booking);
      setNotice({ type: "success", text: booking.status === "confirmed" ? "You're booked. Save your code for check-in." : `You're on the waitlist at position ${booking.queue_position}.` });
      setTab("my-bookings");
      await refresh();
    } catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setBusy(""); }
  }

  async function cancel(booking) {
    setBusy(booking.id); setNotice(null);
    try {
      await api(`/bookings/${booking.id}/cancel`, { method: "POST" });
      setNotice({ type: "success", text: "Booking cancelled. If a mat opened up, the next person was promoted automatically." });
      setLastBooking(null); await refresh();
    } catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setBusy(""); }
  }

  async function checkIn(event) {
    event.preventDefault(); setCheckResult(null);
    try {
      const result = await api("/check-in", { method: "POST", body: JSON.stringify({ code: checkCode }) });
      setCheckResult({ ok: true, ...result }); setCheckCode("");
    } catch (error) { setCheckResult({ ok: false, message: error.message }); }
  }

  const activeSession = sessions.find((s) => s.id === staffSession) || sessions[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setTab("book"); }}>
          <span className="brand-mark"><Dumbbell size={19} strokeWidth={2.5}/></span>
          <span>mat<span className="brand-light">time</span><small>YOUR HOUR. YOUR SPACE.</small></span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator"><span/> LIVE AVAILABILITY</span>
          <button className="icon-button" onClick={refresh} aria-label="Refresh sessions"><RefreshCw size={17}/></button>
          <div className="avatar">M</div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line"/> THE FLOOR IS YOURS</div>
            <h1>Make room<br/>for <em>yourself.</em></h1>
            <p>One hour. One good session. Find your slot, claim your mat, and show up for you.</p>
            <div className="hero-meta"><span><Clock3 size={15}/> Hourly sessions</span><span><Users size={15}/> 20 mats per class</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-ring ring-one"/><div className="art-ring ring-two"/><div className="art-ring ring-three"/>
            <div className="art-core"><Activity size={56} strokeWidth={1.15}/></div>
            <div className="art-label label-top"><span className="pulse-dot"/> YOUR NEXT HOUR</div>
            <div className="art-label label-bottom"><span>01</span> SHOW UP STRONG</div>
          </div>
          <div className="hero-index">EST. FOR YOUR NEXT REP <ArrowDownRight size={15}/></div>
        </section>

        {notice && <div className={`notice ${notice.type}`} role="status"><span>{notice.type === "success" ? <CheckCircle2 size={18}/> : <X size={18}/>}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16}/></button></div>}

        <section className="booking-section" id="sessions">
          <div className="section-heading">
            <div><div className="eyebrow"><span className="eyebrow-line"/> MAKE IT HAPPEN</div><h2>Find your <em>hour.</em></h2></div>
            <div className="capacity-note"><span className="capacity-icon"><Users size={17}/></span><span><strong>20 mats.</strong><small>Never one more.</small></span></div>
          </div>

          <div className="workspace">
            <aside className="booking-sidebar">
              <div className="sidebar-card">
                <div className="step-label"><span>01</span> YOUR DETAILS</div>
                <label htmlFor="memberName">Full name</label>
                <input id="memberName" value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="e.g. Alex Morgan" autoComplete="name"/>
                <label htmlFor="memberEmail">Email address</label>
                <input id="memberEmail" type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="you@example.com" autoComplete="email"/>
                <p className="form-hint"><ShieldCheck size={14}/> Your email identifies your bookings.</p>
              </div>
              <div className="sidebar-card filters-card">
                <div className="step-label"><span>02</span> PICK YOUR DAY</div>
                <button className={`day-filter ${selectedDay === "all" ? "selected" : ""}`} onClick={() => setSelectedDay("all")}><span>All available days</span><ArrowRight size={15}/></button>
                {days.map((day) => <button key={day} className={`day-filter ${selectedDay === day ? "selected" : ""}`} onClick={() => setSelectedDay(day)}><span>{day}</span><ArrowRight size={15}/></button>)}
              </div>
              <div className="sidebar-tip"><Zap size={17}/><p><strong>Plans change.</strong><br/>Cancel anytime. The next person in line gets the mat.</p></div>
            </aside>

            <div className="sessions-area">
              <div className="tabs">
                <button className={tab === "book" ? "active" : ""} onClick={() => setTab("book")}>Available slots <span>{visibleSessions.length}</span></button>
                <button className={tab === "my-bookings" ? "active" : ""} onClick={() => { setTab("my-bookings"); if (memberEmail) setActiveEmail(memberEmail.trim().toLowerCase()); }}>My bookings <span>{myBookings.length}</span></button>
                <button className={tab === "staff" ? "active" : ""} onClick={() => setTab("staff")}>Staff check-in</button>
              </div>

              {tab === "book" && <div className="session-list">
                {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24}/><p>Finding your next hour…</p></div> :
                  visibleSessions.length === 0 ? <div className="empty-state"><CalendarDays size={28}/><p>No sessions found for this day.</p></div> :
                  visibleSessions.map((session, index) => <SessionCard key={session.id} session={session} index={index} busy={busy === session.id} onBook={() => book(session)}/>)}
              </div>}

              {tab === "my-bookings" && <div className="my-bookings">
                <div className="member-lookup"><div><strong>Your upcoming sessions</strong><p>Use the same email you booked with.</p></div><input aria-label="Booking email" type="email" placeholder="Your booking email" value={activeEmail || memberEmail} onChange={(e) => setActiveEmail(e.target.value.trim().toLowerCase())}/></div>
                {myBookings.length === 0 ? <div className="empty-state"><Ticket size={29}/><p>No active bookings for this email.</p><button className="text-button" onClick={() => setTab("book")}>Find a session <ArrowRight size={15}/></button></div> :
                  myBookings.sort((a,b) => a.starts_at.localeCompare(b.starts_at)).map((b) => <BookingRow key={b.id} booking={b} busy={busy === b.id} onCancel={() => cancel(b)}/>)}
              </div>}

              {tab === "staff" && <div className="staff-panel">
                <div className="staff-title"><div className="staff-icon"><ClipboardCheck size={22}/></div><div><h3>Door check-in</h3><p>Validate a member's booking code.</p></div></div>
                <form onSubmit={checkIn} className="checkin-form"><label htmlFor="booking-code">8-character booking code</label><div className="code-entry"><input id="booking-code" value={checkCode} onChange={(e) => setCheckCode(e.target.value.toUpperCase().slice(0,8))} placeholder="A1B2C3D4" maxLength={8} autoComplete="off"/><button type="submit" disabled={checkCode.length !== 8}><Check size={17}/> Check in</button></div></form>
                {checkResult && <div className={`check-result ${checkResult.ok ? "ok" : "bad"}`}>{checkResult.ok ? <CheckCircle2 size={20}/> : <X size={20}/>}<div><strong>{checkResult.ok ? checkResult.memberName : "Check-in failed"}</strong><p>{checkResult.message}</p></div></div>}
                <div className="staff-session"><label htmlFor="staff-session">Session overview</label><select id="staff-session" value={staffSession || sessions[0]?.id || ""} onChange={(e) => setStaffSession(e.target.value)}>{sessions.map((s) => <option key={s.id} value={s.id}>{fmtDay(s.starts_at)} · {fmtRange(s.starts_at)}</option>)}</select>
                  {activeSession && <div className="staff-stats"><div><strong>{activeSession.booked}</strong><span>Occupied mats</span></div><div><strong>{activeSession.remaining}</strong><span>Mats left</span></div><div><strong>{activeSession.waitlist_count}</strong><span>Waitlisted</span></div></div>}
                  {activeSession && <div className="roster">{(activeSession.bookings || []).filter((b) => ["confirmed","checked_in"].includes(b.status)).map((b) => <div className="roster-row" key={b.id}><span className={`roster-dot ${b.status === "checked_in" ? "checked" : ""}`}/><span>{b.member_name}<small>{b.code || "Checked in"}</small></span><span className={`roster-status ${b.status}`}>{b.status === "checked_in" ? "Arrived" : "Booked"}</span></div>)}</div>}
                </div>
                <p className="staff-disclaimer"><ShieldCheck size={14}/> Demo staff screen — add staff authentication before production.</p>
              </div>}
            </div>
          </div>
        </section>

        <section className="how-section">
          <div><div className="eyebrow"><span className="eyebrow-line"/> SIMPLE BY DESIGN</div><h2>Booked in<br/>three <em>moves.</em></h2></div>
          <div className="how-steps"><div><span>01</span><CalendarDays size={20}/><strong>Pick your hour</strong><p>Choose a session with room on the floor.</p></div><div><span>02</span><Ticket size={20}/><strong>Get your code</strong><p>Your spot is confirmed, or you join the live waitlist.</p></div><div><span>03</span><CheckCircle2 size={20}/><strong>Show up</strong><p>Show your code at the door. That's it.</p></div></div>
        </section>
      </main>

      <footer><a className="brand footer-brand" href="#"><span className="brand-mark"><Dumbbell size={16}/></span><span>mat<span className="brand-light">time</span></span></a><span>GOOD HOURS. GOOD ENERGY.</span><span>BUILT TO KEEP YOU MOVING <CircleDot size={12}/></span></footer>
    </div>
  );
}

function SessionCard({ session, index, busy, onBook }) {
  const full = session.remaining <= 0;
  const fill = Math.min(100, (session.booked / session.capacity) * 100);
  const spotsText = full ? "CLASS FULL" : `${session.remaining} ${session.remaining === 1 ? "MAT" : "MATS"} LEFT`;
  return <article className={`session-card ${full ? "is-full" : ""}`} style={{ "--delay": `${index * 35}ms` }}>
    <div className="session-time"><span className="time-day">{fmtDay(session.starts_at)}</span><strong>{fmtTime(session.starts_at)}</strong><span className="time-end">TO {fmtTime(new Date(new Date(session.starts_at).getTime() + 3600000).toISOString())}</span></div>
    <div className="session-details"><div className="session-name">Open gym session <span className="session-tag"><Activity size={12}/> ALL LEVELS</span></div><div className="capacity-line"><div className="capacity-track"><span style={{ width: `${fill}%` }}/></div><span>{session.booked}/{session.capacity} booked</span></div><div className={`availability ${full ? "full" : ""}`}><span/> {spotsText}{session.waitlist_count > 0 && <span className="wait-count"> · {session.waitlist_count} waiting</span>}</div></div>
    <button className={`book-button ${full ? "wait-button" : ""}`} onClick={onBook} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : <>{full ? "Join waitlist" : "Book a mat"} <ArrowRight size={16}/></>}</button>
  </article>;
}

function BookingRow({ booking, busy, onCancel }) {
  return <article className="booking-row"><div className="booking-row-date"><CalendarDays size={18}/><span>{fmtDay(booking.starts_at)}<strong>{fmtTime(booking.starts_at)}</strong></span></div><div className="booking-row-info"><strong>{booking.status === "waitlisted" ? "You're on the waitlist" : booking.status === "checked_in" ? "Checked in" : "Open gym session"}</strong>{booking.status === "confirmed" && <span className="booking-code"><Ticket size={14}/> CODE: <b>{booking.code}</b><button onClick={() => navigator.clipboard?.writeText(booking.code)} title="Copy code">Copy</button></span>}{booking.status === "waitlisted" && <span className="queue-position"><Hourglass size={14}/> Queue position #{booking.queue_position}</span>}</div>{booking.status !== "checked_in" && <button className="cancel-button" disabled={busy} onClick={onCancel}>{busy ? "…" : "Cancel"}</button>}</article>;
}

createRoot(document.getElementById("root")).render(<App />);
